import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GoogleSyncCronService } from './google-sync-cron.service';
import { GoogleSyncService } from './google-sync.service';
import { DistributedLockService } from 'src/modules/common/services/distributed-lock.service';
import { SubscriptionsService } from 'src/modules/subscriptions/services/subscriptions.service';
import { Lodging } from 'src/modules/lodgings/entities/lodging.entity';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { Commerce } from 'src/modules/commerce/entities/commerce.entity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal chainable QueryBuilder stub for getEligibleIds tests.
 * `getMany` resolves the array passed during setup.
 */
function makeQbStub(entities: any[] = []) {
  const stub: Record<string, jest.Mock> = {};
  const chainMethods = ['select', 'where', 'andWhere'];
  for (const m of chainMethods) {
    stub[m] = jest.fn().mockReturnThis();
  }
  stub['getMany'] = jest.fn().mockResolvedValue(entities);
  return stub;
}

/** Makes a fake sync-log result for syncEntity mock. */
function fakeSyncLog(entityId: string) {
  return { id: `log-${entityId}`, status: 'success', entityId };
}

// Valid Places URL (passes isPlacesGeneratedUrl)
const VALID_URL = 'https://maps.google.com/?cid=123456789';
// Invalid URL (fails isPlacesGeneratedUrl)
const INVALID_URL = 'https://example.com/some-business';

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('GoogleSyncCronService', () => {
  let service: GoogleSyncCronService;
  let lockService: { tryAcquire: jest.Mock; release: jest.Mock };
  let googleSyncService: { syncEntity: jest.Mock };
  let subscriptionsService: { getActiveSubscribedEntityIds: jest.Mock };
  let lodgingRepo: { createQueryBuilder: jest.Mock };
  let restaurantRepo: { createQueryBuilder: jest.Mock };
  let commerceRepo: { createQueryBuilder: jest.Mock };

  async function buildModule() {
    lockService = {
      tryAcquire: jest.fn().mockResolvedValue(true),
      release: jest.fn().mockResolvedValue(undefined),
    };
    googleSyncService = {
      syncEntity: jest.fn().mockImplementation((id: string) => Promise.resolve(fakeSyncLog(id))),
    };
    subscriptionsService = {
      getActiveSubscribedEntityIds: jest.fn().mockResolvedValue(['lodging-sub-01']),
    };

    // Default qb: no entities returned
    lodgingRepo = { createQueryBuilder: jest.fn().mockReturnValue(makeQbStub([])) };
    restaurantRepo = { createQueryBuilder: jest.fn().mockReturnValue(makeQbStub([])) };
    commerceRepo = { createQueryBuilder: jest.fn().mockReturnValue(makeQbStub([])) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleSyncCronService,
        { provide: DistributedLockService, useValue: lockService },
        { provide: GoogleSyncService, useValue: googleSyncService },
        { provide: SubscriptionsService, useValue: subscriptionsService },
        { provide: getRepositoryToken(Lodging), useValue: lodgingRepo },
        { provide: getRepositoryToken(Restaurant), useValue: restaurantRepo },
        { provide: getRepositoryToken(Commerce), useValue: commerceRepo },
      ],
    }).compile();

    service = module.get<GoogleSyncCronService>(GoogleSyncCronService);
  }

  // -------------------------------------------------------------------------
  // Lock guard: when tryAcquire returns false, cron skips without calling syncEntity
  // -------------------------------------------------------------------------
  it('(lock-skip) when tryAcquire returns false, runWeeklySync does NOT call syncEntity', async () => {
    await buildModule();
    lockService.tryAcquire.mockResolvedValue(false);

    // Inject an eligible entity so we can confirm syncEntity is NOT called
    lodgingRepo.createQueryBuilder.mockReturnValue(
      makeQbStub([{ id: 'lodging-001', googleMapsUrl: VALID_URL, lastGoogleSyncAt: null }]),
    );

    await service.runWeeklySync();

    expect(lockService.tryAcquire).toHaveBeenCalledWith(199001);
    expect(googleSyncService.syncEntity).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Lock guard: when acquired, release is called in finally (even if processType throws)
  // -------------------------------------------------------------------------
  it('(lock-release) release is called in finally even if processing throws', async () => {
    await buildModule();
    // Make processType throw by having subscriptionsService reject
    subscriptionsService.getActiveSubscribedEntityIds.mockRejectedValue(new Error('DB error'));

    await service.runWeeklySync();

    expect(lockService.tryAcquire).toHaveBeenCalledWith(199001);
    expect(lockService.release).toHaveBeenCalledWith(199001);
  });

  // -------------------------------------------------------------------------
  // Eligibility: published+isPublic+subscribed with valid URL and null lastGoogleSyncAt IS included
  // -------------------------------------------------------------------------
  it('(eligibility) includes subscribed+published+isPublic with valid URL and null lastGoogleSyncAt', async () => {
    await buildModule();
    const eligibleLodging = {
      id: 'lodging-sub-01',
      googleMapsUrl: VALID_URL,
      lastGoogleSyncAt: null,
    };
    subscriptionsService.getActiveSubscribedEntityIds.mockResolvedValue(['lodging-sub-01']);
    lodgingRepo.createQueryBuilder.mockReturnValue(makeQbStub([eligibleLodging]));

    await service.runWeeklySync();

    expect(googleSyncService.syncEntity).toHaveBeenCalledWith('lodging-sub-01', 'lodging', 'cron');
  });

  // -------------------------------------------------------------------------
  // Eligibility: forcedPublic=true entity is included even if not subscribed
  // -------------------------------------------------------------------------
  it('(eligibility) skips free businesses — forcedPublic without Premium is NOT synced', async () => {
    await buildModule();
    const forcedPublicLodging = {
      id: 'lodging-forced-01',
      googleMapsUrl: VALID_URL,
      lastGoogleSyncAt: null,
    };
    // No subscriptions (free business): Google reviews are a Premium benefit
    subscriptionsService.getActiveSubscribedEntityIds.mockResolvedValue([]);
    lodgingRepo.createQueryBuilder.mockReturnValue(makeQbStub([forcedPublicLodging]));

    await service.runWeeklySync();

    expect(googleSyncService.syncEntity).not.toHaveBeenCalledWith('lodging-forced-01', 'lodging', 'cron');
  });

  // -------------------------------------------------------------------------
  // Eligibility: entity with invalid googleMapsUrl is EXCLUDED (isPlacesGeneratedUrl fails)
  // -------------------------------------------------------------------------
  it('(eligibility) excludes entity with invalid googleMapsUrl (fails isPlacesGeneratedUrl)', async () => {
    await buildModule();
    const invalidUrlLodging = {
      id: 'lodging-bad-url',
      googleMapsUrl: INVALID_URL,
      lastGoogleSyncAt: null,
    };
    lodgingRepo.createQueryBuilder.mockReturnValue(makeQbStub([invalidUrlLodging]));

    await service.runWeeklySync();

    expect(googleSyncService.syncEntity).not.toHaveBeenCalledWith('lodging-bad-url', 'lodging', 'cron');
  });

  // -------------------------------------------------------------------------
  // Eligibility: entity synced within last 24h is EXCLUDED (handled by SQL stale gate)
  // The SQL gate (lastGoogleSyncAt < threshold) is the actual filter;
  // here we verify that if the DB returns no entities (fresh sync), syncEntity is not called.
  // -------------------------------------------------------------------------
  it('(eligibility) excludes entity with lastGoogleSyncAt 1 hour ago (stale gate)', async () => {
    await buildModule();
    // Simulate the SQL gate doing its job: if recently synced, the DB returns no entities
    lodgingRepo.createQueryBuilder.mockReturnValue(makeQbStub([]));
    // (The SQL stale condition filters out recently-synced entities before getMany)

    await service.runWeeklySync();

    expect(googleSyncService.syncEntity).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Eligibility: when subscribedIds is empty, query uses only forcedPublic branch (no In([]))
  // -------------------------------------------------------------------------
  it('(eligibility) when subscribedIds is empty, no query is built (Premium only)', async () => {
    await buildModule();
    subscriptionsService.getActiveSubscribedEntityIds.mockResolvedValue([]);

    await service.runWeeklySync();

    expect(lodgingRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('(eligibility) restricts the query to Premium ids that are publicly visible', async () => {
    await buildModule();
    subscriptionsService.getActiveSubscribedEntityIds.mockResolvedValue(['lodging-001']);
    const qbStub = makeQbStub([]);
    lodgingRepo.createQueryBuilder.mockReturnValue(qbStub);

    await service.runWeeklySync();

    expect(qbStub.where).toHaveBeenCalledWith('e.id IN (:...ids)', { ids: ['lodging-001'] });
    expect(qbStub.andWhere).toHaveBeenCalledWith(
      '((e.status = :status AND e.isPublic = true) OR e.forcedPublic = true)',
      { status: 'published' },
    );
  });

  // -------------------------------------------------------------------------
  // Sequential processing: each eligible entity is processed via syncEntity exactly once
  // -------------------------------------------------------------------------
  it('(sequential) each eligible entity is processed via syncEntity(id, type, cron) exactly once', async () => {
    await buildModule();
    const entities = [
      { id: 'lodging-001', googleMapsUrl: VALID_URL, lastGoogleSyncAt: null },
      { id: 'lodging-002', googleMapsUrl: VALID_URL, lastGoogleSyncAt: null },
    ];
    subscriptionsService.getActiveSubscribedEntityIds.mockResolvedValue(['lodging-001', 'lodging-002']);
    lodgingRepo.createQueryBuilder.mockReturnValue(makeQbStub(entities));

    await service.runWeeklySync();

    expect(googleSyncService.syncEntity).toHaveBeenCalledTimes(2);
    expect(googleSyncService.syncEntity).toHaveBeenCalledWith('lodging-001', 'lodging', 'cron');
    expect(googleSyncService.syncEntity).toHaveBeenCalledWith('lodging-002', 'lodging', 'cron');
  });
});
