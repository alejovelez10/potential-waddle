import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { SwaggerTags } from 'src/config';
import { SuperAdmin } from '../auth/decorators';
import { RafaAdminService } from './rafa-admin.service';
import {
  AssignToolsDto,
  CreateSkillDto,
  UpdateKnowledgeSourceDto,
  UpdateSkillDto,
} from './dto';

/**
 * Management API for Rafa (ADMIN-01 / SKILL-03). EVERY route is guarded by
 * SuperAdmin (JwtAuthGuard + SuperAdminGuard, D-04) — only super-admins manage Rafa. All
 * writes go through class-validator DTOs; nest is the sole writer of the shared
 * DDL. rafa reads these rows fresh per turn (no redeploy).
 */
@Controller('rafa-admin')
@ApiTags(SwaggerTags.RafaAdmin)
export class RafaAdminController {
  constructor(private readonly rafaAdminService: RafaAdminService) {}

  // ---------------------------------------------------------------------------
  // Skills CRUD
  // ---------------------------------------------------------------------------

  @Get('skills')
  @SuperAdmin()
  @ApiOkResponse({ description: 'List of skills (ordered by name).' })
  listSkills() {
    return this.rafaAdminService.listSkills();
  }

  @Get('skills/:id')
  @SuperAdmin()
  @ApiOkResponse({ description: 'A single skill by id.' })
  getSkill(@Param('id', ParseUUIDPipe) id: string) {
    return this.rafaAdminService.getSkill(id);
  }

  @Post('skills')
  @SuperAdmin()
  @ApiOkResponse({ description: 'Skill created.' })
  createSkill(@Body() dto: CreateSkillDto) {
    return this.rafaAdminService.createSkill(dto);
  }

  @Patch('skills/:id')
  @SuperAdmin()
  @ApiOkResponse({ description: 'Skill updated.' })
  updateSkill(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSkillDto) {
    return this.rafaAdminService.updateSkill(id, dto);
  }

  @Delete('skills/:id')
  @SuperAdmin()
  @ApiOkResponse({ description: 'Skill deleted (grants cascade).' })
  deleteSkill(@Param('id', ParseUUIDPipe) id: string) {
    return this.rafaAdminService.deleteSkill(id);
  }

  // ---------------------------------------------------------------------------
  // Tool assignment
  // ---------------------------------------------------------------------------

  @Get('skills/:id/tools')
  @SuperAdmin()
  @ApiOkResponse({ description: 'Tool ids currently granted to the skill.' })
  getSkillToolIds(@Param('id', ParseUUIDPipe) id: string) {
    return this.rafaAdminService.getSkillToolIds(id);
  }

  @Put('skills/:id/tools')
  @SuperAdmin()
  @ApiOkResponse({ description: 'Reconcile the skill grants to exactly these tool ids.' })
  assignTools(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignToolsDto) {
    return this.rafaAdminService.assignTools(id, dto);
  }

  // ---------------------------------------------------------------------------
  // Tool catalog
  // ---------------------------------------------------------------------------

  @Get('tools')
  @SuperAdmin()
  @ApiOkResponse({ description: 'Global tool catalog (ordered by name).' })
  listTools() {
    return this.rafaAdminService.listTools();
  }

  // ---------------------------------------------------------------------------
  // Knowledge sources
  // ---------------------------------------------------------------------------

  @Get('knowledge-sources')
  @SuperAdmin()
  @ApiOkResponse({ description: 'List of knowledge sources with last_sync_* state.' })
  listKnowledgeSources() {
    return this.rafaAdminService.listKnowledgeSources();
  }

  @Patch('knowledge-sources/:id')
  @SuperAdmin()
  @ApiOkResponse({ description: 'Toggle a knowledge source (isActive / enableSemanticSearch).' })
  updateKnowledgeSource(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateKnowledgeSourceDto,
  ) {
    return this.rafaAdminService.updateKnowledgeSource(id, dto);
  }
}
