import { Controller, Get, Post, Patch, Delete, Param, Query, ParseUUIDPipe, Body } from '@nestjs/common';
import { ApiTags, ApiOkResponse, ApiOperation, ApiQuery } from '@nestjs/swagger';

import { SuperAdmin } from '../../auth/decorators';
import { SubscriptionsService } from '../services';
import {
  SubscriptionDto,
  AdminCreateSubscriptionDto,
  BulkDeleteSubscriptionsDto,
  AdminUpdateAssistanceDto,
} from '../dto';
import { AssistanceStatus, EntityType } from '../entities';
import { GetUser } from '../../common/decorators';
import { User } from '../../users/entities';
import { UsersService } from '../../users/services/users.service';
import { SearchSyncSkip } from 'src/modules/search/decorators/search-sync.decorator';

// Search sync: Premium changes are pushed from SubscriptionsService (it knows the entity).
@SearchSyncSkip()
@Controller('subscriptions/admin')
@ApiTags('Admin - Subscriptions')
@SuperAdmin()
export class AdminSubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly usersService: UsersService,
  ) {}

  @Get('list')
  @ApiOperation({ summary: 'Get all subscriptions (admin)' })
  @ApiOkResponse({ description: 'Paginated list of subscriptions' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'entityType', required: false, enum: ['lodging', 'restaurant', 'commerce', 'transport', 'guide'] })
  @ApiQuery({ name: 'assistanceStatus', required: false, enum: ['none', 'pending', 'contacted', 'completed'] })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['createdAt', 'updatedAt', 'currentPeriodEnd'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['ASC', 'DESC'] })
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('entityType') entityType?: EntityType,
    @Query('assistanceStatus') assistanceStatus?: AssistanceStatus,
    @Query('sortBy') sortBy?: 'createdAt' | 'updatedAt' | 'currentPeriodEnd',
    @Query('sortOrder') sortOrder?: 'ASC' | 'DESC',
  ) {
    return this.subscriptionsService.findAllAdmin({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      status,
      entityType,
      assistanceStatus,
      sortBy,
      sortOrder,
    });
  }

  @Patch(':id/assistance')
  @ApiOperation({ summary: 'Update the Premium accompaniment follow-up (pending → contacted → completed)' })
  @ApiOkResponse({ type: SubscriptionDto })
  updateAssistance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateAssistanceDto,
    @GetUser() user: User,
  ) {
    return this.subscriptionsService.updateAssistance(id, dto, user);
  }

  @Get('user-businesses/:userId')
  @ApiOperation({ summary: 'Get all businesses for a user (for subscription creation)' })
  @ApiOkResponse({ description: 'List of user businesses' })
  getUserBusinesses(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.usersService.getUserBusinesses(userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create subscription manually (admin)' })
  @ApiOkResponse({ description: 'Subscription created', type: SubscriptionDto })
  create(@Body() dto: AdminCreateSubscriptionDto) {
    return this.subscriptionsService.createManualSubscription(dto);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel subscription (admin)' })
  @ApiOkResponse({ description: 'Subscription canceled', type: SubscriptionDto })
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptionsService.adminCancel(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete subscription (admin, for testing purposes)' })
  @ApiOkResponse({ description: 'Subscription deleted' })
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptionsService.deleteSubscription(id);
  }

  @Post('bulk-delete')
  @ApiOperation({ summary: 'Bulk delete subscriptions by id (admin)' })
  @ApiOkResponse({ description: 'Count of subscriptions deleted', schema: { example: { deleted: 4 } } })
  bulkDelete(@Body() dto: BulkDeleteSubscriptionsDto) {
    return this.subscriptionsService.bulkDeleteSubscriptions(dto.ids);
  }
}
