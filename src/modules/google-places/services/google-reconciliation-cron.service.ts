import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Lodging } from 'src/modules/lodgings/entities/lodging.entity';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { Commerce } from 'src/modules/commerce/entities/commerce.entity';
import { DistributedLockService } from 'src/modules/common/services/distributed-lock.service';
import { SubscriptionsService } from 'src/modules/subscriptions/services/subscriptions.service';
import { GoogleSyncService } from './google-sync.service';
import { isPlacesGeneratedUrl } from './place-id-resolver.service';

type EntityType = 'lodging' | 'restaurant' | 'commerce';

/**
 * GoogleReconciliationCronService (SYNC-06) — monthly 1st @ 3 AM (America/Bogota) cron.
 *
 * Performs a full-correctness sweep across ALL publicly-visible, URL-having businesses.
 * Unlike the weekly cron, this is NOT subject to the 24h stale gate — every eligible
 * business is reconciled monthly regardless of when it was last synced.
 *
 * Each business is processed via GoogleSyncService.reconcileEntity(id, type) which:
 *  - Does a FULL fetch from Apify (since=null)
 *  - UPSERTs all fetched reviews
 *  - Purges google_review rows absent from the fetch (prevents inflated ghost counts)
 *  - Recomputes googleMapsRating/googleMapsReviewsCount transactionally
 *  - Aborts the purge if Apify returns 0 reviews (zero-result guard, T-21-14)
 *
 * Cost-control decisions:
 *  - D-01: Only publicly-visible businesses (published+isPublic+subscribed OR forcedPublic)
 *  - D-04: Apify spend control — URL-less or non-public businesses never trigger a full fetch
 *  - D-11: Monthly cadence (not weekly) — full fetch is pricier than incremental
 *
 * Threat mitigations:
 *  - T-21-14: zero-result abort guard lives in reconcileEntity
 *  - T-21-15: purge + denorm in same QueryRunner transaction (in reconcileEntity)
 *  - T-21-16: SAME advisory lock key 199001 as the weekly cron — both croons never overlap
 *  - T-21-17: same public-visible + valid-URL eligibility (minus stale gate)
 */
@Injectable()
export class GoogleReconciliationCronService {
  private readonly logger = new Logger(GoogleReconciliationCronService.name);

  /**
   * Postgres advisory lock key — SAME as GoogleSyncCronService.LOCK_KEY (199001).
   * Sharing the key ensures the weekly and monthly croons never overlap each other.
   */
  private static readonly LOCK_KEY = 199001;

  constructor(
    @InjectRepository(Lodging)
    private readonly lodgingRepo: Repository<Lodging>,
    @InjectRepository(Restaurant)
    private readonly restaurantRepo: Repository<Restaurant>,
    @InjectRepository(Commerce)
    private readonly commerceRepo: Repository<Commerce>,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly googleSyncService: GoogleSyncService,
    private readonly lockService: DistributedLockService,
  ) {}

  // ---------------------------------------------------------------------------
  // Cron entry point
  // ---------------------------------------------------------------------------

  /**
   * Fires on the 1st of every month at 3:00 AM America/Bogota.
   *
   * 1. Acquires the shared advisory lock — skips if another instance/cron holds it.
   * 2. Processes each entity type (lodging → restaurant → commerce) sequentially.
   * 3. Releases the lock in `finally` (even on error).
   */
  @Cron('0 3 1 * *', {
    name: 'google-reconciliation-monthly',
    timeZone: 'America/Bogota',
    waitForCompletion: true,
  })
  async runMonthly(): Promise<void> {
    // Kill-switch por env (Railway) — apaga el gasto de Apify sin redeploy. Default: encendido.
    if (process.env.GOOGLE_CRONS_ENABLED === 'false') {
      this.logger.warn('(google-reconciliation-cron) deshabilitado por GOOGLE_CRONS_ENABLED=false — saltando');
      return;
    }

    const acquired = await this.lockService.tryAcquire(GoogleReconciliationCronService.LOCK_KEY);
    if (!acquired) {
      this.logger.warn(
        '(google-reconciliation-cron) advisory lock not acquired — another instance running, skipping',
      );
      return;
    }

    try {
      for (const type of ['lodging', 'restaurant', 'commerce'] as const) {
        await this.processType(type);
      }
    } catch (error) {
      this.logger.error(`(google-reconciliation-cron) batch failed: ${(error as Error).message}`);
    } finally {
      await this.lockService.release(GoogleReconciliationCronService.LOCK_KEY);
    }
  }

  // ---------------------------------------------------------------------------
  // Per-type processing
  // ---------------------------------------------------------------------------

  /**
   * Fetches eligible IDs for the given entity type and reconciles each one sequentially.
   * Per-entity try/catch ensures one failure does not abort the whole batch.
   *
   * NOTE: reconcileEntity never throws in practice (writes status='error' to log),
   * but the guard is kept for correctness parity with the weekly cron.
   */
  private async processType(type: EntityType): Promise<void> {
    const ids = await this.getEligibleIds(type);
    this.logger.log(`(google-reconciliation-cron) ${type}: ${ids.length} eligible for reconciliation`);

    for (const id of ids) {
      try {
        await this.googleSyncService.reconcileEntity(id, type);
      } catch (error) {
        this.logger.error(
          `(google-reconciliation-cron) unexpected error reconciling ${type}/${id}: ${(error as Error).message}`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Eligibility query (no stale gate — reconciliation is a full correctness sweep)
  // ---------------------------------------------------------------------------

  /**
   * Returns entity IDs eligible for monthly reconciliation:
   *  1. Publicly-visible: (published+isPublic+subscribed) OR forcedPublic
   *  2. Valid Places URL: filtered in-memory via isPlacesGeneratedUrl
   *
   * DELIBERATELY omits the stale gate (lastGoogleSyncAt < 24h) — reconciliation
   * processes ALL eligible businesses regardless of last-sync time (D-11).
   *
   * Empty-subscribedIds guard: uses forcedPublic-only WHERE branch to avoid
   * invalid IN([]) SQL (T-21-07 mitigate).
   */
  private async getEligibleIds(type: EntityType): Promise<string[]> {
    const subscribedIds = await this.subscriptionsService.getActiveSubscribedEntityIds(type);

    const repo = this.repoFor(type);

    let qb = repo
      .createQueryBuilder('e')
      .select(['e.id', 'e.googleMapsUrl']);

    // Visibility predicate (mirrors lodgings.service.ts — T-21-07 empty-In guard)
    if (subscribedIds.length > 0) {
      qb = qb.where(
        '(e.status = :status AND e.isPublic = true AND e.id IN (:...ids)) OR e.forcedPublic = true',
        { status: 'published', ids: subscribedIds },
      );
    } else {
      qb = qb.where('e.forcedPublic = true');
    }

    // NO stale gate — reconciliation is a monthly full-correctness sweep (D-11)

    const entities = await qb.getMany();

    // URL gate — isPlacesGeneratedUrl is TypeScript logic, applied in-memory
    return entities
      .filter((e) => isPlacesGeneratedUrl(e.googleMapsUrl))
      .map((e) => e.id);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private repoFor(type: EntityType): Repository<Lodging> | Repository<Restaurant> | Repository<Commerce> {
    if (type === 'lodging') return this.lodgingRepo;
    if (type === 'restaurant') return this.restaurantRepo;
    return this.commerceRepo;
  }
}
