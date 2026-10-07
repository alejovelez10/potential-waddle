import { Inject, Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { DataSource } from 'typeorm';

import { EnvironmentVariables } from 'src/config';
import { buildCatalogSettings, buildReplicaSettings } from './config/index-settings';
import { buildSynonyms } from './config/search-synonyms';
import { byteSize } from './builders/base-record';
import { SearchRecordBuilderService } from './builders/search-record-builder.service';
import type { SearchRecord } from './interfaces/search-record.interface';
import type { AlgoliaClient } from './providers/algolia.provider';
import {
  ALGOLIA_CLIENT,
  ALGOLIA_RECORD_LIMIT_BYTES,
  catalogIndexName,
  objectIdFor,
  replicaIndexName,
  SEARCH_TYPES,
  SearchType,
  SORT_REPLICAS,
  SortReplicaKey,
} from './search.constants';
import { DirtyBatch, SearchSyncQueue } from './search-sync.queue';

/** Fixed table per type (whitelist — never interpolate user input). */
const TYPE_TABLE: Record<SearchType, string> = {
  lodging: 'lodging',
  restaurant: 'restaurant',
  experience: 'experience',
  place: 'place',
  commerce: 'commerce',
  guide: 'guide',
  transport: 'transport',
  event: 'public_event',
};
const SLUG_TYPES = new Set<SearchType>(['lodging', 'restaurant', 'experience', 'place', 'commerce', 'guide', 'event']);

/** Join tables used to fan out a category/facility change to the entities that use it. */
const CATEGORY_JOINS: [SearchType, string, string][] = [
  ['lodging', 'lodging_category', 'lodging_id'],
  ['restaurant', 'restaurant_category', 'restaurant_id'],
  ['experience', 'experience_category', 'experience_id'],
  ['place', 'place_category', 'place_id'],
  ['commerce', 'commerce_category', 'commerce_id'],
  ['guide', 'guide_category', 'guide_id'],
  ['transport', 'transport_category', 'transport_id'],
];
const FACILITY_JOINS: [SearchType, string, string][] = [
  ['lodging', 'lodging_facility', 'lodging_id'],
  ['restaurant', 'restaurant_facility', 'restaurant_id'],
  ['experience', 'experience_facility', 'experience_id'],
  ['place', 'place_facility', 'place_id'],
  ['commerce', 'commerce_facility', 'commerce_id'],
];
const BADGE_TYPES: SearchType[] = ['lodging', 'restaurant', 'commerce', 'guide', 'transport'];

export interface ReindexSummary {
  indexed: Record<string, number>;
  deleted: number;
  /** objectIDs still over the plan limit after trimming: not sent, any previous version kept. */
  skipped: string[];
  /** Types whose build or upload failed; their existing records are left untouched. */
  failed: Record<string, string>;
  durationMs: number;
}

/**
 * Pushes catalog records to Algolia. All writes go through here and all of them require the
 * write client — in safe mode (no admin key / sync disabled) every method is a no-op or a 503.
 */
@Injectable()
export class SearchIndexerService implements OnModuleInit {
  private readonly logger = new Logger(SearchIndexerService.name);
  private readonly indexName: string;
  private readonly prefix: string;
  private reindexRunning: Promise<ReindexSummary> | null = null;

  constructor(
    @Inject(ALGOLIA_CLIENT) private readonly client: AlgoliaClient | null,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly builder: SearchRecordBuilderService,
    private readonly queue: SearchSyncQueue,
    config: ConfigService<EnvironmentVariables>,
  ) {
    this.prefix = config.get('algolia', { infer: true })?.indexPrefix || 'prod';
    this.indexName = catalogIndexName(this.prefix);
  }

  onModuleInit() {
    if (this.client) this.queue.registerHandler(batch => this.processDirty(batch));
  }

  get enabled(): boolean {
    return !!this.client;
  }

  private requireClient(): AlgoliaClient {
    if (!this.client) {
      throw new ServiceUnavailableException('Search indexing is disabled in this environment (safe mode)');
    }
    return this.client;
  }

  // ------------------------------------------------------------------------------------------
  // Settings
  // ------------------------------------------------------------------------------------------

  /** Apply settings, sort replicas and synonyms (idempotent). */
  async configure(): Promise<{ index: string; replicas: string[]; synonyms: number }> {
    const client = this.requireClient();

    const { taskID } = await client.setSettings({
      indexName: this.indexName,
      indexSettings: buildCatalogSettings(this.prefix),
      forwardToReplicas: false,
    });
    // Only the first run needs this (replicas must exist before their own settings). Afterwards
    // Algolia applies an index's tasks in order, and on this plan a settings task over a filled
    // index can stay queued for minutes — so wait ~40 s at most and carry on.
    try {
      await client.waitForTask({ indexName: this.indexName, taskID, maxRetries: 20 });
    } catch (error) {
      this.logger.warn(`Settings task ${taskID} still pending, continuing: ${(error as Error).message}`);
    }

    const replicaKeys = Object.keys(SORT_REPLICAS) as SortReplicaKey[];
    for (const key of replicaKeys) {
      await client.setSettings({
        indexName: replicaIndexName(this.prefix, key),
        indexSettings: buildReplicaSettings(key),
      });
    }

    const synonyms = buildSynonyms();
    await client.saveSynonyms({
      indexName: this.indexName,
      synonymHit: synonyms,
      forwardToReplicas: true,
      replaceExistingSynonyms: true,
    });

    this.logger.log(`Configured ${this.indexName} (${replicaKeys.length} replicas, ${synonyms.length} synonyms)`);
    return {
      index: this.indexName,
      replicas: replicaKeys.map(k => replicaIndexName(this.prefix, k)),
      synonyms: synonyms.length,
    };
  }

  // ------------------------------------------------------------------------------------------
  // Full reindex
  // ------------------------------------------------------------------------------------------

  /**
   * Rebuild every type and remove records that are no longer visible. Upsert + delete-stale
   * (instead of replaceAllObjects) keeps the record count flat and the index always queryable.
   * Concurrent calls share the running job.
   */
  reindexAll(): Promise<ReindexSummary> {
    this.requireClient();
    if (!this.reindexRunning) {
      this.reindexRunning = this.runReindexAll().finally(() => {
        this.reindexRunning = null;
      });
    }
    return this.reindexRunning;
  }

  private async runReindexAll(): Promise<ReindexSummary> {
    const client = this.requireClient();
    const started = Date.now();
    const indexed: Record<string, number> = {};
    const keep = new Set<string>();
    const skipped: string[] = [];
    const failed: Record<string, string> = {};

    // One type failing (bad row, Algolia error) must not stop the others.
    for (const type of SEARCH_TYPES) {
      try {
        const { records } = await this.builder.build(type);
        const { fit, oversized } = this.splitBySize(records);
        if (fit.length) await client.saveObjects({ indexName: this.indexName, objects: fit as any[], batchSize: 500 });
        records.forEach(r => keep.add(r.objectID));
        skipped.push(...oversized);
        indexed[type] = fit.length;
      } catch (error) {
        failed[type] = (error as Error).message;
        this.logger.error(`Reindex of ${type} failed: ${failed[type]}`);
      }
    }

    const existing: string[] = [];
    await client.browseObjects<{ objectID: string }>({
      indexName: this.indexName,
      browseParams: { attributesToRetrieve: ['objectID'], hitsPerPage: 1000 },
      aggregator: response => existing.push(...response.hits.map(hit => hit.objectID)),
    });
    const failedPrefixes = Object.keys(failed).map(type => objectIdFor(type as SearchType, ''));
    const stale = existing.filter(id => !keep.has(id) && !failedPrefixes.some(prefix => id.startsWith(prefix)));
    if (stale.length) await client.deleteObjects({ indexName: this.indexName, objectIDs: stale });

    const summary: ReindexSummary = { indexed, deleted: stale.length, skipped, failed, durationMs: Date.now() - started };
    this.logger.log(`Reindexed ${this.indexName}: ${JSON.stringify(summary)}`);
    return summary;
  }

  // ------------------------------------------------------------------------------------------
  // Partial reindex (live sync)
  // ------------------------------------------------------------------------------------------

  /** Never send a record the plan would reject: a single oversized record fails its whole batch. */
  private splitBySize(records: SearchRecord[]): { fit: SearchRecord[]; oversized: string[] } {
    const fit: SearchRecord[] = [];
    const oversized: string[] = [];
    for (const record of records) {
      const size = byteSize(record);
      if (size <= ALGOLIA_RECORD_LIMIT_BYTES) {
        fit.push(record);
        continue;
      }
      oversized.push(record.objectID);
      this.logger.warn(`Skipping ${record.objectID}: ${size} bytes after trimming (limit ${ALGOLIA_RECORD_LIMIT_BYTES})`);
    }
    return { fit, oversized };
  }

  /** Rebuild the given entities: visible ones are upserted, the rest deleted. */
  async reindexEntities(type: SearchType, ids: string[]): Promise<{ upserted: number; deleted: number }> {
    const client = this.requireClient();
    if (!ids.length) return { upserted: 0, deleted: 0 };

    const { records, hiddenIds } = await this.builder.build(type, ids);
    const { fit } = this.splitBySize(records);
    if (fit.length) await client.saveObjects({ indexName: this.indexName, objects: fit as any[] });
    if (hiddenIds.length) {
      await client.deleteObjects({ indexName: this.indexName, objectIDs: hiddenIds.map(id => objectIdFor(type, id)) });
    }
    return { upserted: fit.length, deleted: hiddenIds.length };
  }

  /** Handler of SearchSyncQueue: expand fan-outs, resolve slugs, reindex per type. */
  async processDirty(batch: DirtyBatch): Promise<void> {
    const targets = new Map<SearchType, Set<string>>();
    const add = (type: SearchType, ids: string[]) => {
      const set = targets.get(type) ?? new Set<string>();
      ids.forEach(id => set.add(id));
      targets.set(type, set);
    };

    for (const [kind, identifiers] of batch) {
      switch (kind) {
        case 'category':
          for (const [type, table, fk] of CATEGORY_JOINS)
            add(type, await this.idsFromJoin(table, fk, 'category_id', identifiers));
          break;
        case 'facility':
          for (const [type, table, fk] of FACILITY_JOINS)
            add(type, await this.idsFromJoin(table, fk, 'facility_id', identifiers));
          break;
        case 'badge':
          for (const type of BADGE_TYPES) add(type, await this.idsFromBadges(type, identifiers));
          break;
        case 'town':
          for (const type of SEARCH_TYPES) add(type, await this.idsFromTowns(type, identifiers));
          break;
        default:
          add(kind, await this.resolveIdentifiers(kind, identifiers));
      }
    }

    // Experiences inherit visibility, Premium and the Verified seal from their guide.
    const guideIds = [...(targets.get('guide') ?? [])];
    if (guideIds.length) {
      const rows: { id: string }[] = await this.dataSource.query(
        'SELECT id FROM "experience" WHERE guide_id = ANY($1::uuid[])',
        [guideIds],
      );
      add(
        'experience',
        rows.map(r => r.id),
      );
    }

    for (const [type, ids] of targets) {
      if (!ids.size) continue;
      try {
        const result = await this.reindexEntities(type, [...ids]);
        this.logger.log(`Synced ${type}: +${result.upserted} -${result.deleted}`);
      } catch (error) {
        this.logger.error(`Sync of ${type} [${[...ids].join(',')}] failed: ${(error as Error).message}`);
      }
    }
  }

  /** Ids pass through; slugs are looked up (bound parameter, fixed table). */
  private async resolveIdentifiers(type: SearchType, identifiers: string[]): Promise<string[]> {
    const ids = identifiers.filter(id => isUUID(id));
    const slugs = identifiers.filter(id => !isUUID(id));
    if (slugs.length && SLUG_TYPES.has(type)) {
      const rows: { id: string }[] = await this.dataSource.query(
        `SELECT id FROM "${TYPE_TABLE[type]}" WHERE slug = ANY($1::text[])`,
        [slugs],
      );
      ids.push(...rows.map(r => r.id));
    }
    return ids;
  }

  private async idsFromJoin(
    table: string,
    entityColumn: string,
    refColumn: string,
    refIds: string[],
  ): Promise<string[]> {
    const uuids = refIds.filter(id => isUUID(id));
    if (!uuids.length) return [];
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT DISTINCT ${entityColumn} AS id FROM "${table}" WHERE ${refColumn} = ANY($1::uuid[])`,
      [uuids],
    );
    return rows.map(r => r.id);
  }

  private async idsFromBadges(type: SearchType, badgeIds: string[]): Promise<string[]> {
    const uuids = badgeIds.filter(id => isUUID(id));
    if (!uuids.length) return [];
    const rows: { id: string }[] = await this.dataSource.query(
      'SELECT DISTINCT entity_id AS id FROM "entity_badge" WHERE entity_type = $1 AND badge_id = ANY($2::uuid[])',
      [type, uuids],
    );
    return rows.map(r => r.id);
  }

  private async idsFromTowns(type: SearchType, townIds: string[]): Promise<string[]> {
    const uuids = townIds.filter(id => isUUID(id));
    if (!uuids.length) return [];
    const sql =
      type === 'guide'
        ? 'SELECT DISTINCT guide_id AS id FROM "guide_town" WHERE town_id = ANY($1::uuid[])'
        : `SELECT id FROM "${TYPE_TABLE[type]}" WHERE town_id = ANY($1::uuid[])`;
    const rows: { id: string }[] = await this.dataSource.query(sql, [uuids]);
    return rows.map(r => r.id);
  }
}
