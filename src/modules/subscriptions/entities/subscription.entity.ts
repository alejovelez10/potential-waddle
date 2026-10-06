import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from 'src/modules/users/entities';
import { Plan } from './plan.entity';
import { Payment } from './payment.entity';

export type SubscriptionStatus = 'pending' | 'active' | 'canceled' | 'past_due' | 'expired';
export type EntityType = 'lodging' | 'restaurant' | 'commerce' | 'transport' | 'guide' | 'experience';
/** Freemium: Premium includes accompaniment from the Binntu team (follow-up queue in the admin). */
export type AssistanceStatus = 'none' | 'pending' | 'contacted' | 'completed';

@Entity({ name: 'subscriptions' })
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // * ----------------------------------------------------------------------------------------------------------------
  // * RELATIONSHIPS
  // * ----------------------------------------------------------------------------------------------------------------
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column('uuid', { name: 'user_id' })
  userId: string;

  @ManyToOne(() => Plan)
  @JoinColumn({ name: 'plan_id' })
  plan: Plan;

  @Column('uuid', { name: 'plan_id' })
  planId: string;

  @ManyToOne(() => Payment, payment => payment.subscriptions, { nullable: true })
  @JoinColumn({ name: 'payment_id' })
  payment: Payment | null;

  @Column('uuid', { name: 'payment_id', nullable: true })
  paymentId: string | null;

  // * ----------------------------------------------------------------------------------------------------------------
  // * MAIN FIELDS
  // * ----------------------------------------------------------------------------------------------------------------
  @Column('varchar', { length: 20 })
  status: SubscriptionStatus;

  @Column('varchar', { length: 50, name: 'entity_type' })
  entityType: EntityType;

  @Column('uuid', { name: 'entity_id' })
  entityId: string;

  @Column('varchar', { length: 255, nullable: true, name: 'entity_name' })
  entityName: string | null; // Nombre del negocio para referencia

  @Column('timestamp', { name: 'current_period_start' })
  currentPeriodStart: Date;

  @Column('timestamp', { name: 'current_period_end', nullable: true })
  currentPeriodEnd: Date | null;

  @Column('timestamp', { nullable: true, name: 'canceled_at' })
  canceledAt: Date | null;

  @Column('varchar', { length: 20, name: 'assistance_status', default: 'none' })
  assistanceStatus: AssistanceStatus;

  /** Bought through "Registro asistido": paid while the business was still a draft. */
  @Column('boolean', { name: 'assisted_onboarding', default: false })
  assistedOnboarding: boolean;

  @Column('text', { name: 'assistance_notes', nullable: true })
  assistanceNotes: string | null;

  @Column('uuid', { name: 'assisted_by_id', nullable: true })
  assistedById: string | null;

  @Column('timestamptz', { name: 'assistance_updated_at', nullable: true })
  assistanceUpdatedAt: Date | null;

  // * ----------------------------------------------------------------------------------------------------------------
  // * TIMESTAMPS
  // * ----------------------------------------------------------------------------------------------------------------
  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', name: 'created_at' })
  createdAt: Date;

  @Column('timestamp', { name: 'updated_at', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
