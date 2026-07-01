import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A file attached to a skill (references / scripts / assets). Unique per
 * (skill_id, filename). FK → skill ON DELETE CASCADE.
 */
@Entity({ name: 'skill_resource' })
@Index(['skillId'])
export class SkillResource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'skill_id', type: 'uuid' })
  skillId: string;

  @Column({ name: 'filename', type: 'text' })
  filename: string;

  @Column({ name: 'resource_type', type: 'text', default: 'references' })
  resourceType: string;

  @Column({ name: 'content', type: 'text' })
  content: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
