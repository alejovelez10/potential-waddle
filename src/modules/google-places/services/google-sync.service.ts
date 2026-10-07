import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Lodging } from 'src/modules/lodgings/entities/lodging.entity';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { Commerce } from 'src/modules/commerce/entities/commerce.entity';
import { GoogleReview } from '../entities/google-review.entity';
import { GoogleReviewSyncLog } from '../entities/google-review-sync-log.entity';
import {
  PlaceIdResolverService,
  placeIdToMapsUrl,
  isPlacesGeneratedUrl,
  placeKeyFromMapsUrl,
} from './place-id-resolver.service';
import {
  GOOGLE_REVIEWS_SOURCE,
  GoogleReviewsSourceService,
} from '../interfaces/google-reviews-source.interface';
import { SearchSyncQueue } from 'src/modules/search/search-sync.queue';

type EntityType = 'lodging' | 'restaurant' | 'commerce';
type TriggerType = 'cron' | 'manual';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the TypeORM entity class for a given type discriminator. */
function entityClass(type: EntityType): typeof Lodging | typeof Restaurant | typeof Commerce {
  if (type === 'lodging') return Lodging;
  if (type === 'restaurant') return Restaurant;
  return Commerce;
}

// ---------------------------------------------------------------------------
// GoogleSyncService
// ---------------------------------------------------------------------------

/**
 * Core sync entry-point for Google Reviews. Called by the Phase 21 cron and
 * by the manual-sync endpoint.
 *
 * syncEntity lifecycle (all mutations inside a QueryRunner transaction except
 * the sync-log open/close, which live outside so their status is always
 * visible even on rollback):
 *   1. Open sync-log row (status='running').
 *   2. Open QueryRunner, connect, startTransaction.
 *   3. Load entity (lodging | restaurant | commerce) with town relations.
 *   4. Resolve place_id via PlaceIdResolverService.
 *   5. First sync (lastGoogleSyncAt == null): wipe existing reviews (D-03),
 *      full pull; else incremental pull with cursor = lastGoogleSyncAt.
 *   6. UPSERT each fetched review by review_id (orUpdate).
 *   7. Recompute googleMapsRating / googleMapsReviewsCount via AVG/COUNT from
 *      google_review table in the SAME transaction (D-06 full recompute).
 *   8. Update lastGoogleSyncAt on entity.
 *   9. commitTransaction.
 *  10. Close sync-log status='success'.
 * On any error: rollbackTransaction, close sync-log status='error' (D-08).
 */
