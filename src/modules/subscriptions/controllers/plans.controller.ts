import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOkResponse, ApiOperation } from '@nestjs/swagger';

import { PlansService } from '../services';
import { PlanDto } from '../dto';
import { SearchSyncSkip } from 'src/modules/search/decorators/search-sync.decorator';

// Search sync: Premium changes are pushed from SubscriptionsService (it knows the entity).
@SearchSyncSkip()
@Controller('plans')
@ApiTags('Subscriptions')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  @ApiOperation({ summary: 'Get all active plans' })
  @ApiOkResponse({ description: 'List of active plans', type: [PlanDto] })
  findAll() {
    return this.plansService.findAll();
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get plan by slug' })
  @ApiOkResponse({ description: 'Plan details', type: PlanDto })
  findBySlug(@Param('slug') slug: string) {
    return this.plansService.findBySlug(slug);
  }
}
