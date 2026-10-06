import { Controller, Get, Patch, Delete, Param, Query, ParseUUIDPipe, Body } from '@nestjs/common';
import { ApiTags, ApiOkResponse, ApiOperation, ApiQuery } from '@nestjs/swagger';

import { SuperAdmin } from '../../auth/decorators';
import { PaymentsService, SubscriptionsService } from '../services';
import { PaymentDto, AdminUpdatePaymentDto } from '../dto';
import { PaymentStatus } from '../entities';

@Controller('payments/admin')
@ApiTags('Admin - Payments')
@SuperAdmin()
export class AdminPaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @Get('list')
  @ApiOperation({ summary: 'Get all payments (admin)' })
  @ApiOkResponse({ description: 'Paginated list of payments' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search by reference' })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'approved', 'declined', 'voided', 'error'] })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['createdAt', 'updatedAt', 'amountInCents'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['ASC', 'DESC'] })
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: PaymentStatus,
    @Query('sortBy') sortBy?: 'createdAt' | 'updatedAt' | 'amountInCents',
    @Query('sortOrder') sortOrder?: 'ASC' | 'DESC',
  ) {
    return this.paymentsService.findAllAdmin({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      status,
      sortBy,
      sortOrder,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payment by ID (admin)' })
  @ApiOkResponse({ description: 'Payment details', type: PaymentDto })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update payment status (admin)' })
  @ApiOkResponse({ description: 'Payment updated', type: PaymentDto })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminUpdatePaymentDto) {
    const payment = await this.paymentsService.adminUpdateStatus(id, dto.status, {
      paymentMethod: dto.paymentMethod,
      failureReason: dto.failureReason,
    });

    // Mirror the Wompi webhook so a manually reconciled payment has the same effect.
    if (dto.status === 'approved') await this.subscriptionsService.activateSubscriptionsByPayment(id);
    if (dto.status === 'declined' || dto.status === 'error')
      await this.subscriptionsService.failSubscriptionsByPayment(id);

    return payment;
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete payment (admin, for testing purposes)' })
  @ApiOkResponse({ description: 'Payment deleted' })
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.deletePayment(id);
  }
}
