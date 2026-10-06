import { Controller, Get, Post, Body, Patch, Param, Delete, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { TownDocumentRequirementService } from '../services';
import {
  CreateTownDocumentRequirementDto,
  UpdateTownDocumentRequirementDto,
  BulkTownDocumentRequirementDto,
  TownDocumentRequirementResponseDto,
} from '../dto';
import { Auth } from '../../auth/decorators';
import { GetUser } from '../../common/decorators';
import { EntityOwnershipResolver } from '../../common/services/entity-ownership.resolver';
import { User } from '../../users/entities';
import { DocumentEntityType } from '../enums';

@ApiTags('Town Document Requirements')
@Controller('town-document-requirements')
export class TownDocumentRequirementController {
  constructor(
    private readonly requirementService: TownDocumentRequirementService,
    private readonly ownership: EntityOwnershipResolver,
  ) {}

  @Post()
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new document requirement' })
  @ApiOkResponse({ type: TownDocumentRequirementResponseDto })
  create(@Body() createDto: CreateTownDocumentRequirementDto, @GetUser() user: User) {
    this.ownership.assertCanAdminTown(createDto.townId, user);
    return this.requirementService.create(createDto);
  }

  @Post('bulk')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk update requirements for a town and entity type' })
  @ApiOkResponse({ type: [TownDocumentRequirementResponseDto] })
  bulkUpdate(@Body() bulkDto: BulkTownDocumentRequirementDto, @GetUser() user: User) {
    this.ownership.assertCanAdminTown(bulkDto.townId, user);
    return this.requirementService.bulkUpdate(bulkDto);
  }

  @Get('town/:townId')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all requirements for a town' })
  @ApiOkResponse({ type: [TownDocumentRequirementResponseDto] })
  findByTown(@Param('townId', ParseUUIDPipe) townId: string) {
    return this.requirementService.findByTown(townId);
  }

  @Get('town/:townId/entity/:entityType')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get requirements for a town and entity type' })
  @ApiOkResponse({ type: [TownDocumentRequirementResponseDto] })
  @ApiQuery({ name: 'entityType', enum: DocumentEntityType })
  findByTownAndEntityType(
    @Param('townId', ParseUUIDPipe) townId: string,
    @Param('entityType') entityType: DocumentEntityType,
  ) {
    return this.requirementService.findByTownAndEntityType(townId, entityType);
  }

  @Get('town/:townId/entity/:entityType/with-all-types')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all document types with their requirement status' })
  getRequirementsWithAllTypes(
    @Param('townId', ParseUUIDPipe) townId: string,
    @Param('entityType') entityType: DocumentEntityType,
  ) {
    return this.requirementService.getRequirementsWithAllTypes(townId, entityType);
  }

  @Get(':id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a requirement by ID' })
  @ApiOkResponse({ type: TownDocumentRequirementResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.requirementService.findOne(id);
  }

  @Patch(':id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a requirement' })
  @ApiOkResponse({ type: TownDocumentRequirementResponseDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateTownDocumentRequirementDto,
    @GetUser() user: User,
  ) {
    const requirement = await this.requirementService.findOne(id);
    this.ownership.assertCanAdminTown(requirement.townId, user);
    return this.requirementService.update(id, updateDto);
  }

  @Delete(':id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a requirement' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User) {
    const requirement = await this.requirementService.findOne(id);
    this.ownership.assertCanAdminTown(requirement.townId, user);
    return this.requirementService.remove(id);
  }
}
