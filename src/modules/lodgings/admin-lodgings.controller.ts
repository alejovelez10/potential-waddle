import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { SuperAdmin } from 'src/modules/auth/decorators';
import { SwaggerTags } from 'src/config';

import { LodgingsService } from './lodgings.service';
import { AdminLodgingsFiltersDto, AdminLodgingsListDto, LodgingFullDto } from './dto';
import { RejectLodgingDto } from './dto/reject-lodging.dto';
import { SearchSync } from 'src/modules/search/decorators/search-sync.decorator';

@Controller('admin/lodgings')
@ApiTags(SwaggerTags.Lodgings)
@SuperAdmin()
export class AdminLodgingsController {
  constructor(private readonly lodgingsService: LodgingsService) {}

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET PAGINATED LODGINGS — supports optional ?status=pending_review filter
  // * ----------------------------------------------------------------------------------------------------------------
  @Get()
  @ApiOkResponse({ description: 'Admin lodging list (paginated, filterable by status)', type: AdminLodgingsListDto })
  list(@Query() filters: AdminLodgingsFiltersDto): Promise<AdminLodgingsListDto> {
    return this.lodgingsService.findAllPaginated(filters);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * APPROVE LODGING
  // * ----------------------------------------------------------------------------------------------------------------
  @Post(':identifier/approve')
  @SearchSync('lodging', { param: 'identifier' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Lodging approved', type: LodgingFullDto })
  approve(@Param('identifier') identifier: string): Promise<LodgingFullDto> {
    return this.lodgingsService.approve({ identifier });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * REJECT LODGING
  // * ----------------------------------------------------------------------------------------------------------------
  @Post(':identifier/reject')
  @SearchSync('lodging', { param: 'identifier' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Lodging rejected', type: LodgingFullDto })
  reject(@Param('identifier') identifier: string, @Body() body: RejectLodgingDto): Promise<LodgingFullDto> {
    return this.lodgingsService.reject({ identifier, reason: body.reason });
  }
}
