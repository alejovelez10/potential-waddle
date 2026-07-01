import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A knowledge source Rafa can query (BigQuery table / file / REST). Trimmed to
 * the ~13 sync-relevant columns (D-04) — no hierarchy, no tenant columns, no
 * TAIMS auth/fetch/semantic-config sprawl.
 */
@Entity({ name: 'knowledge_source' })
@Index(['isActive'])
export class KnowledgeSource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'type', type: 'text' })
  type: string;

  @Column({ name: 'bigquery_table', type: 'text', nullable: true })
  bigqueryTable: string | null;

  @Column({ name: 'bigquery_schema_code', type: 'text', nullable: true })
  bigquerySchemaCode: string | null;

  @Column({ name: 'vertex_data_store_id', type: 'text', nullable: true })
  vertexDataStoreId: string | null;

  @Column({ name: 'enable_semantic_search', type: 'boolean', default: false })
  enableSemanticSearch: boolean;

  @Column({ name: 'last_sync_at', type: 'timestamptz', nullable: true })
  lastSyncAt: Date | null;

  @Column({ name: 'last_sync_status', type: 'text', nullable: true })
  lastSyncStatus: string | null;

  @Column({ name: 'last_sync_rows', type: 'integer', nullable: true })
  lastSyncRows: number | null;

  @Column({ name: 'last_sync_error', type: 'text', nullable: true })
  lastSyncError: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
