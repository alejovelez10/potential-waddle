import { Controller, Post, Get, Body, Query, Ip, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { WhatsappClicksService } from './whatsapp-clicks.service';
import { CreateWhatsappClickDto } from './dto';
import { TENANT_ID_KEY } from '../tenant/tenant.interceptor';
import { Request } from 'express';
import { SuperAdmin } from '../auth/decorators';

/**
 * DEPRECATED (MIG-03): superseded by /api/events. Reads are served from the events table
 * via WhatsappClicksReadAdapter (MIG-01). Endpoints + the whatsapp_click table are retained
 * for the user's prod cutover and are NOT removed in this phase.
 */
@ApiTags('WhatsApp Clicks')
@Controller('whatsapp-clicks')
export class WhatsappClicksController {
  constructor(private readonly whatsappClicksService: WhatsappClicksService) {}

  @Post()
  @ApiOperation({ summary: 'Track a WhatsApp click', deprecated: true })
  @ApiResponse({ status: 201, description: 'Click tracked successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async trackClick(@Body() createDto: CreateWhatsappClickDto, @Ip() ipAddress: string) {
    return this.whatsappClicksService.create(createDto, ipAddress);
  }

  @Get('analytics')
  @ApiOperation({ summary: 'Get WhatsApp click analytics', deprecated: true })
  @ApiQuery({ name: 'entityId', required: false, description: 'Filter by entity ID' })
  @ApiQuery({ name: 'entityType', required: false, description: 'Filter by entity type' })
  @ApiResponse({ status: 200, description: 'Analytics retrieved successfully' })
  async getAnalytics(@Query('entityId') entityId?: string, @Query('entityType') entityType?: string) {
    return this.whatsappClicksService.getAnalytics(entityId, entityType);
  }

  @Get('analytics/detailed')
  @ApiOperation({ summary: 'Get detailed WhatsApp click analytics for entity dashboard', deprecated: true })
  @ApiQuery({ name: 'entityId', required: true, description: 'Entity ID' })
  @ApiQuery({ name: 'entityType', required: true, description: 'Entity type' })
  @ApiResponse({ status: 200, description: 'Detailed analytics retrieved successfully' })
  async getDetailedAnalytics(@Query('entityId') entityId: string, @Query('entityType') entityType: string) {
    return this.whatsappClicksService.getDetailedAnalytics(entityId, entityType);
  }

  @Get('admin/aggregated')
  @SuperAdmin()
  @ApiOperation({ summary: 'Get aggregated WhatsApp analytics for all entities (Admin panel)', deprecated: true })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date filter (YYYY-MM-DD)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date filter (YYYY-MM-DD)' })
  @ApiQuery({ name: 'entityType', required: false, description: 'Filter by entity type' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number', type: Number })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page', type: Number })
  @ApiResponse({ status: 200, description: 'Aggregated analytics retrieved successfully' })
  async getAggregatedAnalytics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('entityType') entityType?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.whatsappClicksService.getAggregatedAnalytics({
      startDate,
      endDate,
      entityType,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get('admin/dashboard-stats')
  @SuperAdmin()
  @ApiOperation({ summary: 'Get WhatsApp clicks by day and entity type for dashboard', deprecated: true })
  @ApiQuery({ name: 'days', required: false, description: 'Number of days to fetch (default 7)' })
  @ApiResponse({ status: 200, description: 'Dashboard stats retrieved successfully' })
  async getDashboardStats(@Query('days') days?: string, @Req() request?: Request) {
    const townId = (request as any)?.[TENANT_ID_KEY];
    return this.whatsappClicksService.getDashboardStats(days ? parseInt(days, 10) : 7, townId);
  }
}
