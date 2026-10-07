import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, ILike } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

import { Subscription, Plan, EntityType, AssistanceStatus } from '../entities';
import { SubscriptionDto, CreateCheckoutDto, CheckoutResponseDto, AdminCreateSubscriptionDto } from '../dto';
import { PlansService } from './plans.service';
import { PaymentsService } from './payments.service';
import { EntityOwnershipResolver } from 'src/modules/common/services/entity-ownership.resolver';
import { PLAN_LIMITS } from '../constants/plan-limits';
import { ResendService } from 'src/modules/email/services/resend.service';

/** Whitelisted workflow-status lookup per purchasable type ($1 = entity id). */
const ENTITY_STATUS_QUERY: Partial<Record<EntityType, string>> = {
  lodging: 'SELECT status FROM "lodging" WHERE id = $1',
  restaurant: 'SELECT status FROM "restaurant" WHERE id = $1',
  commerce: 'SELECT status FROM "commerce" WHERE id = $1',
  guide: 'SELECT status FROM "guide" WHERE id = $1',
  transport: 'SELECT status FROM "transport" WHERE id = $1',
};

const PROFILE_PATH: Partial<Record<EntityType, string>> = {
  lodging: 'lodgings',
  restaurant: 'restaurants',
  commerce: 'commerce',
  guide: 'guides',
  transport: 'transport',
};
import { User } from 'src/modules/users/entities';
import { SearchSyncQueue } from 'src/modules/search/search-sync.queue';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,

    @InjectRepository(Plan)
    private readonly planRepository: Repository<Plan>,

    private readonly plansService: PlansService,
    private readonly paymentsService: PaymentsService,
    private readonly configService: ConfigService,
    private readonly ownership: EntityOwnershipResolver,
    private readonly resendService: ResendService,
    private readonly searchSync: SearchSyncQueue,
  ) {}

  /** Premium changed → refresh the catalog records (experiences follow their guide in the indexer). */
  private syncPremium(subscriptions: Pick<Subscription, 'entityType' | 'entityId'>[]) {
    for (const subscription of subscriptions) this.searchSync.mark(subscription.entityType, subscription.entityId);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * QUERIES
  // * ----------------------------------------------------------------------------------------------------------------

  async findAllByUser(userId: string): Promise<SubscriptionDto[]> {
    const subscriptions = await this.subscriptionRepository.find({
      where: { userId },
      relations: { plan: { features: true } },
      order: { createdAt: 'DESC' },
    });

    return subscriptions.map(sub => new SubscriptionDto(sub));
  }

  async findOne(id: string): Promise<SubscriptionDto> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { id },
      relations: { plan: { features: true }, payment: true },
    });

    if (!subscription) throw new NotFoundException(`Subscription with id ${id} not found`);
    return new SubscriptionDto(subscription);
  }

  async findByEntity(entityType: EntityType, entityId: string): Promise<SubscriptionDto | null> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { entityType, entityId },
      relations: { plan: { features: true } },
      order: { createdAt: 'DESC' },
    });

    return subscription ? new SubscriptionDto(subscription) : null;
  }

  async getActiveSubscription(entityType: EntityType, entityId: string): Promise<Subscription | null> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { entityType, entityId, status: 'active' },
      relations: { plan: { features: true } },
    });

    // Verificar si no ha expirado. currentPeriodEnd is null for lifetime subscriptions — they never expire.
    if (subscription && subscription.currentPeriodEnd !== null && new Date() > subscription.currentPeriodEnd) {
      // Marcar como expirada
      subscription.status = 'expired';
      await this.subscriptionRepository.save(subscription);
      return null;
    }

    return subscription;
  }

  async hasActiveSubscription(entityType: EntityType, entityId: string): Promise<boolean> {
    const subscription = await this.getActiveSubscription(entityType, entityId);
    return !!subscription;
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * CHECKOUT - Crear pago pendiente con suscripciones
  // * ----------------------------------------------------------------------------------------------------------------

  async createCheckout(user: User, dto: CreateCheckoutDto): Promise<CheckoutResponseDto> {
    const userId = user.id;

    // 1. Un negocio no puede venir dos veces en el mismo carrito
    const itemKeys = dto.items.map(item => `${item.entityType}:${item.entityId}`);
    if (new Set(itemKeys).size !== itemKeys.length) {
      throw new BadRequestException('Un negocio aparece más de una vez en el carrito');
    }

    // 2. Solo el dueño (o un admin del municipio / super) puede pagar por un negocio,
    //    y no puede tener ya una suscripción activa
    for (const item of dto.items) {
      await this.ownership.assertCanManage(item.entityType, item.entityId, user);

      const hasActive = await this.hasActiveSubscription(item.entityType, item.entityId);
      if (hasActive) {
        throw new BadRequestException(`El negocio "${item.entityName}" ya tiene una suscripción activa`);
      }

      // Approval first, payment after (refunds are costly in COL). The only exception is the
      // "Registro asistido Premium": the owner pays upfront and the Binntu team helps publish it.
      if (!item.assisted) {
        const entityStatus = await this.getEntityWorkflowStatus(item.entityType, item.entityId);
        if (entityStatus !== 'published') {
          throw new BadRequestException({
            errorCode: 'APPROVAL_REQUIRED',
            message: `El negocio "${item.entityName}" debe estar aprobado antes de pagar Premium`,
            currentStatus: entityStatus,
          });
        }
      }
    }

    // 3. Obtener los planes, validarlos y calcular el total
    const planIds = [...new Set(dto.items.map(item => item.planId))];
    const plans = await this.planRepository.find({ where: { id: In(planIds) } });
    const plansMap = new Map(plans.map(p => [p.id, p]));

    let totalAmountInCents = 0;
    const itemsDetail: CheckoutResponseDto['items'] = [];

    for (const item of dto.items) {
      const plan = plansMap.get(item.planId);
      if (!plan) throw new NotFoundException(`Plan con id ${item.planId} no encontrado`);
      if (!plan.isActive) throw new BadRequestException(`El plan "${plan.name}" no está disponible`);
      // entityTypes vacío = aplica a todos los tipos (backward-compat)
      if (plan.entityTypes?.length && !plan.entityTypes.includes(item.entityType)) {
        throw new BadRequestException(`El plan "${plan.name}" no aplica para este tipo de negocio`);
      }

      totalAmountInCents += plan.priceInCents;
      itemsDetail.push({
        entityName: item.entityName,
        planName: plan.name,
        priceInCents: plan.priceInCents,
        price: Math.round(plan.priceInCents / 100),
      });
    }

    // 4. Generar referencia única
    const reference = this.paymentsService.generateReference();

    // 5. Crear el Payment pendiente
    const payment = await this.paymentsService.create({
      userId,
      reference,
      amountInCents: totalAmountInCents,
    });

    // 6. Crear las Subscriptions pendientes vinculadas al payment.
    //    Las fechas SIEMPRE las calcula el servidor según el billing interval del plan
    //    (solo el grant manual del admin puede fijar fechas arbitrarias).
    const now = new Date();

    for (const item of dto.items) {
      const plan = plansMap.get(item.planId)!;

      const periodStart = now;
      const periodEnd = new Date(periodStart);
      if (plan.billingInterval === 'lifetime') {
        periodEnd.setFullYear(2099, 11, 31);
      } else if (plan.billingInterval === 'yearly') {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }

      const subscription = this.subscriptionRepository.create({
        userId,
        planId: item.planId,
        paymentId: payment.id,
        status: 'pending',
        entityType: item.entityType,
        entityId: item.entityId,
        entityName: item.entityName,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        // Every Premium includes accompaniment. It enters the follow-up queue ('pending') only when
        // the payment is approved (activateSubscriptionsByPayment) — abandoned checkouts never do.
        assistanceStatus: 'none',
        assistedOnboarding: !!item.assisted,
      });

      await this.subscriptionRepository.save(subscription);
    }

    // 7. Generar firma de integridad para el widget de Wompi
    const integritySecret = this.configService.get<string>('WOMPI_INTEGRITY_SECRET');
    const signature = crypto
      .createHash('sha256')
      .update(`${reference}${totalAmountInCents}COP${integritySecret}`)
      .digest('hex');

    // 8. Generar URL de redirección
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const redirectUrl = `${frontendUrl}/profile/suscripciones?payment=${payment.id}`;

    return {
      paymentId: payment.id,
      reference,
      amountInCents: totalAmountInCents,
      amount: Math.round(totalAmountInCents / 100),
      currency: 'COP',
      publicKey: this.configService.get<string>('WOMPI_PUBLIC_KEY') || '',
      signature,
      redirectUrl,
      items: itemsDetail,
    };
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * ACTIVAR SUSCRIPCIONES - Llamado cuando el pago es aprobado
  // * ----------------------------------------------------------------------------------------------------------------

  async activateSubscriptionsByPayment(paymentId: string): Promise<void> {
    const subscriptions = await this.subscriptionRepository.find({
      where: { paymentId },
      relations: { user: true, plan: true },
    });

    // Las fechas ya las calculó createCheckout según el billingInterval del plan.
    // Activar es solo un flip de status. Idempotente: webhooks repetidos no re-notifican.
    const newlyActivated: Subscription[] = [];
    for (const subscription of subscriptions) {
      if (subscription.status === 'active') continue;
      subscription.status = 'active';
      // Paid Premium → accompaniment follow-up queue
      if (subscription.assistanceStatus === 'none') subscription.assistanceStatus = 'pending';
      await this.subscriptionRepository.save(subscription);
      newlyActivated.push(subscription);
    }

    for (const subscription of newlyActivated) {
      this.notifyPremiumAssistance(subscription);
    }
    this.syncPremium(newlyActivated);
  }

  /** Premium activated → alert the Binntu team (accompaniment queue) and reassure the owner. */
  private notifyPremiumAssistance(subscription: Subscription) {
    const name = subscription.entityName ?? 'tu negocio';
    const profilePath = PROFILE_PATH[subscription.entityType];

    void this.resendService.sendAdminNotification({
      subject: `${subscription.assistedOnboarding ? 'Registro asistido' : 'Nuevo Premium'}: ${name}`,
      title: subscription.assistedOnboarding ? 'Nuevo registro asistido Premium' : 'Nuevo negocio Premium',
      intro: subscription.assistedOnboarding
        ? 'Pagó Premium con el negocio en borrador y espera que el equipo lo contacte para completar el perfil.'
        : 'Contacta al dueño para acompañarlo a optimizar su perfil y, si quiere, solicitar la verificación.',
      rows: [
        ['Negocio', name],
        ['Tipo', subscription.entityType],
        ['Plan', subscription.plan?.name],
        ['Dueño', subscription.user?.email],
      ],
      path: '/admin/subscriptions?assistance=pending',
      ctaLabel: 'Ver acompañamientos pendientes',
    });

    if (subscription.user?.email) {
      void this.resendService.sendOwnerNotification(subscription.user.email, {
        subject: '¡Bienvenido a Binntu Premium!',
        title: 'Tu Premium está activo',
        intro: subscription.assistedOnboarding
          ? 'Una persona del equipo de Binntu te contactará en las próximas 24-48 horas para ayudarte a completar el perfil de tu negocio.'
          : 'Una persona del equipo de Binntu te contactará para ayudarte a optimizar tu perfil y, si quieres, solicitar el sello Verificado.',
        rows: [['Negocio', name]],
        path: profilePath ? `/profile/${profilePath}/${subscription.entityId}/edit` : '/profile/negocios',
        ctaLabel: 'Ir a mi negocio',
      });
    }
  }

  private async getEntityWorkflowStatus(entityType: EntityType, entityId: string): Promise<string | null> {
    const sql = ENTITY_STATUS_QUERY[entityType];
    if (!sql) throw new BadRequestException(`El tipo "${entityType}" no se puede suscribir`);
    const rows: { status: string }[] = await this.subscriptionRepository.manager.query(sql, [entityId]);
    return rows[0]?.status ?? null;
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * ADMIN - ACOMPAÑAMIENTO PREMIUM
  // * ----------------------------------------------------------------------------------------------------------------

  async updateAssistance(
    id: string,
    data: { status: AssistanceStatus; notes?: string | null },
    admin: User,
  ): Promise<SubscriptionDto> {
    const subscription = await this.subscriptionRepository.findOne({ where: { id } });
    if (!subscription) throw new NotFoundException(`Subscription with id ${id} not found`);

    subscription.assistanceStatus = data.status;
    if (data.notes !== undefined) subscription.assistanceNotes = data.notes;
    subscription.assistedById = admin.id;
    subscription.assistanceUpdatedAt = new Date();
    await this.subscriptionRepository.save(subscription);

    return this.findOne(id);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * MARCAR COMO FALLIDAS - Llamado cuando el pago falla
  // * ----------------------------------------------------------------------------------------------------------------

  async failSubscriptionsByPayment(paymentId: string): Promise<void> {
    const affected = await this.subscriptionRepository.find({
      where: { paymentId },
      select: { entityType: true, entityId: true },
    });
    await this.subscriptionRepository.update({ paymentId }, { status: 'past_due' });
    this.syncPremium(affected);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * CANCELAR
  // * ----------------------------------------------------------------------------------------------------------------

  async cancel(id: string, userId: string): Promise<SubscriptionDto> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { id, userId },
      relations: { plan: true },
    });

    if (!subscription) throw new NotFoundException('Subscription not found');
    if (subscription.status === 'canceled') {
      throw new BadRequestException('La suscripción ya está cancelada');
    }

    subscription.status = 'canceled';
    subscription.canceledAt = new Date();

    await this.subscriptionRepository.save(subscription);
    this.syncPremium([subscription]);
    return new SubscriptionDto(subscription);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * ADMIN - LISTAR TODAS LAS SUSCRIPCIONES
  // * ----------------------------------------------------------------------------------------------------------------

  async findAllAdmin(filters: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    entityType?: EntityType;
    assistanceStatus?: AssistanceStatus;
    sortBy?: 'createdAt' | 'updatedAt' | 'currentPeriodEnd';
    sortOrder?: 'ASC' | 'DESC';
  }): Promise<{ data: SubscriptionDto[]; count: number; pages: number; currentPage: number }> {
    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const skip = (page - 1) * limit;
    const sortBy = filters.sortBy || 'createdAt';
    const sortOrder = filters.sortOrder || 'DESC';

    const where: any = {};

    if (filters.search) {
      where.entityName = ILike(`%${filters.search}%`);
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.entityType) {
      where.entityType = filters.entityType;
    }

    if (filters.assistanceStatus) {
      where.assistanceStatus = filters.assistanceStatus;
    }

    const [subscriptions, count] = await this.subscriptionRepository.findAndCount({
      where,
      relations: { plan: { features: true }, user: true, payment: true },
      order: { [sortBy]: sortOrder },
      skip,
      take: limit,
    });

    return {
      data: subscriptions.map(sub => new SubscriptionDto(sub)),
      count,
      pages: Math.ceil(count / limit),
      currentPage: page,
    };
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * ADMIN - CREAR SUSCRIPCIÓN MANUAL
  // * ----------------------------------------------------------------------------------------------------------------

  async createManualSubscription(dto: AdminCreateSubscriptionDto): Promise<SubscriptionDto> {
    // Verificar que el plan existe
    const plan = await this.planRepository.findOne({
      where: { id: dto.planId },
      relations: { features: true },
    });
    if (!plan) throw new NotFoundException(`Plan con id ${dto.planId} no encontrado`);

    // Calcular fechas si no se proporcionan
    const now = new Date();
    const periodStart = dto.currentPeriodStart ? new Date(dto.currentPeriodStart) : now;
    let periodEnd: Date;

    if (dto.currentPeriodEnd) {
      periodEnd = new Date(dto.currentPeriodEnd);
    } else {
      // Calcular según billing interval del plan
      periodEnd = new Date(periodStart);
      if (plan.billingInterval === 'lifetime') {
        periodEnd.setFullYear(2099, 11, 31);
      } else if (plan.billingInterval === 'yearly') {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }
    }

    const subscription = this.subscriptionRepository.create({
      userId: dto.userId,
      planId: dto.planId,
      paymentId: null, // Sin pago asociado (creación manual)
      status: dto.status || 'active',
      entityType: dto.entityType,
      entityId: dto.entityId,
      entityName: dto.entityName,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    });

    await this.subscriptionRepository.save(subscription);
    this.syncPremium([subscription]);

    // Recargar con relaciones
    const savedSubscription = await this.subscriptionRepository.findOne({
      where: { id: subscription.id },
      relations: { plan: { features: true } },
    });

    return new SubscriptionDto(savedSubscription!);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * ADMIN - ELIMINAR SUSCRIPCIÓN (para pruebas)
  // * ----------------------------------------------------------------------------------------------------------------

  async deleteSubscription(id: string): Promise<void> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { id },
    });

    if (!subscription) throw new NotFoundException(`Subscription with id ${id} not found`);

    const { entityType, entityId } = subscription;
    await this.subscriptionRepository.remove(subscription);
    this.syncPremium([{ entityType, entityId }]);
  }

  /**
   * Bulk delete subscriptions by id. Returns the count actually removed.
   * Ids that don't exist are silently skipped (idempotent — useful for
   * concurrent admin sessions where one might have already deleted a row).
   */
  async bulkDeleteSubscriptions(ids: string[]): Promise<{ deleted: number }> {
    if (!ids?.length) return { deleted: 0 };

    const affected = await this.subscriptionRepository.find({
      where: { id: In(ids) },
      select: { entityType: true, entityId: true },
    });
    const result = await this.subscriptionRepository.delete({ id: In(ids) });
    this.syncPremium(affected);
    return { deleted: result.affected ?? 0 };
  }

  /**
   * Return the IDs of all business entities of the given type that are PREMIUM,
   * i.e. currently have an ACTIVE subscription (paid or admin-granted, any plan —
   * including the legacy lifetime "Plan Free Lodging" founders' grants).
   *
   * Freemium (2026-10): public visibility no longer depends on this — free
   * businesses are listed too. This set drives Premium benefits only (ranking,
   * Premium seal, promotions, analytics, photo limits, Google sync).
   *
   * "Active" here means:
   *   • status = 'active'
   *   • AND (currentPeriodEnd IS NULL OR currentPeriodEnd > NOW())
   *     — null is treated as perpetual / lifetime, never expired.
   */
  async getActiveSubscribedEntityIds(entityType: EntityType): Promise<string[]> {
    const rows = await this.subscriptionRepository
      .createQueryBuilder('s')
      .select('DISTINCT s.entity_id', 'entityId')
      .where('s.entity_type = :entityType', { entityType })
      .andWhere('s.status = :status', { status: 'active' })
      .andWhere('(s.current_period_end IS NULL OR s.current_period_end > NOW())')
      .getRawMany();

    return rows.map(r => r.entityId).filter((id): id is string => !!id);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * PREMIUM (freemium 2026-10) — Premium = any active subscription. Experiences inherit from their guide.
  // * ----------------------------------------------------------------------------------------------------------------

  /** Set of Premium entity ids for a type. Experiences resolve through their guide's subscription. */
  async getPremiumIdSet(entityType: EntityType): Promise<Set<string>> {
    if (entityType === 'experience') {
      const guideIds = await this.getActiveSubscribedEntityIds('guide');
      if (guideIds.length === 0) return new Set();
      const rows: { id: string }[] = await this.subscriptionRepository.manager.query(
        'SELECT id FROM "experience" WHERE guide_id = ANY($1::uuid[])',
        [guideIds],
      );
      return new Set(rows.map(r => r.id));
    }
    return new Set(await this.getActiveSubscribedEntityIds(entityType));
  }

  /** Whether a single entity is Premium. Experiences resolve through their guide. */
  async isPremium(entityType: EntityType, entityId: string): Promise<boolean> {
    let targetType: EntityType = entityType;
    let targetId = entityId;

    if (entityType === 'experience') {
      const rows: { guide_id: string | null }[] = await this.subscriptionRepository.manager.query(
        'SELECT guide_id FROM "experience" WHERE id = $1',
        [entityId],
      );
      if (!rows[0]?.guide_id) return false;
      targetType = 'guide';
      targetId = rows[0].guide_id;
    }

    const count = await this.subscriptionRepository
      .createQueryBuilder('s')
      .where('s.entity_type = :entityType', { entityType: targetType })
      .andWhere('s.entity_id = :entityId', { entityId: targetId })
      .andWhere('s.status = :status', { status: 'active' })
      .andWhere('(s.current_period_end IS NULL OR s.current_period_end > NOW())')
      .getCount();

    return count > 0;
  }

  /**
   * Photo gallery capacity: Free 10 / Premium 30 (PLAN_LIMITS). Existing photos over the limit
   * are never deleted — only new uploads are blocked (e.g. after a Premium lapses).
   */
  async assertPhotoCapacity(entityType: EntityType, entityId: string, currentCount: number, incoming: number) {
    const isPremium = await this.isPremium(entityType, entityId);
    const limit = isPremium ? PLAN_LIMITS.premium.maxPhotos : PLAN_LIMITS.free.maxPhotos;
    if (currentCount + incoming <= limit) return;

    throw new ForbiddenException({
      errorCode: isPremium ? 'PHOTO_LIMIT_REACHED' : 'PREMIUM_REQUIRED',
      feature: 'photos',
      limit,
      current: currentCount,
      message: isPremium
        ? `Alcanzaste el máximo de ${limit} fotos`
        : `El plan gratuito permite hasta ${limit} fotos. Con Binntu Premium puedes subir hasta ${PLAN_LIMITS.premium.maxPhotos}.`,
    });
  }

  /** Throws 403 with a stable errorCode the frontend can turn into an upsell. */
  async assertPremium(entityType: EntityType, entityId: string, feature: string): Promise<void> {
    if (await this.isPremium(entityType, entityId)) return;
    throw new ForbiddenException({
      errorCode: 'PREMIUM_REQUIRED',
      feature,
      message: 'Esta funcionalidad está disponible con Binntu Premium',
    });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * ADMIN - CANCELAR SUSCRIPCIÓN (sin verificar userId)
  // * ----------------------------------------------------------------------------------------------------------------

  async adminCancel(id: string): Promise<SubscriptionDto> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { id },
      relations: { plan: true },
    });

    if (!subscription) throw new NotFoundException('Subscription not found');
    if (subscription.status === 'canceled') {
      throw new BadRequestException('La suscripción ya está cancelada');
    }

    subscription.status = 'canceled';
    subscription.canceledAt = new Date();

    await this.subscriptionRepository.save(subscription);
    this.syncPremium([subscription]);
    return new SubscriptionDto(subscription);
  }
}
