import { Controller, Get, Post, Patch, Param, Body, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOkResponse, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { Auth } from 'src/modules/auth/decorators';
import { GetUser } from 'src/modules/common/decorators';
import { User } from 'src/modules/users/entities';

import { SubscriptionsService } from '../services';
import { PaymentsService } from '../services';
import { SubscriptionDto, PaymentDto, CreateCheckoutDto, CheckoutResponseDto } from '../dto';
import { EntityType } from '../entities';
import { SearchSyncSkip } from 'src/modules/search/decorators/search-sync.decorator';

// Search sync: Premium changes are pushed from SubscriptionsService (it knows the entity).
@SearchSyncSkip()
@Controller('subscriptions')
@ApiTags('Subscriptions')
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  // * ----------------------------------------------------------------------------------------------------------------
  // * MIS SUSCRIPCIONES
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('my')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get my subscriptions' })
  @ApiOkResponse({ description: 'List of user subscriptions', type: [SubscriptionDto] })
  findMySubscriptions(@GetUser() user: User) {
    return this.subscriptionsService.findAllByUser(user.id);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * MIS PAGOS
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('payments')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get my payments' })
  @ApiOkResponse({ description: 'List of user payments', type: [PaymentDto] })
  findMyPayments(@GetUser() user: User) {
    return this.paymentsService.findByUser(user.id);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * VERIFICAR SI NEGOCIO TIENE SUSCRIPCIÓN ACTIVA
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('check/:entityType/:entityId')
  @ApiOperation({ summary: 'Check if business has active subscription' })
  @ApiOkResponse({ description: 'Subscription status', type: SubscriptionDto })
  async checkSubscription(
    @Param('entityType') entityType: EntityType,
    @Param('entityId', ParseUUIDPipe) entityId: string,
  ) {
    const [subscription, isPremium] = await Promise.all([
      this.subscriptionsService.findByEntity(entityType, entityId),
      // Single source of truth for Premium (handles experiences through their guide and
      // ignores newer pending/expired rows that findByEntity may return first).
      this.subscriptionsService.isPremium(entityType, entityId),
    ]);
    return {
      hasActiveSubscription: isPremium,
      isPremium,
      subscription,
    };
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * CREAR CHECKOUT (Iniciar proceso de pago)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post('checkout')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create checkout for subscription payment' })
  @ApiOkResponse({ description: 'Checkout data for Wompi widget', type: CheckoutResponseDto })
  createCheckout(@Body() dto: CreateCheckoutDto, @GetUser() user: User) {
    return this.subscriptionsService.createCheckout(user, dto);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * OBTENER DETALLE DE SUSCRIPCIÓN
  // * ----------------------------------------------------------------------------------------------------------------
  @Get(':id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get subscription by ID' })
  @ApiOkResponse({ description: 'Subscription details', type: SubscriptionDto })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptionsService.findOne(id);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * CANCELAR SUSCRIPCIÓN
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':id/cancel')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel subscription' })
  @ApiOkResponse({ description: 'Subscription canceled', type: SubscriptionDto })
  cancel(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User) {
    return this.subscriptionsService.cancel(id, user.id);
  }
}
