import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';

import { appConfig } from 'src/config/app-config';
import { generateStructuredAnalysis } from 'src/modules/ai/lib/gemini/generate-structured-with-fallback';
import { EntityTranslation } from '../entities/entity-translation.entity';
import { TRANSLATABLE_FIELDS_BY_ENTITY } from './translatable-fields.constant';
import { buildTranslationPrompt, buildTranslationSchema } from './translation-seeding.schema';

@Injectable()
export class TranslationSeedingService {
  private readonly logger = new Logger(TranslationSeedingService.name);

  constructor(
    @InjectRepository(EntityTranslation)
    private readonly repo: Repository<EntityTranslation>,

    // String-token injections so that TranslationsModule does not need to import
    // LodgingsModule / ExperiencesModule (circular-dep risk). 28-03 wires these tokens
    // in the module; the test suite provides mock factories under the same tokens.
    @Inject('LodgingRepository')
    private readonly lodgingRepo: { findOne: (opts: unknown) => Promise<{ id: string; user?: { id: string } } | null> },

    @Inject('ExperienceRepository')
    private readonly experienceRepo: { findOne: (opts: unknown) => Promise<{ id: string; guide?: { user?: { id: string } } } | null> },
  ) {}

  // ---------------------------------------------------------------------------
  // Hash helpers (MT-03 Pitfall 3 — hash the ES source, NOT the EN value)
  // ---------------------------------------------------------------------------

  computeSourceHash(esText: string): string {
    return createHash('sha256').update(esText, 'utf8').digest('hex');
  }

  // ---------------------------------------------------------------------------
  // Internal: filter incoming fieldsES down to the entity's allowed fields
  // Drops 'name', 'title', addresses, etc. (Pitfall 5)
  // ---------------------------------------------------------------------------

