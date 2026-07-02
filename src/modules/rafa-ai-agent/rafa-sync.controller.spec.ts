import { Test, TestingModule } from '@nestjs/testing';

import { RafaSyncController } from './rafa-sync.controller';
import { RafaSyncService } from './rafa-sync.service';
import { TriggerSyncDto } from './dto';

const RUN_ID = 'admin-3fa85f64-5717-4562-b3fc-2c963f66afa6';

const makeService = () => ({
  trigger: jest.fn(),
  status: jest.fn(),
});

describe('RafaSyncController', () => {
  let controller: RafaSyncController;
  let service: ReturnType<typeof makeService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    service = makeService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RafaSyncController],
      providers: [{ provide: RafaSyncService, useValue: service }],
    }).compile();

    controller = module.get<RafaSyncController>(RafaSyncController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('trigger delegates to service.trigger with the dto target', () => {
    const dto: TriggerSyncDto = { target: 'bigquery' };
    controller.trigger(dto);
    expect(service.trigger).toHaveBeenCalledWith('bigquery');
  });

  it('trigger defaults to "all" when target is omitted', () => {
    controller.trigger({});
    expect(service.trigger).toHaveBeenCalledWith('all');
  });

  it('status delegates to service.status with the runId', () => {
    controller.status(RUN_ID);
    expect(service.status).toHaveBeenCalledWith(RUN_ID);
  });

  // Both routes carry the @SuperAdmin() guards (D-04). Assert via reflected metadata.
  it('every route is guarded by @SuperAdmin() (JwtAuthGuard + SuperAdminGuard)', () => {
    const routeMethods = ['trigger', 'status'] as const;

    for (const method of routeMethods) {
      const handler = (RafaSyncController.prototype as unknown as Record<string, object>)[method];
      const guards = Reflect.getMetadata('__guards__', handler);
      expect(Array.isArray(guards)).toBe(true);
      const guardNames = (guards as Array<new (...args: unknown[]) => unknown>).map(g => g.name);
      expect(guardNames).toEqual(expect.arrayContaining(['JwtAuthGuard', 'SuperAdminGuard']));
    }
  });
});
