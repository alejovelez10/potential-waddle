// Wave 0 (Nyquist): RED until 28-02/28-03 implement TranslationSeedingService.
// These tests encode the security-critical contracts as executable assertions
// so that 28-02/28-03 executors have a green-bar target and cannot silently regress.

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { createHash } from 'crypto';
import { EntityTranslation } from '../entities/entity-translation.entity';
import { TranslationSeedingService } from './translation-seeding.service';
import { generateStructuredAnalysis } from '../../ai/lib/gemini/generate-structured-with-fallback';
import { fakeGeminiJson } from './__mocks__/gemini-translation.fixture';

// Jest mock: intercept all calls to generateStructuredAnalysis so no network calls are made.
jest.mock('../../ai/lib/gemini/generate-structured-with-fallback');

// ---------------------------------------------------------------------------
// Repository / repo-owner mock factories
// ---------------------------------------------------------------------------

const mockTranslationRepo = () => ({
  find: jest.fn(),
  query: jest.fn().mockResolvedValue([]),
});

const mockLodgingRepo = () => ({
  findOne: jest.fn(),
});

const mockExperienceRepo = () => ({
  findOne: jest.fn(),
});

const mockDataSource = () => ({
  query: jest.fn().mockResolvedValue([]),
});

// ---------------------------------------------------------------------------
// Helper: compute expected sourceHash for an ES text (mirrors computeSourceHash)
// ---------------------------------------------------------------------------
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('TranslationSeedingService', () => {
  let service: TranslationSeedingService;
  let translationRepo: ReturnType<typeof mockTranslationRepo>;
  let lodgingRepo: ReturnType<typeof mockLodgingRepo>;
  let experienceRepo: ReturnType<typeof mockExperienceRepo>;
  let dataSource: ReturnType<typeof mockDataSource>;

  const ENTITY_ID = 'entity-uuid-001';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranslationSeedingService,
        {
          provide: getRepositoryToken(EntityTranslation),
          useFactory: mockTranslationRepo,
        },
        // DataSource injected via @InjectDataSource() — used by sweepPending/loadEntityES
        {
          provide: getDataSourceToken(),
          useFactory: mockDataSource,
        },
        // Lodging repo injection token (service injects by entity class or string token)
        {
          provide: 'LodgingRepository',
          useFactory: mockLodgingRepo,
        },
        // Experience repo injection token
        {
          provide: 'ExperienceRepository',
          useFactory: mockExperienceRepo,
        },
      ],
    }).compile();

    service = module.get<TranslationSeedingService>(TranslationSeedingService);
    translationRepo = module.get(getRepositoryToken(EntityTranslation));
    dataSource = module.get(getDataSourceToken());
    lodgingRepo = module.get('LodgingRepository');
    experienceRepo = module.get('ExperienceRepository');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // MT-01 — seedEntity calls Gemini EXACTLY ONCE and upserts EN rows
  // -------------------------------------------------------------------------

  describe('seedEntity', () => {
    it('MT-01: calls generateStructuredAnalysis exactly once for all fields', async () => {
      const fieldsES = {
        description: 'Una cabaña acogedora rodeada de naturaleza.',
        howToGetThere: 'Toma la carretera principal 200m después del parque.',
      };

      (generateStructuredAnalysis as jest.Mock).mockResolvedValueOnce(fakeGeminiJson(fieldsES));

      await service.seedEntity('lodging', ENTITY_ID, 'Cabaña El Paraíso', fieldsES);

      // Single Gemini call — not one per field (Pitfall 2 analogous cost guard)
      expect(generateStructuredAnalysis).toHaveBeenCalledTimes(1);
    });

    it('MT-01 Pitfall 1: upsert SQL contains anti-revisado guard (source != revisado)', async () => {
      const fieldsES = {
        description: 'Una cabaña acogedora rodeada de naturaleza.',
        howToGetThere: 'Toma la carretera principal 200m después del parque.',
      };

      (generateStructuredAnalysis as jest.Mock).mockResolvedValueOnce(fakeGeminiJson(fieldsES));

      await service.seedEntity('lodging', ENTITY_ID, 'Cabaña El Paraíso', fieldsES);

      // Every upsert call must include the WHERE guard so revisado rows are never overwritten
      const queryCalls = (translationRepo.query as jest.Mock).mock.calls;
      expect(queryCalls.length).toBeGreaterThan(0);
      for (const [sql] of queryCalls) {
        expect(sql as string).toContain("source != 'revisado'");
      }
    });

    // -----------------------------------------------------------------------
    // MT-03 Pitfall 3 — sourceHash must be sha256 of the ES value, NOT the EN value
    // -----------------------------------------------------------------------

    it('MT-03 Pitfall 3: sourceHash parameter is sha256 of the ES source value', async () => {
      const esText = 'Hola mundo';
      const fieldsES = { description: esText };

      (generateStructuredAnalysis as jest.Mock).mockResolvedValueOnce(fakeGeminiJson(fieldsES));

      await service.seedEntity('lodging', ENTITY_ID, 'Test Entity', fieldsES);

      const expectedHash = sha256(esText); // sha256 of ES text, not EN

      // Find the query call for the 'description' field and assert the bound hash param
      const queryCalls = (translationRepo.query as jest.Mock).mock.calls;
      expect(queryCalls.length).toBeGreaterThan(0);

      // At least one call must pass expectedHash as a bind param
      const hasCorrectHash = queryCalls.some(([_sql, params]: [string, unknown[]]) =>
        Array.isArray(params) && params.includes(expectedHash),
      );
      expect(hasCorrectHash).toBe(true);
    });

    // -----------------------------------------------------------------------
    // MT-01 Pitfall 5 — 'name' field must NEVER be auto-seeded
    // -----------------------------------------------------------------------

    it('MT-01 Pitfall 5: name field is NOT sent to Gemini nor upserted', async () => {
      const fieldsES = {
        name: 'Cabaña El Paraíso', // must be filtered out
        description: 'Una cabaña acogedora.',
      };

      // Fixture only returns translation for 'description'
      (generateStructuredAnalysis as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({ description: 'A cozy cabin.' }),
      );

      await service.seedEntity('lodging', ENTITY_ID, 'Cabaña El Paraíso', fieldsES);

      // The prompt sent to Gemini must NOT include 'name'
      const geminiCall = (generateStructuredAnalysis as jest.Mock).mock.calls[0];
      const promptArg: string = geminiCall[0].prompt ?? geminiCall[0];
      // If prompt is an object param, check the prompt property; either way 'name' as field key must be absent
      if (typeof promptArg === 'string') {
        expect(promptArg).not.toMatch(/"name"\s*:/);
      }

      // No upsert call should contain field='name'
      const queryCalls = (translationRepo.query as jest.Mock).mock.calls;
      const hasNameUpsert = queryCalls.some(([_sql, params]: [string, unknown[]]) =>
        Array.isArray(params) && params.includes('name'),
      );
      expect(hasNameUpsert).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // MT-03 — needsSeeding staleness detection
  // -------------------------------------------------------------------------

  describe('needsSeeding', () => {
    it('includes field when EN row is missing', async () => {
      // No EN rows stored
      translationRepo.find.mockResolvedValueOnce([]);

      const fieldsES = { description: 'Descripción en español.' };
      const result = await service.needsSeeding('lodging', ENTITY_ID, fieldsES);

      expect(result).toHaveProperty('description');
    });

    it('includes field when stored sourceHash differs from sha256(current ES value) — stale detection', async () => {
      const currentES = 'Descripción actualizada en español.';
      const oldHash = sha256('Descripción vieja en español.'); // hash of OLD value

      translationRepo.find.mockResolvedValueOnce([
        {
          entityId: ENTITY_ID,
          field: 'description',
          value: 'Old EN value',
          source: 'auto',
          sourceHash: oldHash,
        },
      ]);

      const result = await service.needsSeeding('lodging', ENTITY_ID, { description: currentES });

      // Hash of currentES does NOT match oldHash → field must be included
      expect(result).toHaveProperty('description');
    });

    it('excludes field when stored sourceHash matches sha256(current ES value) — up to date', async () => {
      const currentES = 'Descripción sin cambios.';
      const currentHash = sha256(currentES);

      translationRepo.find.mockResolvedValueOnce([
        {
          entityId: ENTITY_ID,
          field: 'description',
          value: 'EN description unchanged',
          source: 'auto',
          sourceHash: currentHash,
        },
      ]);

      const result = await service.needsSeeding('lodging', ENTITY_ID, { description: currentES });

      // Hash matches → field is up to date, must be excluded
      expect(result).not.toHaveProperty('description');
    });
  });

  // -------------------------------------------------------------------------
  // MT-02/IDOR Pitfall 7 — overrideTranslation ownership checks
  // -------------------------------------------------------------------------

  describe('overrideTranslation', () => {
    describe('lodging (owner via entity.user.id)', () => {
      it('throws ForbiddenException when userId does not match lodging owner', async () => {
        lodgingRepo.findOne.mockResolvedValueOnce({ id: ENTITY_ID, user: { id: 'userA' } });

        await expect(
          service.overrideTranslation('lodging', ENTITY_ID, { description: 'x' }, 'userB'),
        ).rejects.toThrow(ForbiddenException);
      });

      it('resolves and upserts with source=revisado when userId matches lodging owner', async () => {
        lodgingRepo.findOne.mockResolvedValueOnce({ id: ENTITY_ID, user: { id: 'userA' } });

        await service.overrideTranslation('lodging', ENTITY_ID, { description: 'Custom EN desc' }, 'userA');

        // At least one query call must mark the row as 'revisado'
        const queryCalls = (translationRepo.query as jest.Mock).mock.calls;
        const hasRevisado = queryCalls.some(([_sql, params]: [string, unknown[]]) =>
          Array.isArray(params) && params.includes('revisado'),
        );
        expect(hasRevisado).toBe(true);
      });
    });

    describe('experience (owner via guide.user.id — Pitfall 7)', () => {
      // Pitfall 7: experience ownership resolves via experience.guide.user.id, NOT experience.user.id
      it('throws ForbiddenException when userId does not match experience guide owner', async () => {
        experienceRepo.findOne.mockResolvedValueOnce({
          id: ENTITY_ID,
          guide: { user: { id: 'userA' } },
          // Note: experience has NO direct .user property — ownership is via guide.user.id
        });

        await expect(
          service.overrideTranslation('experience', ENTITY_ID, { description: 'x' }, 'userB'),
        ).rejects.toThrow(ForbiddenException);
      });

      it('resolves when userId matches experience guide.user.id', async () => {
        // Pitfall 7: experience ownership resolves via experience.guide.user.id, NOT experience.user.id
        experienceRepo.findOne.mockResolvedValueOnce({
          id: ENTITY_ID,
          guide: { user: { id: 'userA' } },
        });

        await expect(
          service.overrideTranslation('experience', ENTITY_ID, { description: 'Custom EN' }, 'userA'),
        ).resolves.not.toThrow();
      });

      it('upserts override rows with source=revisado for experience', async () => {
        experienceRepo.findOne.mockResolvedValueOnce({
          id: ENTITY_ID,
          guide: { user: { id: 'userA' } },
        });

        await service.overrideTranslation('experience', ENTITY_ID, { description: 'Custom EN' }, 'userA');

        const queryCalls = (translationRepo.query as jest.Mock).mock.calls;
        const hasRevisado = queryCalls.some(([_sql, params]: [string, unknown[]]) =>
          Array.isArray(params) && params.includes('revisado'),
        );
        expect(hasRevisado).toBe(true);
      });
    });
  });

  // -------------------------------------------------------------------------
  // MT-03 / D-08 — sweepPending actually calls seedEntity (gap-closure fix)
  // -------------------------------------------------------------------------

  describe('sweepPending', () => {
    it('D-08: calls seedEntity for a pending lodging entity found in entity_translation', async () => {
      const PENDING_ID = 'pending-lodging-uuid';
      const ES_DESCRIPTION = 'Una descripción en español.';

      // 1. repo.query (entity_translation) returns one pending entity_id for 'lodging'
      //    and empty arrays for all other entity types
      (translationRepo.query as jest.Mock).mockImplementation(
        (sql: string, params: unknown[]) => {
          // The pending-entities subquery passes entityType as $1
          if (typeof sql === 'string' && sql.includes('entity_translation') && params?.[0] === 'lodging') {
            return Promise.resolve([{ entity_id: PENDING_ID }]);
          }
          return Promise.resolve([]);
        },
      );

      // 2. dataSource.query (base entity SELECT) returns ES source values for that lodging
      (dataSource.query as jest.Mock).mockResolvedValueOnce([
        { display_name: 'Cabaña Test', description: ES_DESCRIPTION, howToGetThere: null },
      ]);

      // 3. Gemini mock — return fake translation
      (generateStructuredAnalysis as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({ description: 'A test cabin description.' }),
      );

      const seedEntitySpy = jest.spyOn(service, 'seedEntity');

      await service.sweepPending({ batchSize: 5 });

      // seedEntity MUST have been called with the pending entity's data
      expect(seedEntitySpy).toHaveBeenCalledWith(
        'lodging',
        PENDING_ID,
        'Cabaña Test',
        expect.objectContaining({ description: ES_DESCRIPTION }),
      );
    });

    it('D-08: does NOT call seedEntity when base entity has no ES source data', async () => {
      const PENDING_ID = 'ghost-lodging-uuid';

      // entity_translation query returns a pending entity
      (translationRepo.query as jest.Mock).mockImplementation(
        (sql: string, params: unknown[]) => {
          if (typeof sql === 'string' && sql.includes('entity_translation') && params?.[0] === 'lodging') {
            return Promise.resolve([{ entity_id: PENDING_ID }]);
          }
          return Promise.resolve([]);
        },
      );

      // dataSource.query returns no row (entity deleted or all ES fields empty)
      (dataSource.query as jest.Mock).mockResolvedValueOnce([]);

      const seedEntitySpy = jest.spyOn(service, 'seedEntity');

      await service.sweepPending({ batchSize: 5 });

      // seedEntity must NOT be called — nothing to seed
      expect(seedEntitySpy).not.toHaveBeenCalled();
    });

    it('Pitfall 2: sweepPending respects batchSize — stops after budget is exhausted', async () => {
      // Two pending lodging entities, but batchSize=1 — only one should be processed
      (translationRepo.query as jest.Mock).mockImplementation(
        (sql: string, params: unknown[]) => {
          if (typeof sql === 'string' && sql.includes('entity_translation') && params?.[0] === 'lodging') {
            return Promise.resolve([
              { entity_id: 'lodging-a' },
              { entity_id: 'lodging-b' },
            ]);
          }
          return Promise.resolve([]);
        },
      );

      // dataSource.query returns ES data for the first entity
      (dataSource.query as jest.Mock).mockResolvedValue([
        { display_name: 'Cabaña A', description: 'Descripción A.', howToGetThere: null },
      ]);

      (generateStructuredAnalysis as jest.Mock).mockResolvedValue(
        JSON.stringify({ description: 'Description A.' }),
      );

      const seedEntitySpy = jest.spyOn(service, 'seedEntity');

      await service.sweepPending({ batchSize: 1 });

      // Only one entity processed — batchSize enforced
      expect(seedEntitySpy).toHaveBeenCalledTimes(1);
    });
  });
});
