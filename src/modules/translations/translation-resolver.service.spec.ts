import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EntityTranslation } from './entities/entity-translation.entity';
import { TranslationResolverService } from './translation-resolver.service';

const mockRepository = () => ({
  find: jest.fn(),
});

type MockRepository = Partial<Record<keyof Repository<EntityTranslation>, jest.Mock>>;

describe('TranslationResolverService', () => {
  let service: TranslationResolverService;
  let repo: MockRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranslationResolverService,
        {
          provide: getRepositoryToken(EntityTranslation),
          useFactory: mockRepository,
        },
      ],
    }).compile();

    service = module.get<TranslationResolverService>(TranslationResolverService);
    repo = module.get<MockRepository>(getRepositoryToken(EntityTranslation));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('batchLoad', () => {
    it('issues exactly ONE query for multiple ids (N+1 guard)', async () => {
      repo.find!.mockResolvedValue([
        { entityId: 'id-1', field: 'description', value: 'EN desc 1' },
        { entityId: 'id-2', field: 'description', value: 'EN desc 2' },
      ]);

      const result = await service.batchLoad('lodging', ['id-1', 'id-2'], 'en');

      expect(repo.find).toHaveBeenCalledTimes(1);
      expect(result.size).toBe(2);
      expect(result.get('id-1')).toEqual({ description: 'EN desc 1' });
      expect(result.get('id-2')).toEqual({ description: 'EN desc 2' });
    });

    it('returns empty Map and makes ZERO DB calls for locale=es (early-exit)', async () => {
      const result = await service.batchLoad('lodging', ['id-1', 'id-2'], 'es');

      expect(repo.find).toHaveBeenCalledTimes(0);
      expect(result.size).toBe(0);
    });

    it('returns empty Map and makes ZERO DB calls for empty ids array', async () => {
      const result = await service.batchLoad('lodging', [], 'en');

      expect(repo.find).toHaveBeenCalledTimes(0);
      expect(result.size).toBe(0);
    });

    it('groups multiple fields per entity correctly', async () => {
      repo.find!.mockResolvedValue([
        { entityId: 'id-1', field: 'description', value: 'EN desc' },
        { entityId: 'id-1', field: 'howToGetThere', value: 'EN how' },
      ]);

      const result = await service.batchLoad('lodging', ['id-1'], 'en');

      expect(result.get('id-1')).toEqual({ description: 'EN desc', howToGetThere: 'EN how' });
    });
  });

  describe('load', () => {
    it('returns a Record<field, value> for a given entity', async () => {
      repo.find!.mockResolvedValue([
        { field: 'description', value: 'EN desc' },
        { field: 'howToGetThere', value: 'EN how' },
      ]);

      const result = await service.load('lodging', 'id-1', 'en');

      expect(repo.find).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ description: 'EN desc', howToGetThere: 'EN how' });
    });

    it('returns empty object and makes ZERO DB calls for locale=es (early-exit)', async () => {
      const result = await service.load('lodging', 'id-1', 'es');

      expect(repo.find).toHaveBeenCalledTimes(0);
      expect(result).toEqual({});
    });
  });

  describe('overlay', () => {
    it('replaces base fields with translated values', () => {
      const base = { description: 'Descripción en ES', name: 'Nombre' };
      const translations = { description: 'Description in EN' };

      const result = service.overlay(base, translations);

      expect(result.description).toBe('Description in EN');
    });

    it('falls back to es value for fields not present in translations', () => {
      const base = { description: 'ES desc', name: 'Name X' };
      const translations = { description: 'EN desc' };

      const result = service.overlay(base, translations);

      expect(result.name).toBe('Name X'); // fallback: name kept as ES
    });

    it('does NOT mutate the original base object (Pitfall 5)', () => {
      const base = { description: 'ES desc', name: 'Name X' };
      const translations = { description: 'EN desc' };

      service.overlay(base, translations);

      // Original must be completely unchanged
      expect(base.description).toBe('ES desc');
      expect(base.name).toBe('Name X');
    });

    it('returns a new object with merged values', () => {
      const base = { description: 'ES desc', name: 'Name X' };
      const translations = { description: 'EN desc' };

      const result = service.overlay(base, translations);

      expect(result.description).toBe('EN desc');
      expect(result.name).toBe('Name X');
      // Must be a different reference
      expect(result).not.toBe(base);
    });

    it('ignores translation fields that do not exist in base', () => {
      const base = { description: 'ES desc' };
      const translations = { description: 'EN desc', nonExistentField: 'value' };

      const result = service.overlay(base, translations);

      expect(result).not.toHaveProperty('nonExistentField');
      expect(result.description).toBe('EN desc');
    });
  });

  describe('overlayCollection', () => {
    it('overlays translations onto each item by id', () => {
      const items = [{ id: 'a', name: 'Hotel' }];
      const translationsMap = new Map([['a', { name: 'Inn' }]]);

      const result = service.overlayCollection(items, translationsMap);

      expect(result).toEqual([{ id: 'a', name: 'Inn' }]);
    });

    it('keeps the base (es) value for items without a row in the Map (implicit fallback)', () => {
      const items = [{ id: 'b', name: 'Cabaña' }];
      const translationsMap = new Map<string, Record<string, string>>();

      const result = service.overlayCollection(items, translationsMap);

      expect(result).toEqual([{ id: 'b', name: 'Cabaña' }]);
    });

    it('does NOT mutate the original array or its items', () => {
      const items = [{ id: 'a', name: 'Hotel' }];
      const translationsMap = new Map([['a', { name: 'Inn' }]]);

      const result = service.overlayCollection(items, translationsMap);

      expect(items).toEqual([{ id: 'a', name: 'Hotel' }]);
      expect(result).not.toBe(items);
      expect(result[0]).not.toBe(items[0]);
    });
  });
});
