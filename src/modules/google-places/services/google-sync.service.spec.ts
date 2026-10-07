import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GoogleSyncService } from './google-sync.service';
import { GoogleReviewSyncLog } from '../entities/google-review-sync-log.entity';
import { PlaceIdResolverService } from './place-id-resolver.service';
import { GOOGLE_REVIEWS_SOURCE } from '../interfaces/google-reviews-source.interface';
import { Lodging } from 'src/modules/lodgings/entities/lodging.entity';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { Commerce } from 'src/modules/commerce/entities/commerce.entity';
import { GoogleReview } from '../entities/google-review.entity';
import { SearchSyncQueue } from 'src/modules/search/search-sync.queue';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLodging(overrides: Partial<Lodging> = {}): Lodging {
  return {
    id: 'entity-001',
    name: 'Hotel Test',
    googleMapsId: 'ChIJtest',
    googleMapsUrl: 'https://maps.google.com/?cid=123',
    lastGoogleSyncAt: null,
    town: {
      name: 'San Carlos',
      department: { name: 'Antioquia' } as any,
    } as any,
    ...overrides,
  } as Lodging;
}

/** Builds a minimal chainable QueryBuilder stub that includes all methods used in the service. */
function makeQbStub() {
  const stub: Record<string, jest.Mock> = {};
  const methods = [
    'insert', 'into', 'values', 'orUpdate', 'execute',
    'select', 'addSelect', 'from', 'where', 'andWhere', 'setParameter',
  ];
  for (const m of methods) {
    stub[m] = jest.fn().mockReturnThis();
  }
  // getRawOne resolves to an avg/count result by default
  stub['getRawOne'] = jest.fn().mockResolvedValue({ avg: '4.5', count: '10' });
  return stub;
}

/**
 * Builds a minimal QueryRunner mock.
 * `entityOverride` controls what `qr.manager.getRepository(...).findOne(...)` returns,
 * allowing each test to inject the correct entity (e.g. with or without lastGoogleSyncAt).
 */
