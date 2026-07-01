import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Audit log of a knowledge-source sync run. Template shape follows binntu-nest's
 * `google_review_sync_log`. `status` is a varchar string-union, NOT a PG enum.
 * FK → knowledge_source ON DELETE CASCADE.
 */
@Entity({ name: 'knowledge_source_sync_log' })
@Index(['knowledgeSourceId', 'createdAt'])
export class KnowledgeSourceSyncLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'knowledge_source_id', type: 'uuid' })
  knowledgeSourceId: string;

  @Column({ name: 'status', type: 'varchar', length: 20 })
  status: 'pending' | 'in_progress' | 'completed' | 'error';

  @Column({ name: 'rows_synced', type: 'integer', nullable: true })
  rowsSynced: number | null;

  @Column({ name: 'duration_ms', type: 'integer', nullable: true })
  durationMs: number | null;

  @Column({ name: 'error', type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'triggered_by', type: 'text', nullable: true })
  triggeredBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
