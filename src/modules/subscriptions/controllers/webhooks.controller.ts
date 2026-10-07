import { Controller, Post, Body, Headers, HttpCode, Logger, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';

import { WompiService } from '../services/wompi.service';
import { PaymentsService } from '../services/payments.service';
import { SubscriptionsService } from '../services/subscriptions.service';
import { WompiWebhookEvent } from '../interfaces';
import { SearchSyncSkip } from 'src/modules/search/decorators/search-sync.decorator';

// Search sync: Premium changes are pushed from SubscriptionsService (it knows the entity).
@SearchSyncSkip()
@Controller('webhooks')
@ApiTags('Webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly wompiService: WompiService,
    private readonly paymentsService: PaymentsService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @Post('wompi')
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive Wompi webhook events' })
  @ApiOkResponse({ description: 'Webhook processed successfully' })
  async handleWompiWebhook(
    @Body() event: WompiWebhookEvent,
    @Headers('x-event-checksum') checksum: string,
  ): Promise<{ received: boolean }> {
    this.logger.log(`Received Wompi webhook: ${event.event}`);

    // 1. Validar firma del webhook
    if (!this.wompiService.validateWebhookSignature(event, checksum)) {
      this.logger.warn('Invalid webhook signature');
      throw new BadRequestException('Invalid webhook signature');
    }

    // 2. Procesar según el tipo de evento
    if (event.event === 'transaction.updated' && event.data.transaction) {
      await this.handleTransactionUpdated(event);
    }

    return { received: true };
  }

  private async handleTransactionUpdated(event: WompiWebhookEvent): Promise<void> {
    const transaction = event.data.transaction!;
    const reference = transaction.reference;

    this.logger.log(`Transaction updated: ${transaction.id} - Status: ${transaction.status} - Reference: ${reference}`);

    // 1. Buscar el pago por referencia
    const payment = await this.paymentsService.findByReference(reference);
    if (!payment) {
      this.logger.warn(`Payment not found for reference: ${reference}`);
      return;
    }

    // 2. Si ya está procesado, ignorar
    if (payment.status !== 'pending') {
      this.logger.log(`Payment ${payment.id} already processed with status: ${payment.status}`);
      return;
    }

    // 3. Mapear estado de Wompi a estado interno
    const newStatus = this.wompiService.mapTransactionStatus(transaction.status);

    // 4. Actualizar el pago
    await this.paymentsService.updateStatus(payment.id, newStatus, {
      wompiTransactionId: transaction.id,
      paymentMethod: transaction.payment_method_type,
      wompiResponse: transaction as unknown as Record<string, any>,
      paidAt: newStatus === 'approved' ? new Date() : undefined,
      failureReason: transaction.status_message || undefined,
    });

    // 5. Actualizar suscripciones según el resultado
    if (newStatus === 'approved') {
      this.logger.log(`Payment ${payment.id} approved - Activating subscriptions`);
      await this.subscriptionsService.activateSubscriptionsByPayment(payment.id);
    } else if (newStatus === 'declined' || newStatus === 'error') {
      this.logger.log(`Payment ${payment.id} failed - Marking subscriptions as past_due`);
      await this.subscriptionsService.failSubscriptionsByPayment(payment.id);
    }
  }
}
