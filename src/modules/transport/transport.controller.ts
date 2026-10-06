import { Controller, Get, Post, Patch, Param, Delete, Body, ParseUUIDPipe, Req, Query } from '@nestjs/common';
import { TransportService } from './transport.service';
import { SwaggerTags } from 'src/config';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiBody,
  ApiBadRequestResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { TransportFiltersDto, AdminTransportFiltersDto, AdminTransportListDto, BulkDeleteTransportDto } from './dto';
import { TransportFilters } from './decorators';
import { TransportListQueryDocsGroup } from './decorators/transport-list-query-docs-group.decorator';
import { TransportDto } from './dto/transport.dto';
import { CreateTransportDto } from './dto/create-transport.dto';
import { UpdateTransportDto } from './dto/update-transport.dto';
import { Auth, OptionalAuth } from '../auth/decorators';
import { RestaurantDto } from '../restaurants/dto/restaurant.dto';
import { GetUser } from '../common/decorators';
import { EntityOwnershipResolver } from '../common/services/entity-ownership.resolver';
import { User } from '../users/entities';
import { TENANT_ID_KEY } from '../tenant/tenant.interceptor';
import { EntityAccess } from '../common/decorators/entity-access.decorator';

@Controller('transport')
@ApiTags(SwaggerTags.Transport)
export class TransportController {
  constructor(
    private readonly transportService: TransportService,
    private readonly ownership: EntityOwnershipResolver,
  ) {}

