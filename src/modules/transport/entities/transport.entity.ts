import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Town } from 'src/modules/towns/entities/town.entity';
import { Category } from 'src/modules/core/entities';
import { User } from 'src/modules/users/entities/user.entity';
import { Review } from 'src/modules/reviews/entities';

@Entity({ name: 'transport' })
export class Transport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // * ----------------------------------------------------------------------------------------------------------------
  // * RELATIONSHIPS
  // * ----------------------------------------------------------------------------------------------------------------

  @ManyToOne(() => Town, town => town.transports, { nullable: false })
  @JoinColumn({ name: 'town_id' })
  town: Town;

  @OneToOne(() => User, user => user.transport, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToMany(() => Category, category => category.transports)
  @JoinTable({
    name: 'transport_category',
    joinColumn: { name: 'transport_id' },
    inverseJoinColumn: { name: 'category_id' },
  })
  categories?: Category[];

  @OneToMany(() => Review, review => review.transport)
  reviews?: Review[];

  /** Premium "información ampliada": towns where the transporter offers the service. */
  @ManyToMany(() => Town)
  @JoinTable({
    name: 'transport_coverage_town',
    joinColumn: { name: 'transport_id' },
    inverseJoinColumn: { name: 'town_id' },
  })
  coverageTowns?: Town[];

  // * ----------------------------------------------------------------------------------------------------------------
  // * MAIN FIELDS
  // * ----------------------------------------------------------------------------------------------------------------

  @Column('smallint', { default: 0 })
  points: number;

  @Column('float', { default: 0 })
  rating: number;

  @Column('integer', { name: 'review_count', default: 0 })
  reviewCount: number;

  @Column('text', { name: 'email', nullable: false })
  email: string;

  @Column('text', { name: 'first_name', nullable: false })
  firstName: string;

  @Column('text', { name: 'last_name', nullable: false })
  lastName: string;

  @Column('text', { name: 'document_type', nullable: false })
  documentType: string;

  @Column('text', { name: 'document', nullable: false })
  document: string;

  @Column('text', { name: 'phone', nullable: false })
  phone: string;

  @Column('text', { name: 'whatsapp', nullable: false })
  whatsapp?: string;

  @Column('text', { name: 'start_time', nullable: true })
  startTime: string;

  @Column('text', { name: 'end_time', nullable: true })
  endTime: string;

  @Column('boolean', { name: 'is_available', nullable: false, default: true })
  isAvailable: boolean;

  @Column('boolean', { name: 'is_public', nullable: true, default: true })
  isPublic: boolean;

  // forced_public: cuando true, el super admin fuerza la visibilidad pública,
  // saltándose status / suscripción (se aplica con OR en la query pública).
  @Column('boolean', { name: 'forced_public', default: false })
  forcedPublic: boolean;

  @Column('boolean', { name: 'show_binntu_reviews', default: true })
  showBinntuReviews: boolean;

  @Column('text', { name: 'license_plate', nullable: false })
  licensePlate: string;

  // Premium "información ampliada" (freemium 2026-10)
  @Column('varchar', { name: 'vehicle_model', length: 120, nullable: true })
  vehicleModel: string | null;

  @Column('integer', { name: 'capacity', nullable: true })
  capacity: number | null;

  @Column('text', { name: 'services', nullable: true })
  services: string | null;

  @Column('text', { name: 'payment_methods', array: true, nullable: true })
  paymentMethods: string[] | null;

  @Column('text', { name: 'status', default: 'draft' })
  status: 'draft' | 'pending_review' | 'published' | 'rejected';

  @Column('timestamp', { name: 'submitted_at', nullable: true })
  submittedAt: Date | null;

  @Column('text', { name: 'rejection_reason', nullable: true })
  rejectionReason: string | null;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', name: 'created_at' })
  createdAt: Date;

  @CreateDateColumn({ name: 'updated_at', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