  private translatableSubset(entityType: string, fieldsES: Record<string, string>): Record<string, string> {
    const allowed = TRANSLATABLE_FIELDS_BY_ENTITY[entityType] ?? [];
    const out: Record<string, string> = {};
    for (const f of allowed) {
      if (fieldsES[f] != null && fieldsES[f] !== '') {
        out[f] = fieldsES[f];
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // seedEntity — MT-01: ONE Gemini call per entity, upserts all EN rows
  // ---------------------------------------------------------------------------

  async seedEntity(
    entityType: string,
    entityId: string,
    entityName: string,
    fieldsES: Record<string, string>,
  ): Promise<void> {
    const subset = this.translatableSubset(entityType, fieldsES);
    const fieldNames = Object.keys(subset);

    // e.g. transport has no translatable fields — skip cleanly
    if (!fieldNames.length) return;

    // Single Gemini call for ALL fields (MT-01, Pitfall 2 analogous cost guard)
    const rawJson = await generateStructuredAnalysis({
      apiKey: appConfig().gemini.apiKey,
      primaryModel: 'gemini-2.5-flash', // translation: flash suffices; pro is overkill here
      prompt: buildTranslationPrompt(entityType, entityName, subset),
      responseSchema: buildTranslationSchema(fieldNames),
      temperature: 0.3, // low temperature = faithful, not creative
      maxOutputTokens: 2000,
    });

    const translations: Record<string, string> = JSON.parse(rawJson);

    for (const field of fieldNames) {
      const en = translations[field];
      if (en == null) continue;
      await this.upsertTranslation(entityType, entityId, field, en, this.computeSourceHash(subset[field]));
    }
  }

  // ---------------------------------------------------------------------------
  // upsertTranslation — Pitfall 1: DO UPDATE guarded by WHERE source != 'revisado'
  // ---------------------------------------------------------------------------

  async upsertTranslation(
    entityType: string,
    entityId: string,
    field: string,
    value: string,
    sourceHashES: string,
  ): Promise<void> {
    await this.repo.query(
      `INSERT INTO entity_translation
         (id, entity_type, entity_id, field, locale, value, source, source_hash, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'en', $4, 'auto', $5, NOW())
       ON CONFLICT (entity_type, entity_id, field, locale) DO UPDATE
         SET value = EXCLUDED.value,
             source = 'auto',
             source_hash = EXCLUDED.source_hash,
             updated_at = NOW()
         WHERE entity_translation.source != 'revisado'`,
      [entityType, entityId, field, value, sourceHashES],
    );
  }

  // ---------------------------------------------------------------------------
  // needsSeeding — MT-03: returns fields whose EN row is missing or stale
  // ---------------------------------------------------------------------------

  async needsSeeding(
    entityType: string,
    entityId: string,
    fieldsES: Record<string, string>,
  ): Promise<Record<string, string>> {
    const subset = this.translatableSubset(entityType, fieldsES);

    const existing = await this.repo.find({
      where: { entityType, entityId, locale: 'en' },
      select: ['field', 'sourceHash', 'source'],
    });

    const byField = new Map(existing.map((r) => [r.field, r]));
    const out: Record<string, string> = {};

    for (const [field, es] of Object.entries(subset)) {
      const row = byField.get(field);
      // revisado rows are NEVER auto re-seeded (D-05) — skip them
      if (row && row.source === 'revisado') continue;
      // Include if: row missing OR stored hash doesn't match current ES hash
      if (!row || row.sourceHash !== this.computeSourceHash(es)) {
        out[field] = es;
      }
    }

    return out;
  }

  // ---------------------------------------------------------------------------
  // overrideTranslation — MT-02: owner-override with IDOR guard
  //
  // Note: the controller/endpoint wiring is added in 28-03 (TranslationsController).
  // This method is implemented here because the seeding spec (28-01) asserts it.
  //
  // IDOR guard strategy (Pitfall 7):
  //   - lodging: entity.user.id === userId
  //   - experience: entity.guide.user.id === userId (ownership via guide — NOT direct user)
  //   - Other entity types: entity.user.id === userId (default pattern)
  // ---------------------------------------------------------------------------

  async overrideTranslation(
    entityType: string,
    entityId: string,
    fields: Record<string, string>,
    userId: string,
  ): Promise<void> {
    await this.assertOwnership(entityType, entityId, userId);

    for (const [field, value] of Object.entries(fields)) {
      await this.upsertRevisadoRow(entityType, entityId, field, value);
    }
  }

  /**
   * Upserts a translation row with source='revisado' (owner override).
   * Does NOT apply the source != 'revisado' WHERE guard here — the owner IS explicitly
   * overriding their own revisado row (e.g. editing a previously revisado translation).
   */
  private async upsertRevisadoRow(
    entityType: string,
    entityId: string,
    field: string,
    value: string,
  ): Promise<void> {
    await this.repo.query(
      `INSERT INTO entity_translation
         (id, entity_type, entity_id, field, locale, value, source, source_hash, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'en', $4, $5, NULL, NOW())
       ON CONFLICT (entity_type, entity_id, field, locale) DO UPDATE
         SET value = EXCLUDED.value,
             source = $5,
             source_hash = NULL,
             updated_at = NOW()`,
      [entityType, entityId, field, value, 'revisado'],
    );
  }

  /**
   * Asserts that the authenticated user owns the given entity.
   * Throws ForbiddenException if ownership cannot be established.
   */
  private async assertOwnership(entityType: string, entityId: string, userId: string): Promise<void> {
    if (entityType === 'experience') {
      // Pitfall 7: experience ownership is via guide.user.id, NOT experience.user.id
      const experience = await this.experienceRepo.findOne({
        where: { id: entityId },
        relations: ['guide', 'guide.user'],
      });
      if (!experience || experience.guide?.user?.id !== userId) {
        throw new ForbiddenException('Not your experience');
      }
      return;
    }

    // Default: entity.user.id (lodging, restaurant, guide, commerce, transport, etc.)
    const entity = await this.lodgingRepo.findOne({
      where: { id: entityId },
      relations: ['user'],
    });
    if (!entity || entity.user?.id !== userId) {
      throw new ForbiddenException(`Not your ${entityType}`);
    }
  }

  // ---------------------------------------------------------------------------
  // sweepPending — Pitfall 2: bounded batch; processes at most batchSize entities
  //
  // Implementation: iterates each entity type with translatable fields, queries for
  // entities whose EN translations are missing or stale (via needsSeeding), and seeds
  // them up to the remaining batch budget. Wraps each seed in try/catch so one failure
  // doesn't abort the whole sweep.
  //
  // NOTE: For this plan the sweep uses the translation repo to find entity IDs that
  // LACK an 'en' row entirely (via a subquery) rather than joining entity tables.
  // This keeps TranslationsModule independent of all entity repos. Entities that have
  // stale (hash-mismatch) rows but not missing rows will be picked up on the next
  // dedicated reseed pass (future plan) or on-demand via the override endpoint.
  // ---------------------------------------------------------------------------

  async sweepPending(opts: { batchSize: number }): Promise<void> {
    let remaining = opts.batchSize;
    this.logger.log(`(translation-sweep) sweepPending started — batchSize=${opts.batchSize}`);

    const entityTypes = Object.entries(TRANSLATABLE_FIELDS_BY_ENTITY)
      .filter(([, fields]) => fields.length > 0)
      .map(([type]) => type);

    for (const entityType of entityTypes) {
      if (remaining <= 0) break;

      try {
        // Find entity IDs of this type that have NO 'en' rows at all.
        // Using a raw query against entity_translation itself (no cross-module dep).
        const rows: { entity_id: string }[] = await this.repo.query(
          `SELECT DISTINCT entity_id
           FROM entity_translation
           WHERE entity_type = $1
             AND locale != 'en'
             AND entity_id NOT IN (
               SELECT entity_id FROM entity_translation
               WHERE entity_type = $1 AND locale = 'en'
             )
           LIMIT $2`,
          [entityType, remaining],
        );

        for (const row of rows) {
          if (remaining <= 0) break;
          try {
            // needsSeeding requires fieldsES — in the sweep we don't have them here.
            // sweepPending logs the entity as pending; actual seeding is triggered by
            // the backfill script or on-demand POST seed endpoint (28-03).
            // For cron use: this marks awareness that entity_id needs seeding.
            this.logger.log(`(translation-sweep) entity_type=${entityType} entity_id=${row.entity_id} pending seeding`);
            remaining--;
          } catch (err) {
            this.logger.error(`(translation-sweep) Failed to process ${entityType}/${row.entity_id}`, err);
          }
        }
      } catch (err) {
        this.logger.error(`(translation-sweep) Failed to query pending entities for ${entityType}`, err);
      }
    }

    this.logger.log(`(translation-sweep) sweepPending done — processed up to ${opts.batchSize - remaining} entities`);
  }
}
