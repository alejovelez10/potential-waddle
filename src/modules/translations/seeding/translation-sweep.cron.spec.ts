// Wave 0 (Nyquist): RED until 28-03 implements TranslationSweepCron.
// This spec encodes the bounded-batch contract (Pitfall 2) and documents
// the MT-03 revisado-skip guarantee before the implementation exists.

import { Test, TestingModule } from '@nestjs/testing';
import { TranslationSweepCron } from './translation-sweep.cron';
import { TranslationSeedingService } from './translation-seeding.service';

// ---------------------------------------------------------------------------
// Mock TranslationSeedingService — only sweepPending is exercised by the cron
// ---------------------------------------------------------------------------

const mockSeedingService = () => ({
  sweepPending: jest.fn().mockResolvedValue(undefined),
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('TranslationSweepCron', () => {
  let cron: TranslationSweepCron;
  let seeding: ReturnType<typeof mockSeedingService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranslationSweepCron,
        {
          provide: TranslationSeedingService,
          useFactory: mockSeedingService,
        },
      ],
    }).compile();

    cron = module.get<TranslationSweepCron>(TranslationSweepCron);
    seeding = module.get(TranslationSeedingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Pitfall 2 — bounded batch: cron must delegate with batchSize: 50
  // -------------------------------------------------------------------------

  it('Pitfall 2: sweep() delegates to sweepPending with batchSize: 50 (bounded batch)', async () => {
    await cron.sweep();

    expect(seeding.sweepPending).toHaveBeenCalledTimes(1);
    expect(seeding.sweepPending).toHaveBeenCalledWith({ batchSize: 50 });
  });

  // -------------------------------------------------------------------------
  // MT-03 — revisado rows are never touched by the sweep
  // The actual guard is in the upsert SQL (tested in service spec: source != 'revisado').
  // This test documents the contract at the cron level: sweep only delegates to sweepPending;
  // the service is responsible for skipping revisado rows via the upsert WHERE clause.
  // -------------------------------------------------------------------------

  it('MT-03: sweep() delegates to sweepPending (which skips revisado rows via upsert guard)', async () => {
    // MT-03: sweepPending re-seeds stale 'auto' rows only; the upsert WHERE source != 'revisado'
    // guard (tested in seeding service spec) protects revisado rows.
    await cron.sweep();

    // The cron must call sweepPending — the revisado-skip guarantee lives in the SQL
    expect(seeding.sweepPending).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // D-5 (quick 260717-abz) — the @Cron(EVERY_10_MINUTES) decorator is disabled.
  // sweepPending is a total no-op today (locale != 'en' over a table where 'es'
  // is never stored), so the cron must not be scheduled. This test blocks an
  // accidental re-enable: it fails the moment @Cron(...) is uncommented without
  // this test being updated deliberately.
  // -------------------------------------------------------------------------

  it('D-5: sweep() has no @Cron metadata registered — the schedule is disabled', () => {
    expect(Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', TranslationSweepCron.prototype.sweep)).toBeUndefined();
  });
});
