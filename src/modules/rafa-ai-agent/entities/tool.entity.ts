import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Global tool catalog. `name` is globally unique (pydantic-ai 2.0 requires
 * unique tool names across toolsets).
 */
@Entity({ name: 'tool' })
export class Tool {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'name', type: 'text', unique: true })
  name: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'input_schema', type: 'jsonb', nullable: true })
  inputSchema: Record<string, unknown> | null;

  @Column({ name: 'output_schema', type: 'jsonb', nullable: true })
  outputSchema: Record<string, unknown> | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