@Injectable()
export class GoogleSyncService {
  private readonly logger = new Logger(GoogleSyncService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(GoogleReviewSyncLog)
    private readonly syncLogRepository: Repository<GoogleReviewSyncLog>,
    @InjectRepository(Lodging)
    private readonly lodgingRepository: Repository<Lodging>,
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
    @InjectRepository(Commerce)
    private readonly commerceRepository: Repository<Commerce>,
    private readonly placeIdResolver: PlaceIdResolverService,
    @Inject(GOOGLE_REVIEWS_SOURCE)
    private readonly source: GoogleReviewsSourceService,
    private readonly searchSync: SearchSyncQueue,
  ) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Sync Google reviews for a single entity.
   *
   * @param entityId   UUID of the entity to sync.
   * @param entityType 'lodging' | 'restaurant' | 'commerce'.
   * @param trigger    'cron' | 'manual' — echoed to the sync-log row.
   * @returns          The closed GoogleReviewSyncLog row (status success or error).
   */
  async syncEntity(
    entityId: string,
    entityType: EntityType,
    trigger: TriggerType,
  ): Promise<GoogleReviewSyncLog> {
    // -----------------------------------------------------------------------
    // Step 1: Open sync-log OUTSIDE the QueryRunner so running/error state is
    //         always visible even if the transaction rolls back.
    // -----------------------------------------------------------------------
    const syncLog = await this.syncLogRepository.save(
      this.syncLogRepository.create({
        entityId,
        entityType,
        trigger,
        status: 'running',
        startedAt: new Date(),
      }),
    );

    // -----------------------------------------------------------------------
    // Step 2: QueryRunner setup
    // -----------------------------------------------------------------------
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      // ---------------------------------------------------------------------
      // Step 3: Load entity with relations for place_id resolution
      // ---------------------------------------------------------------------
      const entity = await this.loadEntity(entityId, entityType, qr);
      if (!entity) {
        throw new Error(`Entity not found: ${entityType}/${entityId}`);
      }

      // ---------------------------------------------------------------------
      // Step 3a: URL gate — only sync entities that carry a valid
      //          Places-generated Google Maps URL. Anything else (missing, or
      //          arbitrary "junk" URL) is DISCARDED: no Apify call, no review
      //          mutation, and a status='skipped' log row for auditability.
      // ---------------------------------------------------------------------
      if (!isPlacesGeneratedUrl(entity.googleMapsUrl)) {
        await qr.rollbackTransaction();
        this.logger.warn(
          `Skipping ${entityType}/${entityId} — missing or invalid Places URL: ${entity.googleMapsUrl ?? '(none)'}`,
        );
        syncLog.status = 'skipped';
        syncLog.endedAt = new Date();
        syncLog.errorMessage = 'skipped: missing or invalid googleMapsUrl';
        await this.syncLogRepository.save(syncLog);
        return syncLog;
      }

      // ---------------------------------------------------------------------
      // Step 4: Resolve place_id — BEST-EFFORT. The fetch uses the validated
      //         googleMapsUrl directly (Step 6), so resolution only backfills
      //         googleMapsId when possible and must NEVER block the sync.
      // ---------------------------------------------------------------------
      let placeId: string | null = null;
      try {
        placeId = await this.placeIdResolver.resolve(entity, entityType);
      } catch (resolveError) {
        this.logger.warn(
          `place_id not resolved for ${entityType}/${entityId} (non-blocking): ${resolveError?.message ?? resolveError}`,
        );
      }

      // ---------------------------------------------------------------------
      // Step 5: Full-resync wipe or incremental cursor
      //         A full resync (wipe + non-incremental pull) is forced when:
      //         - isFirstSync: no prior sync cursor exists, OR
      //         - urlChanged: the owner re-pointed the business to a different
      //           Google place since the last sync. Without the wipe, the
      //           previous place's reviews would linger mixed with the new
      //           place's (UPSERT-by-review_id never deletes stale rows), and
      //           the incremental cursor would skip the new place's older
      //           reviews. Comparing lastSyncedMapsUrl vs the current
      //           googleMapsUrl catches the swap at sync time.
      // ---------------------------------------------------------------------
      const isFirstSync = entity.lastGoogleSyncAt == null;
      // Compare by STABLE place key (cid / place_id), not the raw URL string, so
      // Google's volatile tracking params (e.g. &g_mp=...) don't cause a false
      // change. A null key on either side means "not comparable" → never wipe.
      const lastKey = placeKeyFromMapsUrl(entity.lastSyncedMapsUrl);
      const currentKey = placeKeyFromMapsUrl(entity.googleMapsUrl);
      const urlChanged = lastKey != null && currentKey != null && lastKey !== currentKey;
      const forceFull = isFirstSync || urlChanged;

      if (forceFull) {
        this.logger.log(
          `${isFirstSync ? 'First sync' : 'Place URL changed'} — wiping existing reviews for ${entityType}/${entityId}`,
        );
        await qr.manager.delete(GoogleReview, { entityId, entityType });
      }

      // ---------------------------------------------------------------------
      // Step 6: Fetch reviews from the source seam.
      //         The URL gate (Step 3a) guarantees a valid googleMapsUrl, so the
      //         fetch always uses it. placeIdToMapsUrl(placeId) is only a
      //         defensive fallback for the (now unreachable) null-URL case.
      // ---------------------------------------------------------------------
      const mapsUrl = entity.googleMapsUrl ?? (placeId ? placeIdToMapsUrl(placeId) : '');
      const since = forceFull ? null : entity.lastGoogleSyncAt;
      const reviews = await this.source.fetchReviews(mapsUrl, since);

      this.logger.log(
        `Fetched ${reviews.length} reviews for ${entityType}/${entityId} (isFirstSync=${isFirstSync}, urlChanged=${urlChanged})`,
      );

      // ---------------------------------------------------------------------
      // Step 7: UPSERT each review by review_id
      //         orUpdate(['...'], ['review_id']) — updates edited reviews in
      //         place, no duplicates (T-20-09 mitigate).
      //
      //         known constraint: reviewsNew is approximated as the total fetch
      //         count on incremental syncs (Apify only returns new/updated
      //         reviews in incremental mode, but the distinction is not
      //         explicitly surfaced). Accepted per research §UPSERT Mechanics.
      // ---------------------------------------------------------------------
      for (const r of reviews) {
        await qr.manager
          .createQueryBuilder()
          .insert()
          .into(GoogleReview)
          .values({
            entityId,
            entityType,
            authorName: r.authorName,
            rating: r.rating,
            text: r.text,
            reviewUrl: r.reviewUrl,
            reviewDate: r.reviewDate instanceof Date ? r.reviewDate : new Date(r.reviewDate as string),
            reviewId: r.reviewId,
          })
          .orUpdate(
            ['author_name', 'rating', 'text', 'review_url', 'review_date', 'updated_at'],
            ['review_id'],
          )
          .execute();
      }

      // ---------------------------------------------------------------------
      // Step 8: Recompute AVG/COUNT from google_review table (D-06 full
      //         recompute, same transaction). Full recompute self-heals drift
      //         (PITFALLS §6, T-20-08 mitigate).
      // ---------------------------------------------------------------------
      const denormRow = await this.computeDenorm(entityId, entityType, qr);

      const googleMapsRating = denormRow.avg != null ? parseFloat(denormRow.avg) || null : null;
      const googleMapsReviewsCount = parseInt(denormRow.count, 10) || 0;

      const EntityClass = entityClass(entityType);
      await qr.manager.update(
        EntityClass,
        { id: entityId },
        {
          googleMapsRating,
          googleMapsReviewsCount,
          lastGoogleSyncAt: new Date(),
          // Record the URL this sync pulled from so the next sync can detect a
          // place swap (urlChanged) and force a clean full resync.
          lastSyncedMapsUrl: entity.googleMapsUrl ?? null,
        },
      );

      // ---------------------------------------------------------------------
      // Step 9: Commit
      // ---------------------------------------------------------------------
      await qr.commitTransaction();

      // ---------------------------------------------------------------------
      // Step 10: Close sync-log with success (OUTSIDE transaction)
      // ---------------------------------------------------------------------
      syncLog.status = 'success';
      syncLog.endedAt = new Date();
      syncLog.reviewsTotal = googleMapsReviewsCount;
      // known constraint: reviewsNew approximated as total on first sync,
      // or total fetched on incremental (no delta info from Apify per run)
      syncLog.reviewsNew = reviews.length;
      await this.syncLogRepository.save(syncLog);

      this.logger.log(`Sync completed for ${entityType}/${entityId}: ${reviews.length} reviews, rating=${googleMapsRating}`);

      return syncLog;
    } catch (error) {
      // -----------------------------------------------------------------------
      // D-08: On any error — rollback + write error log. Do NOT mutate
      //       rating/count (T-20-08 mitigate: transaction ensures atomicity).
      // -----------------------------------------------------------------------
      await qr.rollbackTransaction();

      const code = error?.message === 'place_id_not_resolvable' ? 'place_id_not_resolvable' : 'sync_error';
      const errorMessage = `${code}: ${error?.message ?? 'unknown error'}`;

      this.logger.error(`Sync failed for ${entityType}/${entityId}: ${errorMessage}`);

      syncLog.status = 'error';
      syncLog.endedAt = new Date();
      syncLog.errorMessage = errorMessage;
      await this.syncLogRepository.save(syncLog);

      return syncLog;
    } finally {
      await qr.release();
      // Runs after the 202 of the manual sync route: refresh the Google rating in the catalog now.
      this.searchSync.mark(entityType, entityId);
    }
  }

  /**
   * Monthly reconciliation pass for a single entity.
   *
   * Performs a FULL fetch (since=null) from Apify, UPSERTs all fetched reviews,
   * then purges google_review rows whose review_id is absent from the fetched set
   * (prevents ghost counts from reviews deleted in Google).
   *
   * Zero-result guard (T-21-14): if Apify returns 0 reviews, the purge is ABORTED
   * to avoid accidentally wiping a business's entire review history on a transient
   * Apify error. Denorm is still recomputed against surviving rows.
   *
   * Sync-log semantics (honest reconciliation):
   *  - reviewsNew = 0  (reconciliation creates no "new" reviews in the owner-facing sense)
   *  - reviewsTotal = afterCount  (surviving rows after purge)
   *  - message = "reconciliation — {purged} reviews purged"
   *
   * @param entityId   UUID of the entity to reconcile.
   * @param entityType 'lodging' | 'restaurant' | 'commerce'.
   * @returns          The closed GoogleReviewSyncLog row.
   */
  async reconcileEntity(entityId: string, entityType: EntityType): Promise<GoogleReviewSyncLog> {
    // -----------------------------------------------------------------------
    // Step 1: Open sync-log OUTSIDE the QueryRunner (always visible)
    // -----------------------------------------------------------------------
    const syncLog = await this.syncLogRepository.save(
      this.syncLogRepository.create({
        entityId,
        entityType,
        trigger: 'cron' as const,
        status: 'running',
        startedAt: new Date(),
      }),
    );

    // -----------------------------------------------------------------------
    // Step 2: QueryRunner setup
    // -----------------------------------------------------------------------
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      // ---------------------------------------------------------------------
      // Step 3: Load entity
      // ---------------------------------------------------------------------
      const entity = await this.loadEntity(entityId, entityType, qr);
      if (!entity) {
        throw new Error(`Entity not found: ${entityType}/${entityId}`);
      }

      // ---------------------------------------------------------------------
      // Step 4: URL gate — mirror syncEntity Step 3a
      // ---------------------------------------------------------------------
      if (!isPlacesGeneratedUrl(entity.googleMapsUrl)) {
        await qr.rollbackTransaction();
        this.logger.warn(
          `(reconcile) Skipping ${entityType}/${entityId} — missing or invalid Places URL: ${entity.googleMapsUrl ?? '(none)'}`,
        );
        syncLog.status = 'skipped';
        syncLog.endedAt = new Date();
        syncLog.errorMessage = 'skipped: missing or invalid googleMapsUrl';
        await this.syncLogRepository.save(syncLog);
        return syncLog;
      }

      // ---------------------------------------------------------------------
      // Step 5: Best-effort place_id resolve (non-blocking)
      // ---------------------------------------------------------------------
      try {
        await this.placeIdResolver.resolve(entity, entityType);
      } catch (resolveError) {
        this.logger.warn(
          `(reconcile) place_id not resolved for ${entityType}/${entityId} (non-blocking): ${resolveError?.message ?? resolveError}`,
        );
      }

      // ---------------------------------------------------------------------
      // Step 6: FULL fetch — since = null forces full fetch regardless of
      //         lastGoogleSyncAt (reconciliation sweeps everything).
      // ---------------------------------------------------------------------
      const mapsUrl = entity.googleMapsUrl ?? '';
      const reviews = await this.source.fetchReviews(mapsUrl, null);

      const fetchedReviewIds = reviews.map((r) => r.reviewId).filter(Boolean) as string[];

      // ---------------------------------------------------------------------
      // Step 7: Zero-result abort guard (T-21-14 / Pitfall 5)
      // If Apify transiently returns 0 reviews, SKIP the purge to avoid
      // wiping the business's entire review history on a bad fetch.
      // Denorm is still recomputed so surviving rows are reflected correctly.
      // ---------------------------------------------------------------------
      let purged = 0;
      let afterCount: number;

      if (fetchedReviewIds.length === 0) {
        this.logger.warn(
          `(reconcile) ${entityType}/${entityId} — full fetch returned 0 reviews, ABORTING purge to avoid wipe`,
        );
        // No UPSERT, no purge. Count surviving rows for the sync-log.
        afterCount = await qr.manager.count(GoogleReview, { where: { entityId, entityType } });
      } else {
        // -------------------------------------------------------------------
        // Step 8a: UPSERT all fetched reviews by review_id
        // -------------------------------------------------------------------
        for (const r of reviews) {
          await qr.manager
            .createQueryBuilder()
            .insert()
            .into(GoogleReview)
            .values({
              entityId,
              entityType,
              authorName: r.authorName,
              rating: r.rating,
              text: r.text,
              reviewUrl: r.reviewUrl,
              reviewDate: r.reviewDate instanceof Date ? r.reviewDate : new Date(r.reviewDate as string),
              reviewId: r.reviewId,
            })
            .orUpdate(
              ['author_name', 'rating', 'text', 'review_url', 'review_date', 'updated_at'],
              ['review_id'],
            )
            .execute();
        }

        // -------------------------------------------------------------------
        // Step 8b: Purge — DELETE google_review WHERE entity + review_id NOT IN
        //          the fetched set. Capture the purge delta for the sync-log.
        // -------------------------------------------------------------------
        const beforeCount = await qr.manager.count(GoogleReview, { where: { entityId, entityType } });

        await qr.manager
          .createQueryBuilder()
          .delete()
          .from(GoogleReview)
          .where(
            'entity_id = :entityId AND entity_type = :entityType AND review_id NOT IN (:...ids)',
            { entityId, entityType, ids: fetchedReviewIds },
          )
          .execute();

        afterCount = await qr.manager.count(GoogleReview, { where: { entityId, entityType } });
        purged = beforeCount - afterCount;
      }

      // ---------------------------------------------------------------------
      // Step 9: Recompute denorm transactionally (T-21-15 mitigate)
      // ---------------------------------------------------------------------
      const denormRow = await this.computeDenorm(entityId, entityType, qr);
      const googleMapsRating = denormRow.avg != null ? parseFloat(denormRow.avg) || null : null;
      const googleMapsReviewsCount = parseInt(denormRow.count, 10) || 0;

      const EntityClass = entityClass(entityType);
      await qr.manager.update(
        EntityClass,
        { id: entityId },
        {
          googleMapsRating,
          googleMapsReviewsCount,
          lastGoogleSyncAt: new Date(),
          lastSyncedMapsUrl: entity.googleMapsUrl ?? null,
        },
      );

      // ---------------------------------------------------------------------
      // Step 10: Commit
      // ---------------------------------------------------------------------
      await qr.commitTransaction();

      // ---------------------------------------------------------------------
      // Step 11: Close sync-log with honest reconciliation semantics.
      // errorMessage is reused as a general context field on the success path
      // (the entity has no dedicated `message` column and the plan prohibits
      // adding a migration). On the error path it carries the actual error string.
      // ---------------------------------------------------------------------
      const reconcileMsg =
        fetchedReviewIds.length === 0
          ? 'reconciliation — 0 reviews purged (zero-result fetch, purge aborted)'
          : `reconciliation — ${purged} reviews purged`;

      syncLog.status = 'success';
      syncLog.endedAt = new Date();
      syncLog.reviewsNew = 0; // reconciliation creates no "new" reviews in owner-facing sense
      syncLog.reviewsTotal = afterCount!; // surviving row count
      syncLog.errorMessage = reconcileMsg; // persists purge context via the existing nullable column
      await this.syncLogRepository.save(syncLog);

      this.logger.log(
        `(reconcile) Completed ${entityType}/${entityId}: ${purged} purged, ${afterCount!} surviving, rating=${googleMapsRating}`,
      );

      return syncLog;
    } catch (error) {
      await qr.rollbackTransaction();

      const errorMessage = `reconcile_error: ${(error as Error)?.message ?? 'unknown error'}`;
      this.logger.error(`(reconcile) Failed for ${entityType}/${entityId}: ${errorMessage}`);

      syncLog.status = 'error';
      syncLog.endedAt = new Date();
      syncLog.errorMessage = errorMessage;
      await this.syncLogRepository.save(syncLog);

      return syncLog;
    } finally {
      await qr.release();
      // Runs after the 202 of the manual sync route: refresh the Google rating in the catalog now.
      this.searchSync.mark(entityType, entityId);
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Loads the business entity (lodging | restaurant | commerce) with
   * `town` and `town.department` relations for PlaceIdResolverService.
   */
  private async loadEntity(
    entityId: string,
    entityType: EntityType,
    qr: ReturnType<DataSource['createQueryRunner']>,
  ): Promise<Lodging | Restaurant | Commerce | null> {
    const relations = ['town', 'town.department'] as const;

    if (entityType === 'lodging') {
      return qr.manager.getRepository(Lodging).findOne({ where: { id: entityId }, relations } as any) ?? null;
    }
    if (entityType === 'restaurant') {
      return qr.manager.getRepository(Restaurant).findOne({ where: { id: entityId }, relations } as any) ?? null;
    }
    return qr.manager.getRepository(Commerce).findOne({ where: { id: entityId }, relations } as any) ?? null;
  }

  /**
   * Computes AVG(rating) and COUNT for the entity's RATED google_review rows
   * inside the current QueryRunner (same transaction as the UPSERT).
   *
   * Only rows with a real star (rating >= 1) are counted/averaged. Some scraped
   * reviews arrive with a NULL star (Apify did not capture it); these are kept
   * for their text but must not inflate `googleMapsReviewsCount`, so the count
   * stays consistent with the distribution chart and the reviews list (all of
   * which exclude unrated rows). AVG already ignored NULLs; the COUNT did not.
   *
   * Returns { avg: null, count: '0' } when no rated rows exist (e.g. after a wipe
   * with zero reviews fetched).
   */
  private async computeDenorm(
    entityId: string,
    entityType: EntityType,
    qr: ReturnType<DataSource['createQueryRunner']>,
  ): Promise<{ avg: string | null; count: string }> {
    const row = await qr.manager
      .createQueryBuilder()
      .select('AVG(gr.rating)', 'avg')
      .addSelect('COUNT(*)', 'count')
      .from(GoogleReview, 'gr')
      .where('gr.entity_id = :entityId AND gr.entity_type = :entityType', { entityId, entityType })
      .andWhere('gr.rating >= 1')
      .getRawOne<{ avg: string | null; count: string }>();
    return row ?? { avg: null, count: '0' };
  }
}
