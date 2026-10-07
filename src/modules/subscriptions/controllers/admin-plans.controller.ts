import { Controller, Get, Post, Put, Delete, Body, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOkResponse, ApiCreatedResponse, ApiOperation, ApiNoContentResponse } from '@nestjs/swagger';

import { SuperAdmin } from '../../auth/decorators';
import { PlansService } from '../services';
import { PlanDto, CreatePlanDto, UpdatePlanDto } from '../dto';
import { CreatePlanFeatureDto, UpdatePlanFeatureDto } from '../dto/create-plan-feature.dto';
import { PlanFeature } from '../entities';
import { SearchSyncSkip } from 'src/modules/search/decorators/search-sync.decorator';

// Search sync: Premium changes are pushed from SubscriptionsService (it knows the entity).
@SearchSyncSkip()
@Controller('admin/plans')
@ApiTags('Admin - Plans')
@SuperAdmin()
export class AdminPlansController {
  constructor(private readonly plansService: PlansService) {}

  // * ----------------------------------------------------------------------------------------------------------------
  // * PLANS CRUD
  // * ----------------------------------------------------------------------------------------------------------------

  @Get()
  @ApiOperation({ summary: 'Get all plans (including inactive)' })
  @ApiOkResponse({ description: 'List of all plans', type: [PlanDto] })
  findAll() {
    return this.plansService.findAllAdmin();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get plan by ID' })
  @ApiOkResponse({ description: 'Plan details', type: PlanDto })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.plansService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new plan' })
  @ApiCreatedResponse({ description: 'Plan created', type: PlanDto })
  create(@Body() dto: CreatePlanDto) {
    return this.plansService.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a plan' })
  @ApiOkResponse({ description: 'Plan updated', type: PlanDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlanDto) {
    return this.plansService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a plan' })
  @ApiNoContentResponse({ description: 'Plan deleted' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.plansService.remove(id);
  }

  @Put(':id/toggle-active')
  @ApiOperation({ summary: 'Toggle plan active status' })
  @ApiOkResponse({ description: 'Plan status toggled', type: PlanDto })
  toggleActive(@Param('id', ParseUUIDPipe) id: string) {
    return this.plansService.toggleActive(id);
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Duplicate a plan with all its features' })
  @ApiCreatedResponse({ description: 'Plan duplicated', type: PlanDto })
  duplicate(@Param('id', ParseUUIDPipe) id: string) {
    return this.plansService.duplicate(id);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * FEATURES CRUD
  // * ----------------------------------------------------------------------------------------------------------------

  @Post('features')
  @ApiOperation({ summary: 'Create a new feature for a plan' })
  @ApiCreatedResponse({ description: 'Feature created', type: PlanFeature })
  createFeature(@Body() dto: CreatePlanFeatureDto) {
    return this.plansService.createFeature(dto);
  }

  @Put('features/:id')
  @ApiOperation({ summary: 'Update a feature' })
  @ApiOkResponse({ description: 'Feature updated', type: PlanFeature })
  updateFeature(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlanFeatureDto) {
    return this.plansService.updateFeature(id, dto);
  }

  @Delete('features/:id')
  @ApiOperation({ summary: 'Delete a feature' })
  @ApiNoContentResponse({ description: 'Feature deleted' })
  async removeFeature(@Param('id', ParseUUIDPipe) id: string) {
    await this.plansService.removeFeature(id);
  }
}