  // * ----------------------------------------------------------------------------------------------------------------
  // * CREATE TRANSPORT
  // * ----------------------------------------------------------------------------------------------------------------
  @Post()
  @Auth()
  @ApiOperation({ summary: 'Create a new transport' })
  @ApiOkResponse({ description: 'The transport has been successfully created.', type: TransportDto })
  @ApiConflictResponse({
    description: 'User already has a transport associated. Each user can only have one transport.',
  })
  create(@Body() createTransportDto: CreateTransportDto, @GetUser() user: User) {
    return this.transportService.create(createTransportDto, user.id);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ALL TRANSPORTS
  // * ----------------------------------------------------------------------------------------------------------------
  @Get()
  @TransportListQueryDocsGroup()
  findAll(@TransportFilters() filters: TransportFiltersDto, @Req() request: Request) {
    const tenantId = (request as any)[TENANT_ID_KEY];
    if (tenantId && !filters.townId) {
      filters.townId = tenantId;
    }
    return this.transportService.findAll({ filters });
  }

  @Get('public')
  @OptionalAuth()
  @TransportListQueryDocsGroup()
  findPublicTransports(
    @TransportFilters() filters: TransportFiltersDto,
    @GetUser() user: User | undefined,
    @Req() request: Request,
  ) {
    const tenantId = (request as any)[TENANT_ID_KEY];
    if (tenantId && !filters.townId) {
      filters.townId = tenantId;
    }
    return this.transportService.findPublicTransports({ filters, user });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ALL TRANSPORTS PAGINATED (ADMIN)
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('admin/list')
  @Auth()
  @ApiOkResponse({ description: 'Transport List Paginated', type: AdminTransportListDto })
  findAllPaginated(@Query() filters: AdminTransportFiltersDto, @Req() request: Request) {
    const tenantId = (request as any)[TENANT_ID_KEY];
    if (tenantId && !filters.townId) {
      filters.townId = tenantId;
    }
    return this.transportService.findAllPaginated(filters);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET TRANSPORT BY ID
  // * ----------------------------------------------------------------------------------------------------------------
  @Get(':id')
  @OptionalAuth()
  @ApiParam({ name: 'id', type: 'string', description: 'The UUID of the transport' })
  @ApiOkResponse({ description: 'The transport has been successfully retrieved.', type: TransportDto })
  findOne(@Param('id') id: string, @GetUser() user?: User) {
    return this.transportService.findOne(id, user);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPDATE TRANSPORT
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':id')
  @EntityAccess('manage', 'transport', { param: 'id' })
  @ApiParam({ name: 'id', type: 'string', description: 'The UUID of the transport' })
  @ApiOkResponse({ description: 'The transport has been successfully updated.', type: TransportDto })
  @ApiConflictResponse({
    description: 'User already has a transport associated. Each user can only have one transport.',
  })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() updateTransportDto: UpdateTransportDto) {
    return this.transportService.update(id, updateTransportDto);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * SUBMIT TRANSPORT FOR REVIEW (owner)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post(':id/submit-for-review')
  @Auth()
  @ApiOkResponse({ description: 'The transport has been submitted for review.', type: TransportDto })
  submitForReview(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User) {
    return this.transportService.submitForReview({ identifier: id, user });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * APPROVE TRANSPORT (admin)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post(':id/approve')
  @Auth()
  @ApiOkResponse({ description: 'The transport has been approved.', type: TransportDto })
  async approve(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User) {
    await this.ownership.assertCanModerate('transport', id, user);
    return this.transportService.approve({ identifier: id });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * REJECT TRANSPORT (admin)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post(':id/reject')
  @Auth()
  @ApiOkResponse({ description: 'The transport has been rejected.', type: TransportDto })
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() body: { reason: string }, @GetUser() user: User) {
    await this.ownership.assertCanModerate('transport', id, user);
    return this.transportService.reject({ identifier: id, reason: body.reason });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * DELETE TRANSPORT
  // * ----------------------------------------------------------------------------------------------------------------
  @Delete(':id')
  @EntityAccess('manage', 'transport', { param: 'id' })
  @ApiOperation({ summary: 'Delete a transport' })
  remove(@Param('id') id: string) {
    return this.transportService.remove(id);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * BULK DELETE TRANSPORTS (admin)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post('admin/bulk-delete')
  @EntityAccess('moderate', 'transport', { bodyIds: 'ids' })
  @ApiOperation({ summary: 'Bulk delete transports' })
  @ApiOkResponse({ description: 'Count of transports deleted', schema: { example: { deleted: 4 } } })
  bulkDelete(@Body() dto: BulkDeleteTransportDto) {
    return this.transportService.bulkDelete(dto.ids);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPDATE TRANSPORT AVAILABILITY
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':id/availability')
  @EntityAccess('manage', 'transport', { param: 'id' })
  @ApiOperation({ summary: 'Update transport availability status' })
  @ApiParam({ name: 'id', type: 'string', description: 'The UUID of the transport' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        isAvailable: { type: 'boolean' },
      },
    },
  })
  @ApiOkResponse({ description: 'The transport availability has been successfully updated.', type: TransportDto })
  updateAvailability(@Param('id', ParseUUIDPipe) id: string, @Body('isAvailable') isAvailable: boolean) {
    return this.transportService.updateAvailability(id, isAvailable);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPDATE USER IN RESTAURANT
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':identifier/users/:userId')
  @EntityAccess('moderate', 'transport')
  @ApiOkResponse({ description: 'User Updated in Transport', type: RestaurantDto })
  @ApiBadRequestResponse({ description: 'The user cannot be updated in the transport' })
  @ApiConflictResponse({
    description: 'User already has a transport associated. Each user can only have one transport.',
  })
  updateUser(@Param('identifier') identifier: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.transportService.updateUser(identifier, userId);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * ----------------------------------------------------------------------------------------------------------------
  // * UPDATE TRANSPORT VISIBILITY
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':identifier/visibility')
  @EntityAccess('manage', 'transport')
  @ApiOkResponse({ description: 'Transport Visibility Updated', type: TransportDto })
  @ApiBadRequestResponse({ description: 'The visibility cannot be updated' })
  updateVisibility(@Param('identifier') identifier: string, @Body() body: { isPublic: boolean }) {
    return this.transportService.updateVisibility(identifier, body.isPublic);
  }
}
