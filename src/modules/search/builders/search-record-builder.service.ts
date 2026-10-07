import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { SubscriptionsService } from 'src/modules/subscriptions/services/subscriptions.service';
import type { EntityType } from 'src/modules/subscriptions/entities/subscription.entity';
import { TranslationResolverService } from 'src/modules/translations/translation-resolver.service';
import { VerificationService } from 'src/modules/verification/verification.service';

import type { SearchRecord } from '../interfaces/search-record.interface';
import type { SearchType } from '../search.constants';
import { colombiaDay } from '../utils/text.utils';
import type { CommonRow, TypeBuilder } from './base-record';
import { BuildContext, collectTaxonomyIds, loadBadges, loadPromotions } from './build-context';
import { commerceRecordBuilder } from './commerce.record-builder';
import { eventRecordBuilder } from './event.record-builder';
import { experienceRecordBuilder } from './experience.record-builder';
import { guideRecordBuilder } from './guide.record-builder';
import { lodgingRecordBuilder } from './lodging.record-builder';
import { placeRecordBuilder } from './place.record-builder';
import { restaurantRecordBuilder } from './restaurant.record-builder';
import { transportRecordBuilder } from './transport.record-builder';

export const TYPE_BUILDERS: Record<SearchType, TypeBuilder<any>> = {
  lodging: lodgingRecordBuilder,
  restaurant: restaurantRecordBuilder,
  experience: experienceRecordBuilder,
  place: placeRecordBuilder,
  commerce: commerceRecordBuilder,
  guide: guideRecordBuilder,
  transport: transportRecordBuilder,
  event: eventRecordBuilder,
};

const PREMIUM_TYPES = new Set<SearchType>(['lodging', 'restaurant', 'commerce', 'guide', 'transport', 'experience']);

export interface BuildResult {
  records: SearchRecord[];
  /** Requested ids that exist but are not publicly visible (or no longer exist) → delete. */
  hiddenIds: string[];
}

/**
 * Builds catalog records straight from Postgres. Pure read side: never writes anywhere, so it is
 * safe to run against any database (the dry-run script uses it on the local DB).
 */
@Injectable()
export class SearchRecordBuilderService {
  private readonly logger = new Logger(SearchRecordBuilderService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly subscriptions: SubscriptionsService,
    private readonly verification: VerificationService,
    private readonly translations: TranslationResolverService,
  ) {}

  /**
   * Without ids: every visible entity of the type (full reindex).
   * With ids: those entities — visible ones become records, the rest are reported as hidden.
   */
  async build(type: SearchType, ids?: string[]): Promise<BuildResult> {
    const builder = TYPE_BUILDERS[type];
    if (ids && !ids.length) return { records: [], hiddenIds: [] };

    const now = new Date();
    const rows: CommonRow[] = await builder.load(this.dataSource, ids);
    const visible = rows.filter(row => builder.isVisible(row, now));
    const visibleIds = new Set(visible.map(r => r.id));
    const hiddenIds = ids ? ids.filter(id => !visibleIds.has(id)) : [];

    if (!visible.length) return { records: [], hiddenIds };

    const ctx = await this.loadContext(type, builder, visible, now);
    const records: SearchRecord[] = [];
    for (const row of visible) {
      try {
        records.push(builder.toRecord(row, ctx));
      } catch (error) {
        // One broken row must not block the rest of the batch; it stays out until fixed.
        this.logger.error(`Could not build ${type} ${row.id}: ${(error as Error).message}`);
      }
    }
    return { records, hiddenIds };
  }

  private async loadContext(
    type: SearchType,
    builder: TypeBuilder,
    rows: CommonRow[],
    now: Date,
  ): Promise<BuildContext> {
    const ids = rows.map(r => r.id);
    const { categoryIds, facilityIds } = collectTaxonomyIds(rows);

    const [premiumIds, verifiedIds, translations, categoryEn, facilityEn, badges] = await Promise.all([
      PREMIUM_TYPES.has(type)
        ? this.subscriptions.getPremiumIdSet(type as EntityType)
        : Promise.resolve(new Set<string>()),
      this.verification.getVerifiedIdSet(type),
      builder.translationType
        ? this.translations.batchLoad(builder.translationType, ids, 'en')
        : Promise.resolve(new Map<string, Record<string, string>>()),
      this.translations.batchLoad('category', categoryIds, 'en'),
      this.translations.batchLoad('facility', facilityIds, 'en'),
      loadBadges(this.dataSource, type, ids),
    ]);

    // Promotions are a Premium benefit — only look them up for Premium entities.
    const promotions = await loadPromotions(
      this.dataSource,
      type,
      ids.filter(id => premiumIds.has(id)),
    );

    const taxonomyEn = new Map<string, string>();
    for (const [id, fields] of [...categoryEn, ...facilityEn]) {
      if (fields.name) taxonomyEn.set(id, fields.name);
    }

    return { premiumIds, verifiedIds, promotions, badges, translations, taxonomyEn, day: colombiaDay(now), now };
  }
}
