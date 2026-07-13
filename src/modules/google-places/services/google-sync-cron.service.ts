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
 * GoogleSyncCronService (SYNC-02) — weekly Monday 3 AM (America/Bogota) cron.
 *
 * Selects publicly-visible, valid-URL, stale businesses across lodging/restaurant/commerce
 * and syncs each via GoogleSyncService.syncEntity(id, type, 'cron').
 *
 * Cost-control decisions (D-01 to D-04 from CONTEXT.md):
 *  - D-01: Only publicly-visible businesses (published+isPublic+subscribed OR forcedPublic).
 *  - D-02: Only businesses with a valid googleMapsUrl + stale >24h.
 *  - D-03: Weekly Monday cadence, America/Bogota timezone, anti-overlap advisory lock.
 *  - D-04: Apify spend control — never sync drafts/unsubscribed/URL-less businesses.
 *
 * Threat mitigations:
 *  - T-21-05: advisory lock guard (tryAcquire 199001 + waitForCompletion:true).
 *  - T-21-06: sequential for…of loop (no parallel Apify saturation).
 *  - T-21-07: empty subscribedIds guard (avoids invalid IN() SQL).
 *  - T-21-08: timeZone: 'America/Bogota' (avoids Railway UTC mismatch).
 */
@Injectable()
export class GoogleSyncCronService {
  private readonly logger = new Logger(GoogleSyncCronService.name);

  /** Postgres advisory lock key — unique, stable integer. Must not collide with other advisory locks. */
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
   * Fires every Monday at 3:00 AM America/Bogota.
   *
   * 1. Acquires the advisory lock — skips if another instance holds it.
   * 2. Processes each entity type (lodging → restaurant → commerce) sequentially.
   * 3. Releases the lock in `finally` (even on error).
   */
  @Cron('0 3 * * 1', {
    name: 'google-sync-weekly',
    timeZone: 'America/Bogota',
    waitForCompletion: true,
  })
  async runWeeklySync(): Promise<void> {
    // Kill-switch por env (Railway) — apaga el gasto de Apify sin redeploy. Default: encendido.
    if (process.env.GOOGLE_CRONS_ENABLED === 'false') {
      this.logger.warn('(google-sync-cron) deshabilitado por GOOGLE_CRONS_ENABLED=false — saltando');
      return;
    }

    const acquired = await this.lockService.tryAcquire(GoogleSyncCronService.LOCK_KEY);
    if (!acquired) {
      this.logger.warn('(google-sync-cron) advisory lock not acquired — another instance running, skipping');
      return;
    }

    try {
      for (const type of ['lodging', 'restaurant', 'commerce'] as const) {
        await this.processType(type);
      }
    } catch (error) {
      this.logger.error(`(google-sync-cron) batch failed: ${(error as Error).message}`);
    } finally {
      await this.lockService.release(GoogleSyncCronService.LOCK_KEY);
    }
  }

  // ---------------------------------------------------------------------------
  // Per-type processing
  // ---------------------------------------------------------------------------

  /**
   * Fetches eligible IDs for the given entity type and syncs each one sequentially.
   * Per-entity try/catch ensures one failure does not abort the whole batch (T-21-06 / Pitfall 8).
   */
  private async processType(type: EntityType): Promise<void> {
    const ids = await this.getEligibleIds(type);
    this.logger.log(`(google-sync-cron) ${type}: ${ids.length} eligible`);

    for (const id of ids) {
      try {
        await this.googleSyncService.syncEntity(id, type, 'cron');
      } catch (error) {
        // syncEntity never throws in practice (writes status='error' to log), but guard anyway.
        this.logger.error(`(google-sync-cron) unexpected error syncing ${type}/${id}: ${(error as Error).message}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Eligibility query
  // ---------------------------------------------------------------------------

  /**
   * Returns entity IDs eligible for cron sync:
   *  1. Publicly-visible: (published+isPublic+subscribed) OR forcedPublic
   *  2. Stale: lastGoogleSyncAt IS NULL OR < 24h ago
   *  3. Valid Places URL: filtered in-memory via isPlacesGeneratedUrl
   *
   * Only `id`, `googleMapsUrl`, `lastGoogleSyncAt` are selected (minimal load — avoids relations).
   * Empty-subscribedIds guard: uses forcedPublic-only WHERE branch to avoid invalid IN([]) SQL (T-21-07).
   */
  private async getEligibleIds(type: EntityType): Promise<string[]> {
    const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const subscribedIds = await this.subscriptionsService.getActiveSubscribedEntityIds(type);

    const repo = this.repoFor(type);

    let qb = repo
      .createQueryBuilder('e')
      .select(['e.id', 'e.googleMapsUrl', 'e.lastGoogleSyncAt']);

    // Visibility predicate (mirrors lodgings.service.ts ~209-226 — T-21-07 empty-In guard)
    if (subscribedIds.length > 0) {
      qb = qb.where(
        '(e.status = :status AND e.isPublic = true AND e.id IN (:...ids)) OR e.forcedPublic = true',
        { status: 'published', ids: subscribedIds },
      );
    } else {
      qb = qb.where('e.forcedPublic = true');
    }

    // Stale gate — SQL filter (efficient; only bring entities not synced in last 24h)
    qb = qb.andWhere('(e.lastGoogleSyncAt IS NULL OR e.lastGoogleSyncAt < :threshold)', {
      threshold: staleThreshold,
    });

    const entities = await qb.getMany();

    // URL gate — TypeScript logic, applied in-memory (cannot be expressed purely in SQL)
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
