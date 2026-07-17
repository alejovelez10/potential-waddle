// Wave 0 (Nyquist): RED until 28-02/28-03 implement TranslationSeedingService.
// These tests encode the security-critical contracts as executable assertions
// so that 28-02/28-03 executors have a green-bar target and cannot silently regress.

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
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
        // getTranslationState: repo.find for EN rows, then dataSource.query for ES values
        translationRepo.find.mockResolvedValueOnce([]);
        dataSource.query.mockResolvedValueOnce([]);

        const result = await service.overrideTranslation('lodging', ENTITY_ID, { description: 'Custom EN desc' }, 'userA');

        // Returns the new { fields: {...} } contract, not an array
        expect(result).toHaveProperty('fields');
        expect(typeof result.fields).toBe('object');
        expect(Array.isArray(result)).toBe(false);

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
        translationRepo.find.mockResolvedValueOnce([]);
        dataSource.query.mockResolvedValueOnce([]);

        await expect(
          service.overrideTranslation('experience', ENTITY_ID, { description: 'Custom EN' }, 'userA'),
        ).resolves.not.toThrow();
      });

      it('upserts override rows with source=revisado for experience', async () => {
        experienceRepo.findOne.mockResolvedValueOnce({
          id: ENTITY_ID,
          guide: { user: { id: 'userA' } },
        });
        translationRepo.find.mockResolvedValueOnce([]);
        dataSource.query.mockResolvedValueOnce([]);

        const result = await service.overrideTranslation('experience', ENTITY_ID, { description: 'Custom EN' }, 'userA');

        // Returns the new { fields: {...} } contract, not an array
        expect(result).toHaveProperty('fields');
        expect(typeof result.fields).toBe('object');
        expect(Array.isArray(result)).toBe(false);

        const queryCalls = (translationRepo.query as jest.Mock).mock.calls;
        const hasRevisado = queryCalls.some(([_sql, params]: [string, unknown[]]) =>
          Array.isArray(params) && params.includes('revisado'),
        );
        expect(hasRevisado).toBe(true);
      });
    });
  });

  // -------------------------------------------------------------------------
  // seedOnDemand — self-loads ES, IDOR-guarded, returns status array
  // -------------------------------------------------------------------------

  describe('seedOnDemand', () => {
    it('throws ForbiddenException when userId does not own the entity', async () => {
      lodgingRepo.findOne.mockResolvedValueOnce({ id: ENTITY_ID, user: { id: 'userA' } });

      await expect(
        service.seedOnDemand('lodging', ENTITY_ID, 'userB'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('loads ES from base table, seeds, and returns { fields } object', async () => {
      lodgingRepo.findOne.mockResolvedValueOnce({ id: ENTITY_ID, user: { id: 'userA' } });

      // loadEntityES (called by seedOnDemand before seedEntity)
      dataSource.query.mockResolvedValueOnce([
        { display_name: 'Cabaña Test', description: 'Descripción en español.' },
      ]);

      (generateStructuredAnalysis as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({ description: 'Test cabin description.' }),
      );

      // getTranslationState: repo.find for EN rows
      translationRepo.find.mockResolvedValueOnce([
        { field: 'description', value: 'Test cabin description.', source: 'auto', sourceHash: sha256('Descripción en español.'), updatedAt: new Date() },
      ]);
      // getTranslationState: loadEntityES (dataSource.query) for ES values
      dataSource.query.mockResolvedValueOnce([
        { display_name: 'Cabaña Test', description: 'Descripción en español.' },
      ]);

      const result = await service.seedOnDemand('lodging', ENTITY_ID, 'userA');

      // New contract: { fields: Record<string, {...}> }
      expect(result).toHaveProperty('fields');
      expect(typeof result.fields).toBe('object');
      expect(Array.isArray(result)).toBe(false);
      expect(result.fields).toHaveProperty('description');
      expect(result.fields['description']).toHaveProperty('source');
    });

    it('returns { fields } object even when loadEntityES finds no data', async () => {
      lodgingRepo.findOne.mockResolvedValueOnce({ id: ENTITY_ID, user: { id: 'userA' } });

      // loadEntityES for seedOnDemand — no entity rows
      dataSource.query.mockResolvedValueOnce([]);

      // getTranslationState: repo.find — no EN rows yet
      translationRepo.find.mockResolvedValueOnce([]);
      // getTranslationState: loadEntityES — also empty
      dataSource.query.mockResolvedValueOnce([]);

      const result = await service.seedOnDemand('lodging', ENTITY_ID, 'userA');

      // New contract: { fields: Record<string, {...}> }
      expect(result).toHaveProperty('fields');
      expect(typeof result.fields).toBe('object');
      expect(Array.isArray(result)).toBe(false);
      // seedEntity must NOT have been called (nothing to seed)
      expect(generateStructuredAnalysis).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Per-field FORCE path — opts.fields bypasses the revisado guard
    // -----------------------------------------------------------------------

    it('force path: re-translates a revisado field when opts.fields is provided', async () => {
      // Owner owns the lodging
      lodgingRepo.findOne.mockResolvedValueOnce({ id: ENTITY_ID, user: { id: 'userA' } });

      // loadEntityES returns ES text for 'description'
      dataSource.query.mockResolvedValueOnce([
        { display_name: 'Cabaña Test', description: 'Descripción forzada en español.' },
      ]);

      // Gemini returns a fresh EN translation for the requested field
      (generateStructuredAnalysis as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({ description: 'Forced EN description.' }),
      );

      // getTranslationState: EN rows (existing revisado row)
      translationRepo.find.mockResolvedValueOnce([
        {
          field: 'description',
          value: 'Old revisado EN text.',
          source: 'revisado',
          sourceHash: null,
          updatedAt: new Date(),
        },
      ]);
      // getTranslationState: loadEntityES
      dataSource.query.mockResolvedValueOnce([
        { display_name: 'Cabaña Test', description: 'Descripción forzada en español.' },
      ]);

      await service.seedOnDemand('lodging', ENTITY_ID, 'userA', { fields: ['description'] });

      // upsertForceAuto must have been called — the SQL must NOT have the revisado guard
      const queryCalls = (translationRepo.query as jest.Mock).mock.calls;
      // At least one upsert call must have been made
      expect(queryCalls.length).toBeGreaterThan(0);
      // The force upsert must NOT contain the revisado WHERE guard
      const forceCall = queryCalls.find(([sql]: [string]) =>
        typeof sql === 'string' &&
        sql.includes('ON CONFLICT') &&
        !sql.includes("source != 'revisado'"),
      );
      expect(forceCall).toBeDefined();
      // The EN value passed must be the new AI translation, not the old revisado text
      const hasNewValue = queryCalls.some(([_sql, params]: [string, unknown[]]) =>
        Array.isArray(params) && params.includes('Forced EN description.'),
      );
      expect(hasNewValue).toBe(true);
    });

    it('force path: only translates requested fields — other fields are untouched', async () => {
      // Owner owns the lodging
      lodgingRepo.findOne.mockResolvedValueOnce({ id: ENTITY_ID, user: { id: 'userA' } });

      // loadEntityES returns two fields but we only request 'description'
      dataSource.query.mockResolvedValueOnce([
        {
          display_name: 'Cabaña Test',
          description: 'Descripción en español.',
          howToGetThere: 'Toma la carretera principal.',
        },
      ]);

      // Gemini is called only for 'description'
      (generateStructuredAnalysis as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({ description: 'Forced description EN.' }),
      );

      // getTranslationState
      translationRepo.find.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([
        { display_name: 'Cabaña Test', description: 'Descripción en español.', howToGetThere: 'Toma la carretera principal.' },
      ]);

      await service.seedOnDemand('lodging', ENTITY_ID, 'userA', { fields: ['description'] });

      // Gemini was called exactly once
      expect(generateStructuredAnalysis).toHaveBeenCalledTimes(1);

      // No upsert should include 'howToGetThere' as a bound param
      const queryCalls = (translationRepo.query as jest.Mock).mock.calls;
      const hasHowToGetThere = queryCalls.some(([_sql, params]: [string, unknown[]]) =>
        Array.isArray(params) && params.includes('howToGetThere'),
      );
      expect(hasHowToGetThere).toBe(false);
    });

    it('bulk path (no opts.fields): bulk upsert still applies revisado guard — revisado rows are skipped', async () => {
      lodgingRepo.findOne.mockResolvedValueOnce({ id: ENTITY_ID, user: { id: 'userA' } });

      // loadEntityES
      dataSource.query.mockResolvedValueOnce([
        { display_name: 'Cabaña Test', description: 'Descripción en español.' },
      ]);

      (generateStructuredAnalysis as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({ description: 'Auto EN description.' }),
      );

      // getTranslationState
      translationRepo.find.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([
        { display_name: 'Cabaña Test', description: 'Descripción en español.' },
      ]);

      // Call WITHOUT opts.fields → bulk path
      await service.seedOnDemand('lodging', ENTITY_ID, 'userA');

      // Every upsert SQL in the bulk path must contain the revisado guard
      const queryCalls = (translationRepo.query as jest.Mock).mock.calls;
      expect(queryCalls.length).toBeGreaterThan(0);
      for (const [sql] of queryCalls) {
        expect(sql as string).toContain("source != 'revisado'");
      }
    });
  });

  // -------------------------------------------------------------------------
  // getTranslationState — shape contract (Phase 28.1 fix)
  // -------------------------------------------------------------------------

  describe('getTranslationState', () => {
    it('returns an object with a "fields" property (not an array)', async () => {
      translationRepo.find.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([]);

      const result = await service.getTranslationState('lodging', ENTITY_ID);

      expect(result).toHaveProperty('fields');
      expect(typeof result.fields).toBe('object');
      expect(Array.isArray(result)).toBe(false);
    });

    it('unseeded translatable field appears with value: null and source: "auto"', async () => {
      // No EN rows stored for this entity
      translationRepo.find.mockResolvedValueOnce([]);
      // loadEntityES returns ES values (entity exists)
      dataSource.query.mockResolvedValueOnce([
        { display_name: 'Cabaña Test', description: 'Descripción en español.' },
      ]);

      const result = await service.getTranslationState('lodging', ENTITY_ID);

      // 'description' is in TRANSLATABLE_FIELDS_BY_ENTITY['lodging'] but has no EN row
      expect(result.fields).toHaveProperty('description');
      expect(result.fields['description'].value).toBeNull();
      expect(result.fields['description'].source).toBe('auto');
      expect(result.fields['description'].sourceStale).toBe(false);
      expect(result.fields['description'].updatedAt).toBeNull();
    });

    it('field with stored sourceHash differing from sha256(current ES) has sourceStale: true', async () => {
      const currentES = 'Descripción actualizada en español.';
      const staleHash = sha256('Descripción vieja en español.'); // hash of OLD value

      translationRepo.find.mockResolvedValueOnce([
        {
          field: 'description',
          value: 'Old EN description.',
          source: 'auto',
          sourceHash: staleHash,
          updatedAt: new Date('2025-01-01T00:00:00Z'),
        },
      ]);
      // loadEntityES returns current ES value
      dataSource.query.mockResolvedValueOnce([
        { display_name: 'Cabaña Test', description: currentES },
      ]);

      const result = await service.getTranslationState('lodging', ENTITY_ID);

      expect(result.fields['description'].sourceStale).toBe(true);
    });

    it('field with stored sourceHash matching sha256(current ES) has sourceStale: false', async () => {
      const currentES = 'Descripción sin cambios.';
      const freshHash = sha256(currentES);

      translationRepo.find.mockResolvedValueOnce([
        {
          field: 'description',
          value: 'EN description unchanged.',
          source: 'auto',
          sourceHash: freshHash,
          updatedAt: new Date('2025-06-01T12:00:00Z'),
        },
      ]);
      dataSource.query.mockResolvedValueOnce([
        { display_name: 'Cabaña Test', description: currentES },
      ]);

      const result = await service.getTranslationState('lodging', ENTITY_ID);

      expect(result.fields['description'].sourceStale).toBe(false);
    });

    it('updatedAt is a string (ISO) or null, never a Date object', async () => {
      const seededDate = new Date('2025-03-15T10:30:00Z');

      translationRepo.find.mockResolvedValueOnce([
        {
          field: 'description',
          value: 'Some EN text.',
          source: 'auto',
          sourceHash: sha256('Texto ES.'),
          updatedAt: seededDate,
        },
      ]);
      dataSource.query.mockResolvedValueOnce([
        { display_name: 'Test', description: 'Texto ES.' },
      ]);

      const result = await service.getTranslationState('lodging', ENTITY_ID);

      const { updatedAt } = result.fields['description'];
      // Must be a string (ISO 8601), not a Date instance
      expect(typeof updatedAt).toBe('string');
      expect(updatedAt).toBe(seededDate.toISOString());
    });

    it('unseeded field has updatedAt: null', async () => {
      translationRepo.find.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([]);

      const result = await service.getTranslationState('lodging', ENTITY_ID);

      // All lodging translatable fields are unseeded → updatedAt must be null
      for (const entry of Object.values(result.fields)) {
        expect(entry.updatedAt).toBeNull();
      }
    });

    it('includes EN-row fields not in TRANSLATABLE_FIELDS_BY_ENTITY (e.g. manual name override)', async () => {
      // 'name' is NOT in TRANSLATABLE_FIELDS_BY_ENTITY['lodging'] but an owner may have overridden it
      translationRepo.find.mockResolvedValueOnce([
        {
          field: 'name',
          value: 'The Cabin EN',
          source: 'revisado',
          sourceHash: null,
          updatedAt: new Date('2025-05-01T00:00:00Z'),
        },
      ]);
      dataSource.query.mockResolvedValueOnce([]);

      const result = await service.getTranslationState('lodging', ENTITY_ID);

      // 'name' must appear because it has an EN row, even though it's not auto-translatable
      expect(result.fields).toHaveProperty('name');
      expect(result.fields['name'].source).toBe('revisado');
      expect(result.fields['name'].value).toBe('The Cabin EN');
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

  // -------------------------------------------------------------------------
  // Admin translation surface (quick 260717-abz) — category/facility, NO owner
  // -------------------------------------------------------------------------

  describe('seedAdminEntity', () => {
    it('force=true translates and overwrites an existing revisado row (bypasses the guard)', async () => {
      // loadEntityES for the translate call
      dataSource.query.mockResolvedValueOnce([{ display_name: 'Hoteles', name: 'Hoteles' }]);
      (generateStructuredAnalysis as jest.Mock).mockResolvedValueOnce(JSON.stringify({ name: 'Hotels' }));

      // getTranslationState: EN rows (existing revisado row), then loadEntityES again
      translationRepo.find.mockResolvedValueOnce([
        { field: 'name', value: 'Old EN', source: 'revisado', sourceHash: null, updatedAt: new Date() },
      ]);
      dataSource.query.mockResolvedValueOnce([{ display_name: 'Hoteles', name: 'Hoteles' }]);

      await service.seedAdminEntity('category', ENTITY_ID, { force: true });

      const queryCalls = (translationRepo.query as jest.Mock).mock.calls;
      const forceCall = queryCalls.find(
        ([sql]: [string]) =>
          typeof sql === 'string' && sql.includes('ON CONFLICT') && !sql.includes("source != 'revisado'"),
      );
      expect(forceCall).toBeDefined();
    });

    it('without force, the translation upsert keeps the revisado guard', async () => {
      dataSource.query.mockResolvedValueOnce([{ display_name: 'Hoteles', name: 'Hoteles' }]);
      (generateStructuredAnalysis as jest.Mock).mockResolvedValueOnce(JSON.stringify({ name: 'Hotels' }));
      translationRepo.find.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([{ display_name: 'Hoteles', name: 'Hoteles' }]);

      await service.seedAdminEntity('category', ENTITY_ID);

      const queryCalls = (translationRepo.query as jest.Mock).mock.calls;
      expect(queryCalls.length).toBeGreaterThan(0);
      for (const [sql] of queryCalls) {
        expect(sql as string).toContain("source != 'revisado'");
      }
    });

    it('does not call Gemini when the entity has no ES source value', async () => {
      dataSource.query.mockResolvedValueOnce([]); // loadEntityES finds nothing
      translationRepo.find.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([]);

      await service.seedAdminEntity('category', ENTITY_ID);

      expect(generateStructuredAnalysis).not.toHaveBeenCalled();
    });

    it('performs no ownership check (neither lodgingRepo nor experienceRepo is queried)', async () => {
      dataSource.query.mockResolvedValueOnce([{ display_name: 'Hoteles', name: 'Hoteles' }]);
      (generateStructuredAnalysis as jest.Mock).mockResolvedValueOnce(JSON.stringify({ name: 'Hotels' }));
      translationRepo.find.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([{ display_name: 'Hoteles', name: 'Hoteles' }]);

      await service.seedAdminEntity('category', ENTITY_ID, { force: true });

      expect(lodgingRepo.findOne).not.toHaveBeenCalled();
      expect(experienceRepo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('overrideAdmin', () => {
    it('writes source=revisado with the sourceHash of the current ES value, no ownership check', async () => {
      dataSource.query.mockResolvedValueOnce([{ display_name: 'Piscina', name: 'Piscina' }]);
      translationRepo.find.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([{ display_name: 'Piscina', name: 'Piscina' }]);

      const result = await service.overrideAdmin('facility', ENTITY_ID, { name: 'Pool' });

      expect(result).toHaveProperty('fields');
      expect(lodgingRepo.findOne).not.toHaveBeenCalled();
      expect(experienceRepo.findOne).not.toHaveBeenCalled();

      const expectedHash = sha256('Piscina');
      const queryCalls = (translationRepo.query as jest.Mock).mock.calls;
      const hasRevisadoWithHash = queryCalls.some(
        ([_sql, params]: [string, unknown[]]) =>
          Array.isArray(params) && params.includes('revisado') && params.includes(expectedHash),
      );
      expect(hasRevisadoWithHash).toBe(true);
    });
  });

  describe('batchStateForIds', () => {
    it('returns {} without querying entity_translation when ids is empty', async () => {
      const result = await service.batchStateForIds('category', []);
      expect(result).toEqual({});
      expect(translationRepo.find).not.toHaveBeenCalled();
    });

    it('returns a Record indexed by entityId', async () => {
      const idA = 'cat-a';
      const idB = 'cat-b';

      translationRepo.find.mockResolvedValueOnce([
        {
          entityId: idA,
          field: 'name',
          value: 'Hotels',
          source: 'auto',
          sourceHash: sha256('Hoteles'),
          updatedAt: new Date(),
        },
      ]);
      dataSource.query.mockResolvedValueOnce([{ display_name: 'Hoteles', name: 'Hoteles' }]); // loadEntityES(idA)
      dataSource.query.mockResolvedValueOnce([{ display_name: 'Restaurantes', name: 'Restaurantes' }]); // loadEntityES(idB)

      const result = await service.batchStateForIds('category', [idA, idB]);

      expect(Object.keys(result)).toEqual([idA, idB]);
      expect(result[idA].fields.name.value).toBe('Hotels');
      expect(result[idB].fields.name.value).toBeNull();
    });

    it('throws BadRequestException for an entityType with no ENTITY_SOURCE_META', async () => {
      await expect(service.batchStateForIds('unknown-type', ['x'])).rejects.toThrow(BadRequestException);
    });
  });

  describe('countMissingForType', () => {
    it('counts base-table rows with no EN row, via NOT EXISTS against entity_translation', async () => {
      dataSource.query.mockResolvedValueOnce([{ count: 3 }]);

      const result = await service.countMissingForType('category');

      expect(result).toBe(3);
      const [sql, params] = (dataSource.query as jest.Mock).mock.calls[0];
      expect(sql).toContain('NOT EXISTS');
      expect(sql).toContain('FROM "category" b');
      expect(params).toEqual(['category', 'name']);
    });

    it('throws BadRequestException for an entityType with no ENTITY_SOURCE_META', async () => {
      await expect(service.countMissingForType('unknown-type')).rejects.toThrow(BadRequestException);
    });
  });

  describe('seedMissingForType', () => {
    it('MT-abz: paginates the BASE table (category), NOT entity_translation, to find candidates', async () => {
      dataSource.query
        .mockResolvedValueOnce([
          { id: 'cat-1', display_name: 'Hoteles', name: 'Hoteles' },
          { id: 'cat-2', display_name: 'Restaurantes', name: 'Restaurantes' },
        ])
        // countMissingForType at the end
        .mockResolvedValueOnce([{ count: 0 }]);

      // needsSeeding for each row → no EN rows stored yet
      translationRepo.find.mockResolvedValue([]);
      (generateStructuredAnalysis as jest.Mock).mockResolvedValue(JSON.stringify({ name: 'Translated' }));

      const result = await service.seedMissingForType('category', 50);

      const firstCall = (dataSource.query as jest.Mock).mock.calls[0];
      expect(firstCall[0]).toContain('FROM "category"');
      expect(firstCall[0]).not.toContain('entity_translation');

      expect(result.processed).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.remaining).toBe(0);
    });

    it('one entity failing does not abort the batch — counted in failed, the other still processed', async () => {
      dataSource.query
        .mockResolvedValueOnce([
          { id: 'cat-1', display_name: 'Hoteles', name: 'Hoteles' },
          { id: 'cat-2', display_name: 'Restaurantes', name: 'Restaurantes' },
        ])
        .mockResolvedValueOnce([{ count: 1 }]);

      translationRepo.find.mockResolvedValue([]);
      (generateStructuredAnalysis as jest.Mock)
        .mockRejectedValueOnce(new Error('Gemini quota exceeded'))
        .mockResolvedValueOnce(JSON.stringify({ name: 'Restaurants' }));

      const result = await service.seedMissingForType('category', 50);

      expect(result.processed).toBe(1);
      expect(result.failed).toBe(1);
    });

    it('skips rows that already have an up-to-date EN row (needsSeeding empty) without calling Gemini', async () => {
      const currentES = 'Hoteles';
      const currentHash = sha256(currentES);

      dataSource.query
        .mockResolvedValueOnce([{ id: 'cat-1', display_name: 'Hoteles', name: currentES }])
        .mockResolvedValueOnce([{ count: 0 }]);

      translationRepo.find.mockResolvedValueOnce([
        { field: 'name', value: 'Hotels', source: 'auto', sourceHash: currentHash },
      ]);

      const result = await service.seedMissingForType('category', 50);

      expect(generateStructuredAnalysis).not.toHaveBeenCalled();
      expect(result.processed).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('respects batchSize — does not attempt more than batchSize entities', async () => {
      dataSource.query
        .mockResolvedValueOnce([
          { id: 'cat-1', display_name: 'Hoteles', name: 'Hoteles' },
          { id: 'cat-2', display_name: 'Restaurantes', name: 'Restaurantes' },
        ])
        .mockResolvedValueOnce([{ count: 1 }]);

      translationRepo.find.mockResolvedValue([]);
      (generateStructuredAnalysis as jest.Mock).mockResolvedValue(JSON.stringify({ name: 'Translated' }));

      const result = await service.seedMissingForType('category', 1);

      expect(result.processed + result.failed).toBe(1);
      // Only 1 row was requested via LIMIT
      const [, params] = (dataSource.query as jest.Mock).mock.calls[0];
      expect(params).toEqual([1, 0]);
    });

    it('throws BadRequestException for an entityType with no ENTITY_SOURCE_META', async () => {
      await expect(service.seedMissingForType('unknown-type', 50)).rejects.toThrow(BadRequestException);
    });
  });
});
