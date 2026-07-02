import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';

import { RafaAdminService } from './rafa-admin.service';
import { KnowledgeSource, Skill, SkillAllowedTool, Tool } from './entities';
import { CreateSkillDto } from './dto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SKILL_ID = '00000000-0000-0000-0000-000000000001';
const T1 = '00000000-0000-0000-0000-0000000000a1';
const T2 = '00000000-0000-0000-0000-0000000000b2';
const T3 = '00000000-0000-0000-0000-0000000000c3';

const makeRepo = () => ({
  find: jest.fn(),
  findOneBy: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  merge: jest.fn(),
  delete: jest.fn(),
});

async function buildModule() {
  const skillRepo = makeRepo();
  const toolRepo = makeRepo();
  const grantRepo = makeRepo();
  const ksRepo = makeRepo();

  // assignTools runs inside skillRepo.manager.transaction(cb). Route the
  // transactional getRepository(SkillAllowedTool) back to the SAME grantRepo
  // mock so we can assert the reconcile (delete/insert) on it.
  (skillRepo as any).manager = {
    transaction: jest.fn(async (cb: (m: any) => Promise<unknown>) =>
      cb({ getRepository: () => grantRepo }),
    ),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      RafaAdminService,
      { provide: getRepositoryToken(Skill), useValue: skillRepo },
      { provide: getRepositoryToken(Tool), useValue: toolRepo },
      { provide: getRepositoryToken(SkillAllowedTool), useValue: grantRepo },
      { provide: getRepositoryToken(KnowledgeSource), useValue: ksRepo },
    ],
  }).compile();

  return {
    service: module.get<RafaAdminService>(RafaAdminService),
    skillRepo,
    toolRepo,
    grantRepo,
    ksRepo,
  };
}

// ===========================================================================

describe('RafaAdminService', () => {
  let service: RafaAdminService;
  let skillRepo: ReturnType<typeof makeRepo>;
  let grantRepo: ReturnType<typeof makeRepo>;
  let ksRepo: ReturnType<typeof makeRepo>;

  beforeEach(async () => {
    jest.clearAllMocks();
    const ctx = await buildModule();
    service = ctx.service;
    skillRepo = ctx.skillRepo;
    grantRepo = ctx.grantRepo;
    ksRepo = ctx.ksRepo;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // createSkill
  // -------------------------------------------------------------------------
  it('createSkill: creates + saves the dto', async () => {
    const dto: CreateSkillDto = {
      name: 'rafa-persona',
      description: 'persona base',
      body: 'Sos Rafa...',
    };
    const entity = { ...dto } as Skill;
    const saved = { ...dto, id: SKILL_ID } as Skill;
    skillRepo.create.mockReturnValue(entity);
    skillRepo.save.mockResolvedValue(saved);

    const result = await service.createSkill(dto);

    expect(skillRepo.create).toHaveBeenCalledWith(dto);
    expect(skillRepo.save).toHaveBeenCalledWith(entity);
    expect(result).toEqual(saved);
  });

  // -------------------------------------------------------------------------
  // getSkill 404
  // -------------------------------------------------------------------------
  it('getSkill: throws NotFound when missing', async () => {
    skillRepo.findOneBy.mockResolvedValue(null);
    await expect(service.getSkill(SKILL_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  // -------------------------------------------------------------------------
  // assignTools reconcile: current [t1,t2], desired [t2,t3] -> del t1, ins t3
  // -------------------------------------------------------------------------
  it('assignTools: reconciles the join (delete t1, insert t3, leaving [t2,t3])', async () => {
    skillRepo.findOneBy.mockResolvedValue({ id: SKILL_ID } as Skill);
    grantRepo.find.mockResolvedValue([
      { id: 'grant-1', skillId: SKILL_ID, toolId: T1 },
      { id: 'grant-2', skillId: SKILL_ID, toolId: T2 },
    ]);
    grantRepo.create.mockImplementation((x: any) => x);
    grantRepo.save.mockResolvedValue(undefined);
    grantRepo.delete.mockResolvedValue({ affected: 1 });

    const result = await service.assignTools(SKILL_ID, { toolIds: [T2, T3] });

    // transaction was used
    expect((skillRepo as any).manager.transaction).toHaveBeenCalledTimes(1);
    // t1 deleted (by its grant id), t3 inserted
    expect(grantRepo.delete).toHaveBeenCalledWith(['grant-1']);
    expect(grantRepo.save).toHaveBeenCalledWith([{ skillId: SKILL_ID, toolId: T3 }]);
    // t2 neither deleted nor re-inserted
    expect(grantRepo.create).toHaveBeenCalledTimes(1);
    expect(grantRepo.create).toHaveBeenCalledWith({ skillId: SKILL_ID, toolId: T3 });
    // resulting set is exactly the desired ids
    expect(result).toEqual([T2, T3]);
  });

  it('assignTools: throws NotFound when the skill is missing', async () => {
    skillRepo.findOneBy.mockResolvedValue(null);
    await expect(service.assignTools(SKILL_ID, { toolIds: [T1] })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect((skillRepo as any).manager.transaction).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // updateKnowledgeSource: only toggles the two v1 fields
  // -------------------------------------------------------------------------
  it('updateKnowledgeSource: toggles isActive/enableSemanticSearch only', async () => {
    const ks = { id: 'ks-1', isActive: true, enableSemanticSearch: false } as KnowledgeSource;
    ksRepo.findOneBy.mockResolvedValue(ks);
    ksRepo.save.mockImplementation((x: any) => Promise.resolve(x));

    const result = await service.updateKnowledgeSource('ks-1', {
      isActive: false,
      enableSemanticSearch: true,
    });

    expect(result.isActive).toBe(false);
    expect(result.enableSemanticSearch).toBe(true);
    expect(ksRepo.save).toHaveBeenCalledWith(ks);
  });

  it('updateKnowledgeSource: throws NotFound when missing', async () => {
    ksRepo.findOneBy.mockResolvedValue(null);
    await expect(service.updateKnowledgeSource('ks-x', { isActive: false })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
