import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A Rafa AI conversation thread (mono-tenant).
 *
 * `user_id` (nullable) links a logged-in binntu user (FK → users ON DELETE
 * CASCADE); `visitor_key` (nullable) identifies an anonymous web visitor or a
 * WhatsApp phone. Mono-tenant: none of the multi-tenant scoping columns (D-04).
 */
@Entity({ name: 'chat_conversation' })
@Index(['userId'])
@Index(['visitorKey'])
export class ChatConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'visitor_key', type: 'text', nullable: true })
  visitorKey: string | null;

  @Column({ name: 'channel', type: 'varchar', length: 20, default: 'web' })
  channel: 'web' | 'whatsapp';

  @Column({ name: 'title', type: 'text', nullable: true })
  title: string | null;

  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
