import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { KnowledgeSource, Skill, SkillAllowedTool, Tool } from './entities';
import {
  AssignToolsDto,
  CreateSkillDto,
  UpdateKnowledgeSourceDto,
  UpdateSkillDto,
} from './dto';

/**
 * Management API service (ADMIN-01 / SKILL-03). TypeORM CRUD over the existing
 * `rafa-ai-agent` entities — nest is the ONLY writer of the shared DDL (D-01);
 * rafa reads these rows fresh per turn (SC-1 "no redeploy" comes for free).
 *
 * No DDL here: entities already exist; this only reads/writes their rows.
 */
@Injectable()
export class RafaAdminService {
  constructor(
    @InjectRepository(Skill)
    private readonly skillRepo: Repository<Skill>,
    @InjectRepository(Tool)
    private readonly toolRepo: Repository<Tool>,
    @InjectRepository(SkillAllowedTool)
    private readonly grantRepo: Repository<SkillAllowedTool>,
    @InjectRepository(KnowledgeSource)
    private readonly ksRepo: Repository<KnowledgeSource>,
  ) {}

  // ---------------------------------------------------------------------------
  // Skills CRUD
  // ---------------------------------------------------------------------------

  listSkills(): Promise<Skill[]> {
    return this.skillRepo.find({ order: { name: 'ASC' } });
  }

  async getSkill(id: string): Promise<Skill> {
    const skill = await this.skillRepo.findOneBy({ id });
    if (!skill) throw new NotFoundException(`Skill ${id} not found`);
    return skill;
  }

  createSkill(dto: CreateSkillDto): Promise<Skill> {
    return this.skillRepo.save(this.skillRepo.create(dto));
  }

  async updateSkill(id: string, dto: UpdateSkillDto): Promise<Skill> {
    const skill = await this.getSkill(id);
    this.skillRepo.merge(skill, dto);
    return this.skillRepo.save(skill);
  }

  async deleteSkill(id: string): Promise<{ deleted: boolean }> {
    // Join rows (skill_allowed_tool) cascade via FK.
    const result = await this.skillRepo.delete(id);
    if (!result.affected) throw new NotFoundException(`Skill ${id} not found`);
    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Tools catalog
  // ---------------------------------------------------------------------------

  listTools(): Promise<Tool[]> {
    return this.toolRepo.find({ order: { name: 'ASC' } });
  }

  // ---------------------------------------------------------------------------
  // Tool assignment (skill_allowed_tool reconcile)
  // ---------------------------------------------------------------------------

  async getSkillToolIds(id: string): Promise<string[]> {
    const grants = await this.grantRepo.find({ where: { skillId: id } });
    return grants.map(g => g.toolId);
  }

  /**
   * Reconcile the join to EXACTLY `dto.toolIds`: delete grants whose toolId is
   * no longer requested, insert grants for the newly requested ones (the
   * UNIQUE(skill_id, tool_id) prevents dups). Atomic — the whole reconcile runs
   * inside a single transaction. Returns the resulting toolIds.
   */
  async assignTools(id: string, dto: AssignToolsDto): Promise<string[]> {
    // 404 before touching the join.
    await this.getSkill(id);

    const desired = [...new Set(dto.toolIds)];

    return this.skillRepo.manager.transaction(async manager => {
      const grantRepo = manager.getRepository(SkillAllowedTool);
      const current = await grantRepo.find({ where: { skillId: id } });
      const currentIds = current.map(g => g.toolId);

      const toDelete = current.filter(g => !desired.includes(g.toolId));
      const toInsert = desired.filter(toolId => !currentIds.includes(toolId));

      if (toDelete.length > 0) {
        await grantRepo.delete(toDelete.map(g => g.id));
      }
      if (toInsert.length > 0) {
        await grantRepo.save(toInsert.map(toolId => grantRepo.create({ skillId: id, toolId })));
      }

      return desired;
    });
  }

  // ---------------------------------------------------------------------------
  // Knowledge sources (list + v1 toggles only — D-08)
  // ---------------------------------------------------------------------------

  listKnowledgeSources(): Promise<KnowledgeSource[]> {
    return this.ksRepo.find({ order: { name: 'ASC' } });
  }

  async updateKnowledgeSource(id: string, dto: UpdateKnowledgeSourceDto): Promise<KnowledgeSource> {
    const ks = await this.ksRepo.findOneBy({ id });
    if (!ks) throw new NotFoundException(`KnowledgeSource ${id} not found`);
    // Only these two fields are writable in v1.
    if (dto.isActive !== undefined) ks.isActive = dto.isActive;
    if (dto.enableSemanticSearch !== undefined) ks.enableSemanticSearch = dto.enableSemanticSearch;
    return this.ksRepo.save(ks);
  }
}
