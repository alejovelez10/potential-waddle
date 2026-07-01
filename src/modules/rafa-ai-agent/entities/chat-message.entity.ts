import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One message in a Rafa conversation. `data` holds a pydantic-ai serialized
 * ModelMessage (JSONB, written in Phase 2). `kind` is a varchar string-union,
 * NOT a PG enum. No token_usage / cost (D-04).
 */
@Entity({ name: 'chat_message' })
@Index(['conversationId'])
@Index(['runId'])
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @Column({ name: 'position', type: 'integer' })
  position: number;

  @Column({ name: 'kind', type: 'varchar', length: 20 })
  kind: 'request' | 'response';

  @Column({ name: 'data', type: 'jsonb' })
  data: Record<string, unknown>;

  @Column({ name: 'run_id', type: 'text', nullable: true })
  runId: string | null;

  @Column({ name: 'model_name', type: 'text', nullable: true })
  modelName: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
