import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A Rafa skill: instructions (`body`) injected into the prompt, plus tool
 * gating (`allowed_tool_patterns` globbed against tool.name). `name` is unique
 * among ACTIVE rows (partial-unique index hand-added in the migration).
 * Mono-tenant: none of the multi-tenant scoping columns (D-04).
 */
@Entity({ name: 'skill' })
export class Skill {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({ name: 'description', type: 'text' })
  description: string;

  @Column({ name: 'body', type: 'text' })
  body: string;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'" })
  metadata: Record<string, unknown>;

  @Column({ name: 'allowed_tool_patterns', type: 'text', array: true, default: () => "'{}'" })
  allowedToolPatterns: string[];

  @Column({ name: 'auto_invoke', type: 'boolean', default: true })
  autoInvoke: boolean;

  @Column({ name: 'always_active', type: 'boolean', default: false })
  alwaysActive: boolean;

  @Column({ name: 'active', type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
