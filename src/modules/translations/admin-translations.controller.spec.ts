import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';

import { AdminTranslationsController } from './admin-translations.controller';
import { TranslationSeedingService } from './seeding/translation-seeding.service';

const makeService = () => ({
  seedAdminEntity: jest.fn(),
  overrideAdmin: jest.fn(),
  batchStateForIds: jest.fn(),
  countMissingForType: jest.fn(),
  seedMissingForType: jest.fn(),
});

describe('AdminTranslationsController', () => {
  let controller: AdminTranslationsController;
  let service: ReturnType<typeof makeService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    service = makeService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminTranslationsController],
      providers: [{ provide: TranslationSeedingService, useValue: service }],
    }).compile();

    controller = module.get<AdminTranslationsController>(AdminTranslationsController);
  });

  // -------------------------------------------------------------------------
  // Every route delegates to the matching service method
  // -------------------------------------------------------------------------

  it('seed delegates with entityType/entityId/{ force }', () => {
    controller.seed('category', 'id-1', true);
    expect(service.seedAdminEntity).toHaveBeenCalledWith('category', 'id-1', { force: true });
  });

  it('override delegates with entityType/entityId/fields', () => {
    controller.override('facility', 'id-2', { name: 'Pool' });
    expect(service.overrideAdmin).toHaveBeenCalledWith('facility', 'id-2', { name: 'Pool' });
  });

  it('state parses the comma-separated ids query param, trimmed and filtered', () => {
    controller.state('category', 'a, b ,c,,');
    expect(service.batchStateForIds).toHaveBeenCalledWith('category', ['a', 'b', 'c']);
  });

  it('state caps ids at 200', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`).join(',');
    controller.state('category', ids);
    const [, calledIds] = (service.batchStateForIds as jest.Mock).mock.calls[0];
    expect(calledIds).toHaveLength(200);
  });

  it('pendingCount delegates and wraps the result in { count }', async () => {
    service.countMissingForType.mockResolvedValueOnce(7);
    const result = await controller.pendingCount('category');
    expect(service.countMissingForType).toHaveBeenCalledWith('category');
    expect(result).toEqual({ count: 7 });
  });

  it('seedMissing defaults batchSize to 50 when absent', () => {
    controller.seedMissing('facility', undefined);
    expect(service.seedMissingForType).toHaveBeenCalledWith('facility', 50);
  });

  it('seedMissing forwards an explicit batchSize', () => {
    controller.seedMissing('facility', 10);
    expect(service.seedMissingForType).toHaveBeenCalledWith('facility', 10);
  });

  // -------------------------------------------------------------------------
  // DD-3 — entityType outside ['category','facility'] is rejected on every route
  // -------------------------------------------------------------------------

  it('rejects an entityType outside the admin allowlist with BadRequestException', async () => {
    expect(() => controller.seed('lodging', 'id-1', undefined)).toThrow(BadRequestException);
    expect(() => controller.override('lodging', 'id-1', {})).toThrow(BadRequestException);
    expect(() => controller.state('lodging', 'a')).toThrow(BadRequestException);
    expect(() => controller.seedMissing('lodging', 50)).toThrow(BadRequestException);
    await expect(controller.pendingCount('lodging')).rejects.toThrow(BadRequestException);

    // None of the delegated service methods should have been reached
    expect(service.seedAdminEntity).not.toHaveBeenCalled();
    expect(service.overrideAdmin).not.toHaveBeenCalled();
    expect(service.batchStateForIds).not.toHaveBeenCalled();
    expect(service.seedMissingForType).not.toHaveBeenCalled();
    expect(service.countMissingForType).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Guard wiring: every route carries @SuperAdmin() (JwtAuthGuard + SuperAdminGuard).
  // Pattern copied from rafa-admin.controller.spec.ts:104-127.
  // -------------------------------------------------------------------------

  it('every route is guarded by @SuperAdmin() (JwtAuthGuard + SuperAdminGuard)', () => {
    const routeMethods = ['seed', 'override', 'state', 'pendingCount', 'seedMissing'] as const;

    for (const method of routeMethods) {
      const handler = (AdminTranslationsController.prototype as unknown as Record<string, object>)[method];
      const guards = Reflect.getMetadata('__guards__', handler);
      expect(Array.isArray(guards)).toBe(true);
      const guardNames = (guards as Array<new (...args: unknown[]) => unknown>).map((g) => g.name);
      expect(guardNames).toEqual(expect.arrayContaining(['JwtAuthGuard', 'SuperAdminGuard']));
    }
  });
});
