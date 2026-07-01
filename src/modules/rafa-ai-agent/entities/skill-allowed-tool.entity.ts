import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Join table: explicit skill → tool grants. Unique per (skill_id, tool_id).
 * FK → skill CASCADE, FK → tool CASCADE.
 */
@Entity({ name: 'skill_allowed_tool' })
@Index(['skillId'])
export class SkillAllowedTool {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'skill_id', type: 'uuid' })
  skillId: string;

  @Column({ name: 'tool_id', type: 'uuid' })
  toolId: string;
}
