import { Test, TestingModule } from '@nestjs/testing';

import { RafaAdminController } from './rafa-admin.controller';
import { RafaAdminService } from './rafa-admin.service';
import { CreateSkillDto, UpdateKnowledgeSourceDto, UpdateSkillDto } from './dto';

const SKILL_ID = '00000000-0000-0000-0000-000000000001';
const KS_ID = '00000000-0000-0000-0000-000000000002';
const TOOL_ID = '00000000-0000-0000-0000-0000000000a1';

const makeService = () => ({
  listSkills: jest.fn(),
  getSkill: jest.fn(),
  createSkill: jest.fn(),
  updateSkill: jest.fn(),
  deleteSkill: jest.fn(),
  getSkillToolIds: jest.fn(),
  assignTools: jest.fn(),
  listTools: jest.fn(),
  listKnowledgeSources: jest.fn(),
  updateKnowledgeSource: jest.fn(),
});

describe('RafaAdminController', () => {
  let controller: RafaAdminController;
  let service: ReturnType<typeof makeService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    service = makeService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RafaAdminController],
      providers: [{ provide: RafaAdminService, useValue: service }],
    }).compile();

    controller = module.get<RafaAdminController>(RafaAdminController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Every route delegates to the matching service method
  // -------------------------------------------------------------------------

  it('listSkills delegates to service.listSkills', () => {
    controller.listSkills();
    expect(service.listSkills).toHaveBeenCalledTimes(1);
  });

  it('getSkill delegates with the id', () => {
    controller.getSkill(SKILL_ID);
    expect(service.getSkill).toHaveBeenCalledWith(SKILL_ID);
  });

  it('createSkill delegates with the dto', () => {
    const dto: CreateSkillDto = { name: 'n', description: 'd', body: 'b' };
    controller.createSkill(dto);
    expect(service.createSkill).toHaveBeenCalledWith(dto);
  });

  it('updateSkill delegates with id + dto', () => {
    const dto: UpdateSkillDto = { body: 'nuevo' };
    controller.updateSkill(SKILL_ID, dto);
    expect(service.updateSkill).toHaveBeenCalledWith(SKILL_ID, dto);
  });

  it('deleteSkill delegates with the id', () => {
    controller.deleteSkill(SKILL_ID);
    expect(service.deleteSkill).toHaveBeenCalledWith(SKILL_ID);
  });

  it('getSkillToolIds delegates with the id', () => {
    controller.getSkillToolIds(SKILL_ID);
    expect(service.getSkillToolIds).toHaveBeenCalledWith(SKILL_ID);
  });

  it('assignTools delegates with id + dto', () => {
    const dto = { toolIds: [TOOL_ID] };
    controller.assignTools(SKILL_ID, dto);
    expect(service.assignTools).toHaveBeenCalledWith(SKILL_ID, dto);
  });

  it('listTools delegates to service.listTools', () => {
    controller.listTools();
    expect(service.listTools).toHaveBeenCalledTimes(1);
  });

  it('listKnowledgeSources delegates to service.listKnowledgeSources', () => {
    controller.listKnowledgeSources();
    expect(service.listKnowledgeSources).toHaveBeenCalledTimes(1);
  });

  it('updateKnowledgeSource delegates with id + dto', () => {
    const dto: UpdateKnowledgeSourceDto = { isActive: false };
    controller.updateKnowledgeSource(KS_ID, dto);
    expect(service.updateKnowledgeSource).toHaveBeenCalledWith(KS_ID, dto);
  });

  // -------------------------------------------------------------------------
  // Guard wiring: every route carries the @SuperAdmin() guards (D-04).
  // @SuperAdmin() applies UseGuards(JwtAuthGuard, SuperAdminGuard); the runtime
  // rejection of non-super-admins is covered by SuperAdminGuard itself. Here we
  // assert the guards are attached to each handler via reflected metadata.
  // -------------------------------------------------------------------------
  it('every route is guarded by @SuperAdmin() (JwtAuthGuard + SuperAdminGuard)', () => {
    const routeMethods = [
      'listSkills',
      'getSkill',
      'createSkill',
      'updateSkill',
      'deleteSkill',
      'getSkillToolIds',
      'assignTools',
      'listTools',
      'listKnowledgeSources',
      'updateKnowledgeSource',
    ] as const;

    for (const method of routeMethods) {
      const handler = (RafaAdminController.prototype as unknown as Record<string, object>)[method];
      const guards = Reflect.getMetadata('__guards__', handler);
      expect(Array.isArray(guards)).toBe(true);
      const guardNames = (guards as Array<new (...args: unknown[]) => unknown>).map(g => g.name);
      expect(guardNames).toEqual(expect.arrayContaining(['JwtAuthGuard', 'SuperAdminGuard']));
    }
  });
});
