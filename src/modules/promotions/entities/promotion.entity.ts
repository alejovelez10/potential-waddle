import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export type PromotionEntityType = 'lodging' | 'restaurant' | 'experience' | 'guide' | 'commerce';

@Entity()
@Index(['entityType', 'entityId'])
export class Promotion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'entity_id' })
  entityId: string;

  @Column({ name: 'entity_type' })
  entityType: PromotionEntityType;

  @Column({ name: 'entity_slug', nullable: true })
  entitySlug?: string;

  @Column()
  name: string;

  @Column('text')
  description: string;

  @Column({ name: 'valid_from' })
  validFrom: Date;

  @Column({ name: 'valid_to' })
  validTo: Date;

  @Column()
  image: string;

  @Column('float')
  value: number;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', name: 'created_at' })
  createdAt: Date;

  @CreateDateColumn({ name: 'updated_at', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
