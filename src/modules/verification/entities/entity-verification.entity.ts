import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const VERIFICATION_ENTITY_TYPES = ['lodging', 'restaurant', 'commerce', 'guide', 'transport'] as const;
export type VerificationEntityType = (typeof VERIFICATION_ENTITY_TYPES)[number];

/**
 * - requested: the owner submitted the verification request (required documents uploaded)
 * - verified:  Binntu reviewed and approved every required document → "✓ Verificado" seal
 * - rejected:  the request was declined (reason shown to the owner, who can request again)
 * - revoked:   a granted seal was withdrawn (e.g. expired or invalid documents)
 */
export type VerificationStatus = 'requested' | 'verified' | 'rejected' | 'revoked';

/**
 * "Negocio / Transportador / Guía verificado" (freemium 2026-10). Independent from Premium:
 * it is never sold — free and Premium businesses can both obtain it. Polymorphic like
 * `entity_badge` and `subscriptions` (entityId has no FK).
 */
@Entity('entity_verification')
@Index(['entityType', 'entityId'], { unique: true })
export class EntityVerification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 20 })
  entityType: VerificationEntityType;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId: string;

  @Column({ type: 'varchar', length: 20 })
  status: VerificationStatus;

  @Column({ name: 'requested_at', type: 'timestamptz', nullable: true })
  requestedAt: Date | null;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @Column({ name: 'reviewed_by_id', type: 'uuid', nullable: true })
  reviewedById: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