function makeQrMock(entityOverride?: Lodging) {
  const qb = makeQbStub();
  const manager = {
    delete: jest.fn().mockResolvedValue({ affected: 5 }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    getRepository: jest.fn().mockImplementation(() => ({
      findOne: jest.fn().mockResolvedValue(entityOverride ?? makeLodging()),
    })),
  };
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    manager,
    _qb: qb,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GoogleSyncService', () => {
  let service: GoogleSyncService;
  let syncLogRepo: { save: jest.Mock; create: jest.Mock };
  let placeIdResolver: { resolve: jest.Mock; placeIdToMapsUrl: jest.Mock };
  let source: { fetchReviews: jest.Mock };
  let dataSource: { createQueryRunner: jest.Mock };
  let lodgingRepo: { findOne: jest.Mock };
  let restaurantRepo: { findOne: jest.Mock };
  let commerceRepo: { findOne: jest.Mock };

  /** Re-creates the module with a custom QR mock; returns the shared QR for assertions. */
  async function buildModule(entityOverride?: Lodging): Promise<ReturnType<typeof makeQrMock>> {
    syncLogRepo = {
      save: jest.fn().mockImplementation((entity: any) => Promise.resolve({ id: 'log-uuid-001', status: 'running', ...entity })),
      create: jest.fn().mockImplementation((dto: any) => ({ id: 'log-uuid-001', ...dto })),
    };

    placeIdResolver = {
      resolve: jest.fn().mockResolvedValue('ChIJresolved'),
      placeIdToMapsUrl: jest.fn().mockReturnValue('https://www.google.com/maps/place/?q=place_id:ChIJresolved'),
    };

    source = {
      fetchReviews: jest.fn().mockResolvedValue([
        {
          reviewId: 'r1',
          authorName: 'Alice',
          rating: 5,
          text: 'Great!',
          reviewUrl: 'https://g.co/r1',
          reviewDate: new Date('2025-01-01'),
        },
        {
          reviewId: 'r2',
          authorName: 'Bob',
          rating: 4,
          text: 'Nice',
          reviewUrl: 'https://g.co/r2',
          reviewDate: new Date('2025-01-02'),
        },
      ]),
    };

    lodgingRepo = { findOne: jest.fn().mockResolvedValue(entityOverride ?? makeLodging()) };
    restaurantRepo = { findOne: jest.fn().mockResolvedValue(null) };
    commerceRepo = { findOne: jest.fn().mockResolvedValue(null) };

    const qrMock = makeQrMock(entityOverride);
    dataSource = { createQueryRunner: jest.fn().mockReturnValue(qrMock) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleSyncService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(GoogleReviewSyncLog), useValue: syncLogRepo },
        { provide: getRepositoryToken(Lodging), useValue: lodgingRepo },
        { provide: getRepositoryToken(Restaurant), useValue: restaurantRepo },
        { provide: getRepositoryToken(Commerce), useValue: commerceRepo },
        { provide: PlaceIdResolverService, useValue: placeIdResolver },
        { provide: GOOGLE_REVIEWS_SOURCE, useValue: source },
        { provide: SearchSyncQueue, useValue: { mark: jest.fn() } },
      ],
    }).compile();

    service = module.get<GoogleSyncService>(GoogleSyncService);
    return qrMock;
  }

  // -------------------------------------------------------------------------
  // Test: first sync — wipe + full pull
  // -------------------------------------------------------------------------
  it('(first sync) deletes existing reviews AND calls fetchReviews with since === null', async () => {
    const entity = makeLodging({ lastGoogleSyncAt: null });
    const qr = await buildModule(entity);

    await service.syncEntity('entity-001', 'lodging', 'manual');

    // delete must have been called with the entity coords
    expect(qr.manager.delete).toHaveBeenCalledWith(
      GoogleReview,
      expect.objectContaining({ entityId: 'entity-001', entityType: 'lodging' }),
    );

    // fetchReviews `since` arg must be null for first sync
    expect(source.fetchReviews).toHaveBeenCalledWith(
      expect.any(String),
      null,
    );
  });

  // -------------------------------------------------------------------------
  // Test: incremental sync — no wipe, cursor forwarded
  // -------------------------------------------------------------------------
  it('(incremental) does NOT delete reviews AND passes entity.lastGoogleSyncAt as since', async () => {
    const lastSync = new Date('2025-06-01T00:00:00Z');
    const entity = makeLodging({ lastGoogleSyncAt: lastSync });
    const qr = await buildModule(entity);

    await service.syncEntity('entity-001', 'lodging', 'cron');

    // delete must NOT have been called
    expect(qr.manager.delete).not.toHaveBeenCalled();

    // fetchReviews must receive the lastGoogleSyncAt date
    expect(source.fetchReviews).toHaveBeenCalledWith(
      expect.any(String),
      lastSync,
    );
  });

  // -------------------------------------------------------------------------
  // Test: place URL changed — force full resync (wipe + since=null) even though
  //       lastGoogleSyncAt is set (the owner re-pointed to a different place).
  // -------------------------------------------------------------------------
  it('(url changed) wipes reviews AND fetches with since=null when googleMapsUrl differs from lastSyncedMapsUrl', async () => {
    const entity = makeLodging({
      lastGoogleSyncAt: new Date('2025-06-01T00:00:00Z'),
      googleMapsUrl: 'https://maps.google.com/?cid=999', // new place
      lastSyncedMapsUrl: 'https://maps.google.com/?cid=123', // previously synced place
    });
    const qr = await buildModule(entity);

    await service.syncEntity('entity-001', 'lodging', 'manual');

    // wipe must happen despite lastGoogleSyncAt being set
    expect(qr.manager.delete).toHaveBeenCalledWith(
      GoogleReview,
      expect.objectContaining({ entityId: 'entity-001', entityType: 'lodging' }),
    );
    // full (non-incremental) pull from the new place
    expect(source.fetchReviews).toHaveBeenCalledWith(expect.any(String), null);
  });

  // -------------------------------------------------------------------------
  // Test: same URL → stays incremental (no wipe) — guards against over-wiping
  //       when the place has not changed.
  // -------------------------------------------------------------------------
  it('(url unchanged) does NOT wipe when lastSyncedMapsUrl equals current googleMapsUrl', async () => {
    const lastSync = new Date('2025-06-01T00:00:00Z');
    const entity = makeLodging({
      lastGoogleSyncAt: lastSync,
      googleMapsUrl: 'https://maps.google.com/?cid=123',
      lastSyncedMapsUrl: 'https://maps.google.com/?cid=123',
    });
    const qr = await buildModule(entity);

    await service.syncEntity('entity-001', 'lodging', 'cron');

    expect(qr.manager.delete).not.toHaveBeenCalled();
    expect(source.fetchReviews).toHaveBeenCalledWith(expect.any(String), lastSync);
  });

  // -------------------------------------------------------------------------
  // Test: same place, noisy URL — the volatile &g_mp param must NOT trigger a
  //       wipe (compare by stable place key, not raw string).
  // -------------------------------------------------------------------------
  it('(url noise) same cid with different g_mp param does NOT wipe', async () => {
    const lastSync = new Date('2025-06-01T00:00:00Z');
    const entity = makeLodging({
      lastGoogleSyncAt: lastSync,
      googleMapsUrl: 'https://maps.google.com/?cid=123&g_mp=NEWNOISE',
      lastSyncedMapsUrl: 'https://maps.google.com/?cid=123&g_mp=OLDNOISE',
    });
    const qr = await buildModule(entity);

    await service.syncEntity('entity-001', 'lodging', 'cron');

    expect(qr.manager.delete).not.toHaveBeenCalled();
    expect(source.fetchReviews).toHaveBeenCalledWith(expect.any(String), lastSync);
  });

  // -------------------------------------------------------------------------
  // Test: success update records lastSyncedMapsUrl so the NEXT sync can detect
  //       a future place swap.
  // -------------------------------------------------------------------------
  it('(records source url) entity update sets lastSyncedMapsUrl to the synced googleMapsUrl', async () => {
    const entity = makeLodging({ googleMapsUrl: 'https://maps.google.com/?cid=123' });
    const qr = await buildModule(entity);

    await service.syncEntity('entity-001', 'lodging', 'manual');

    expect(qr.manager.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'entity-001' }),
      expect.objectContaining({ lastSyncedMapsUrl: 'https://maps.google.com/?cid=123' }),
    );
  });

  // -------------------------------------------------------------------------
  // Test: success log — trigger echoed, reviewsTotal, last_google_sync_at
  // -------------------------------------------------------------------------
  it('(success log) saves sync-log with status=success and sets last_google_sync_at on entity', async () => {
    const qr = await buildModule();

    await service.syncEntity('entity-001', 'lodging', 'manual');

    // The second save call on syncLogRepo should be the success closure
    const saves = syncLogRepo.save.mock.calls;
    const successSave = saves.find((call: any[]) => call[0]?.status === 'success');
    expect(successSave).toBeDefined();
    expect(successSave![0]).toMatchObject({
      status: 'success',
      trigger: 'manual',
    });

    // entity update must have been called with lastGoogleSyncAt
    expect(qr.manager.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'entity-001' }),
      expect.objectContaining({ lastGoogleSyncAt: expect.any(Date) }),
    );
  });

  // -------------------------------------------------------------------------
  // Test: denorm — rating/reviewsCount derived from AVG/COUNT query
  // -------------------------------------------------------------------------
  it('(denorm) updates entity with googleMapsRating and googleMapsReviewsCount from AVG/COUNT', async () => {
    // QR mock getRawOne returns avg=4.5, count=10 by default
    const qr = await buildModule();

    await service.syncEntity('entity-001', 'lodging', 'cron');

    expect(qr.manager.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'entity-001' }),
      expect.objectContaining({
        googleMapsRating: 4.5,
        googleMapsReviewsCount: 10,
      }),
    );

    // denorm count/avg must exclude unrated reviews (rating >= 1) so the stored
    // count matches Google + the distribution chart + the reviews list
    expect(qr._qb.andWhere).toHaveBeenCalledWith('gr.rating >= 1');
  });

  // -------------------------------------------------------------------------
  // Test: place_id resolve failure is NON-BLOCKING — sync still succeeds
  //       because the fetch uses the validated googleMapsUrl directly.
  // -------------------------------------------------------------------------
  it('(resolver non-blocking) resolver rejection does NOT fail the sync; still fetches and succeeds', async () => {
    const qr = await buildModule();

    // Override resolver to reject after module is built
    placeIdResolver.resolve.mockRejectedValue(new Error('place_id_not_resolvable'));

    const result = await service.syncEntity('entity-001', 'lodging', 'manual');

    // fetch still happened (uses entity.googleMapsUrl)
    expect(source.fetchReviews).toHaveBeenCalled();
    // committed, not rolled back
    expect(qr.commitTransaction).toHaveBeenCalled();
    expect(qr.rollbackTransaction).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'success' });
  });

  // -------------------------------------------------------------------------
  // Test: URL gate — entity without a valid Places URL is SKIPPED (discarded).
  // -------------------------------------------------------------------------
  it('(skip) entity with missing/invalid googleMapsUrl → status=skipped, no fetch, no rating mutation', async () => {
    const entity = makeLodging({ googleMapsUrl: 'https://booking.com/hotel-xyz' as any });
    const qr = await buildModule(entity);

    const result = await service.syncEntity('entity-001', 'lodging', 'manual');

    // discarded: Apify never called, rating/count never updated
    expect(source.fetchReviews).not.toHaveBeenCalled();
    expect(qr.manager.update).not.toHaveBeenCalled();
    expect(qr.rollbackTransaction).toHaveBeenCalled();

    // sync-log saved with status='skipped'
    const skippedSave = syncLogRepo.save.mock.calls.find((c: any[]) => c[0]?.status === 'skipped');
    expect(skippedSave).toBeDefined();
    expect(result).toMatchObject({ status: 'skipped' });
  });

  it('(skip) entity with null googleMapsUrl is also skipped', async () => {
    const entity = makeLodging({ googleMapsUrl: null as any });
    await buildModule(entity);

    const result = await service.syncEntity('entity-001', 'lodging', 'manual');

    expect(source.fetchReviews).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'skipped' });
  });

  // -------------------------------------------------------------------------
  // Test: error path (fetch throws) → rollback + error log, no rating mutation.
  // -------------------------------------------------------------------------
  it('(error path) fetchReviews failure rolls back and saves error log; no rating mutation', async () => {
    const qr = await buildModule();

    source.fetchReviews.mockRejectedValue(new Error('apify timeout'));

    const result = await service.syncEntity('entity-001', 'lodging', 'manual');

    expect(qr.rollbackTransaction).toHaveBeenCalled();
    const errorSave = syncLogRepo.save.mock.calls.find((c: any[]) => c[0]?.status === 'error');
    expect(errorSave).toBeDefined();
    expect(errorSave![0].errorMessage).toMatch(/sync_error/);
    expect(qr.manager.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'error' });
  });
});

