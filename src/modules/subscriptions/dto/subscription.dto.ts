import { ApiProperty } from '@nestjs/swagger';
import { Subscription, SubscriptionStatus, EntityType, AssistanceStatus } from '../entities';
import { PlanDto } from './plan.dto';

export class SubscriptionDto {
  @ApiProperty({ example: '624013aa-9555-4a69-bf08-30cf990c56dd' })
  id: string;

  @ApiProperty({ example: '624013aa-9555-4a69-bf08-30cf990c56dd' })
  userId: string;

  @ApiProperty({ example: '624013aa-9555-4a69-bf08-30cf990c56dd' })
  planId: string;

  @ApiProperty({ type: PlanDto, required: false })
  plan?: PlanDto;

  @ApiProperty({ example: '624013aa-9555-4a69-bf08-30cf990c56dd', required: false })
  paymentId: string | null;

  @ApiProperty({ example: 'active', enum: ['pending', 'active', 'canceled', 'past_due', 'expired'] })
  status: SubscriptionStatus;

  @ApiProperty({ example: 'lodging', enum: ['lodging', 'restaurant', 'commerce', 'transport', 'guide'] })
  entityType: EntityType;

  @ApiProperty({ example: '624013aa-9555-4a69-bf08-30cf990c56dd' })
  entityId: string;

  @ApiProperty({ example: 'Hotel San Rafael' })
  entityName: string | null;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  currentPeriodStart: Date;

  @ApiProperty({ example: '2024-02-01T00:00:00.000Z', nullable: true, required: false })
  currentPeriodEnd: Date | null;

  @ApiProperty({ example: null, required: false })
  canceledAt: Date | null;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: true, description: 'If the subscription is currently active' })
  isActive: boolean;

  @ApiProperty({ example: 15, description: 'Days remaining in current period' })
  daysRemaining: number;

  @ApiProperty({ example: false, description: 'If the subscription has expired' })
  isExpired: boolean;

  @ApiProperty({ example: 'Wompi', description: 'Payment type: Wompi or Manual' })
  paymentType: 'Wompi' | 'Manual';

  @ApiProperty({ example: 'pending', enum: ['none', 'pending', 'contacted', 'completed'] })
  assistanceStatus: AssistanceStatus;

  @ApiProperty({ example: false, description: 'Bought through "Registro asistido" (paid while in draft)' })
  assistedOnboarding: boolean;

  @ApiProperty({ example: 'Llamado el 7/10, envía fotos el viernes', nullable: true })
  assistanceNotes: string | null;

  @ApiProperty({
    required: false,
    description: 'Owner contact (only when the user relation is loaded, e.g. admin list)',
    example: { id: 'uuid', username: 'finca-la-montana', email: 'owner@mail.com' },
  })
  user?: { id: string; username: string; email: string };

  constructor(subscription?: Subscription) {
    if (!subscription) return;
    this.id = subscription.id;
    this.userId = subscription.userId;
    this.planId = subscription.planId;
    this.plan = subscription.plan ? new PlanDto(subscription.plan) : undefined;
    this.paymentId = subscription.paymentId;
    this.status = subscription.status;
    this.entityType = subscription.entityType;
    this.entityId = subscription.entityId;
    this.entityName = subscription.entityName;
    this.currentPeriodStart = subscription.currentPeriodStart;
    this.currentPeriodEnd = subscription.currentPeriodEnd;
    this.canceledAt = subscription.canceledAt;
    this.createdAt = subscription.createdAt;
    this.assistanceStatus = subscription.assistanceStatus ?? 'none';
    this.assistedOnboarding = !!subscription.assistedOnboarding;
    this.assistanceNotes = subscription.assistanceNotes ?? null;
    this.user = subscription.user
      ? { id: subscription.user.id, username: subscription.user.username, email: subscription.user.email }
      : undefined;

    const now = new Date();
    // currentPeriodEnd is null for lifetime (Plan Free) subscriptions — they never expire
    this.isExpired = subscription.currentPeriodEnd !== null && now > subscription.currentPeriodEnd;
    this.isActive = subscription.status === 'active' && !this.isExpired;
    this.daysRemaining =
      subscription.currentPeriodEnd !== null
        ? Math.max(0, Math.ceil((subscription.currentPeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
        : Infinity;

    // Determinar tipo de pago
    if (!subscription.paymentId) {
      this.paymentType = 'Manual';
    } else if (subscription.payment?.wompiTransactionId) {
      this.paymentType = 'Wompi';
    } else {
      this.paymentType = 'Manual';
    }
  }
}