// ---------------------------------------------------------------------------
// reconcileEntity tests
// ---------------------------------------------------------------------------

describe('GoogleSyncService.reconcileEntity', () => {
  let service: GoogleSyncService;
  let syncLogRepo: { save: jest.Mock; create: jest.Mock };
  let placeIdResolver: { resolve: jest.Mock };
  let source: { fetchReviews: jest.Mock };
  let dataSource: { createQueryRunner: jest.Mock };

  /**
   * Builds a QR mock for reconcileEntity tests.
   *
   * createQueryBuilder returns a smart dispatcher stub: the first method called
   * on the returned object routes to the appropriate tracked sub-stub:
   *   - .insert()  → insertQb  (UPSERT loop — multiple calls, one per review)
   *   - .delete()  → deleteQb  (purge — exactly one call)
   *   - .select()  → selectQb  (computeDenorm — exactly one call)
   *
   * `beforeCount` and `afterCount` control the count() calls (purge delta).
   */
  function makeReconcileQrMock(opts: {
    entity?: Partial<Lodging>;
    beforeCount?: number;
    afterCount?: number;
  } = {}) {
    const { beforeCount = 3, afterCount = 2 } = opts;

    // Insert QueryBuilder stub (UPSERT loop per review)
    const insertQb: Record<string, jest.Mock> = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orUpdate: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ generatedMaps: [] }),
    };

    // Delete QueryBuilder stub — the purge operation we assert on
    const deleteQb: Record<string, jest.Mock> = {
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: beforeCount - afterCount }),
    };

    // Select QueryBuilder stub (computeDenorm AVG/COUNT)
    const selectQb: Record<string, jest.Mock> = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ avg: '4.2', count: String(afterCount) }),
    };

    /**
     * Dispatcher stub: proxied so that the first method call routes to the
     * correct specialized stub and all subsequent calls on that chain remain
     * on the same stub. This mirrors how a real TypeORM QB works.
     */
    function makeDispatcherQb() {
      const dispatcher: Record<string, jest.Mock> = {
        insert: jest.fn().mockImplementation((...args: any[]) => {
          insertQb.insert(...args);
          return insertQb;
        }),
        delete: jest.fn().mockImplementation((...args: any[]) => {
          deleteQb.delete(...args);
          return deleteQb;
        }),
        select: jest.fn().mockImplementation((...args: any[]) => {
          selectQb.select(...args);
          return selectQb;
        }),
      };
      return dispatcher;
    }

    // count() mock: returns beforeCount first time, afterCount second time
    let countCallIndex = 0;
    const count = jest.fn().mockImplementation(() => {
      countCallIndex++;
      return Promise.resolve(countCallIndex === 1 ? beforeCount : afterCount);
    });

    const entity = makeLodging({
      lastGoogleSyncAt: new Date('2025-06-01'),
      ...opts.entity,
    });

    const manager = {
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      count,
      createQueryBuilder: jest.fn().mockImplementation(() => makeDispatcherQb()),
      getRepository: jest.fn().mockImplementation(() => ({
        findOne: jest.fn().mockResolvedValue(entity),
      })),
    };

    return {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager,
      _insertQb: insertQb,
      _deleteQb: deleteQb,
      _selectQb: selectQb,
    };
  }

  async function buildReconcileModule(qrMock: ReturnType<typeof makeReconcileQrMock>) {
    syncLogRepo = {
      save: jest.fn().mockImplementation((entity: any) =>
        Promise.resolve({ id: 'log-uuid-reconcile', status: 'running', ...entity }),
      ),
      create: jest.fn().mockImplementation((dto: any) => ({ id: 'log-uuid-reconcile', ...dto })),
    };

    placeIdResolver = {
      resolve: jest.fn().mockResolvedValue('ChIJresolved'),
    };

    source = {
      fetchReviews: jest.fn().mockResolvedValue([
        { reviewId: 'r1', authorName: 'Alice', rating: 5, text: 'Great!', reviewUrl: 'https://g.co/r1', reviewDate: new Date('2025-01-01') },
        { reviewId: 'r3', authorName: 'Charlie', rating: 4, text: 'OK', reviewUrl: 'https://g.co/r3', reviewDate: new Date('2025-01-03') },
      ]),
    };

    dataSource = { createQueryRunner: jest.fn().mockReturnValue(qrMock) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleSyncService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(GoogleReviewSyncLog), useValue: syncLogRepo },
        { provide: getRepositoryToken(Lodging), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(Restaurant), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(Commerce), useValue: { findOne: jest.fn() } },
        { provide: PlaceIdResolverService, useValue: placeIdResolver },
        { provide: GOOGLE_REVIEWS_SOURCE, useValue: source },
        { provide: SearchSyncQueue, useValue: { mark: jest.fn() } },
      ],
    }).compile();

    service = module.get<GoogleSyncService>(GoogleSyncService);
  }

  // -------------------------------------------------------------------------
  // Test: full fetch — fetchReviews called with since = null
  // -------------------------------------------------------------------------
  it('(full fetch) reconcileEntity calls fetchReviews with since = null regardless of lastGoogleSyncAt', async () => {
    const qrMock = makeReconcileQrMock({
      entity: { lastGoogleSyncAt: new Date('2025-06-01') },
    });
    await buildReconcileModule(qrMock);

    await service.reconcileEntity('entity-001', 'lodging');

    expect(source.fetchReviews).toHaveBeenCalledWith(
      expect.any(String),
      null,
    );
  });

  // -------------------------------------------------------------------------
  // Test: purge — DELETE NOT IN fetched review IDs
  // -------------------------------------------------------------------------
  it('(purge) issues a NOT IN delete for reviews absent from the full fetch', async () => {
    const qrMock = makeReconcileQrMock({ beforeCount: 3, afterCount: 2 });
    await buildReconcileModule(qrMock);

    // source returns r1 and r3 (r2 is absent — should be purged)
    await service.reconcileEntity('entity-001', 'lodging');

    // delete().from().where() must have been called
    expect(qrMock._deleteQb.delete).toHaveBeenCalled();
    expect(qrMock._deleteQb.from).toHaveBeenCalledWith(GoogleReview);
    // The where clause must reference NOT IN and the fetched IDs
    const whereCall = qrMock._deleteQb.where.mock.calls[0];
    expect(whereCall[0]).toMatch(/NOT IN/);
    // IDs parameter must contain r1 and r3 (the fetched reviewIds)
    expect(whereCall[1]).toMatchObject({ ids: expect.arrayContaining(['r1', 'r3']) });
  });

  // -------------------------------------------------------------------------
  // Test: zero-result abort — no purge delete when fetch returns empty
  // -------------------------------------------------------------------------
  it('(zero-result abort) when fetchReviews returns [], the purge DELETE is NOT issued', async () => {
    const qrMock = makeReconcileQrMock({ beforeCount: 5, afterCount: 5 });
    await buildReconcileModule(qrMock);

    // Override source to return empty array
    source.fetchReviews.mockResolvedValue([]);

    await service.reconcileEntity('entity-001', 'lodging');

    // The delete() method on the delete QB must NOT have been called
    expect(qrMock._deleteQb.delete).not.toHaveBeenCalled();
    // manager.delete (unconditional) must also NOT have been called
    expect(qrMock.manager.delete).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test: denorm — computeDenorm invoked and entity updated
  // -------------------------------------------------------------------------
  it('(denorm) computeDenorm is invoked and entity is updated with googleMapsRating/Count/lastGoogleSyncAt', async () => {
    const qrMock = makeReconcileQrMock({ afterCount: 2 });
    await buildReconcileModule(qrMock);

    await service.reconcileEntity('entity-001', 'lodging');

    // entity update must have been called with denorm fields and lastGoogleSyncAt
    expect(qrMock.manager.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'entity-001' }),
      expect.objectContaining({
        googleMapsRating: expect.any(Number),
        googleMapsReviewsCount: expect.any(Number),
        lastGoogleSyncAt: expect.any(Date),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Test: sync-log — trigger='cron', opened running, closed success
  // -------------------------------------------------------------------------
  it('(sync-log) opens with trigger=cron+status=running and closes with status=success on happy path', async () => {
    const qrMock = makeReconcileQrMock();
    await buildReconcileModule(qrMock);

    await service.reconcileEntity('entity-001', 'lodging');

    // Opening create must have trigger:'cron', status:'running'
    const createCall = syncLogRepo.create.mock.calls[0][0];
    expect(createCall).toMatchObject({ trigger: 'cron', status: 'running' });

    // Closing save must have status:'success'
    const successSave = syncLogRepo.save.mock.calls.find((c: any[]) => c[0]?.status === 'success');
    expect(successSave).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Test: sync-log purge semantics — reviewsNew=0, reviewsTotal=afterCount, message contains 'reviews purged'
  // -------------------------------------------------------------------------
  it('(sync-log purge semantics) closed log has reviewsNew=0, reviewsTotal=afterCount, message with reviews purged', async () => {
    const qrMock = makeReconcileQrMock({ beforeCount: 3, afterCount: 2 });
    await buildReconcileModule(qrMock);

    await service.reconcileEntity('entity-001', 'lodging');

    const successSave = syncLogRepo.save.mock.calls.find((c: any[]) => c[0]?.status === 'success');
    expect(successSave).toBeDefined();
    const log = successSave![0];
    expect(log.reviewsNew).toBe(0);
    expect(log.reviewsTotal).toBe(2); // afterCount
    // errorMessage is reused as the persisted context field on the success path
    // (no dedicated `message` column on the entity; plan prohibits adding a migration)
    expect(log.errorMessage).toMatch(/reviews purged/);
  });

  // -------------------------------------------------------------------------
  // Test: sync-log error path — fetch throws → rollback + error log
  // -------------------------------------------------------------------------
  it('(error path) fetchReviews failure rolls back and saves error log', async () => {
    const qrMock = makeReconcileQrMock();
    await buildReconcileModule(qrMock);

    source.fetchReviews.mockRejectedValue(new Error('apify network timeout'));

    const result = await service.reconcileEntity('entity-001', 'lodging');

    expect(qrMock.rollbackTransaction).toHaveBeenCalled();
    const errorSave = syncLogRepo.save.mock.calls.find((c: any[]) => c[0]?.status === 'error');
    expect(errorSave).toBeDefined();
    expect(result).toMatchObject({ status: 'error' });
  });

  // -------------------------------------------------------------------------
  // Test: URL gate — entity with invalid URL → status='skipped', no fetch, no purge
  // -------------------------------------------------------------------------
  it('(URL gate) entity with invalid googleMapsUrl → status=skipped, no fetch, no purge', async () => {
    const qrMock = makeReconcileQrMock({
      entity: { googleMapsUrl: 'https://booking.com/hotel-xyz' as any },
    });
    await buildReconcileModule(qrMock);

    const result = await service.reconcileEntity('entity-001', 'lodging');

    expect(source.fetchReviews).not.toHaveBeenCalled();
    expect(qrMock._deleteQb.delete).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'skipped' });
  });
});
