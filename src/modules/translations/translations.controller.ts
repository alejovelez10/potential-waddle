import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Auth } from '../auth/decorators';
import { GetUser } from '../common/decorators';
import { User } from '../users/entities';
import { TranslationSeedingService } from './seeding/translation-seeding.service';

/**
 * TranslationsController — owner-facing HTTP surface for translation management.
 *
 * All routes require a valid JWT (@Auth). IDOR ownership enforcement is delegated
 * to TranslationSeedingService (which checks entity.user.id or experience.guide.user.id
 * and throws ForbiddenException for non-owners — Pitfall 7).
 *
 * Phase 28.1 frontend will consume these endpoints to render translation badges
 * and allow owners to override EN translations from their dashboard.
 */
@Controller('translations')
@ApiTags('Translations')
export class TranslationsController {
  constructor(private readonly seedingService: TranslationSeedingService) {}

  // ---------------------------------------------------------------------------
  // GET /translations/entities/:entityType/:entityId
  // Returns current EN translation state (field, value, source, updatedAt) for the
  // owner panel to render auto/revisado badges.
  // Read is @Auth-gated but not owner-scoped (low sensitivity — public-facing content).
  // ---------------------------------------------------------------------------
  @Get('entities/:entityType/:entityId')
  @Auth()
  getState(@Param('entityType') entityType: string, @Param('entityId') entityId: string) {
    return this.seedingService.getTranslationState(entityType, entityId);
  }

  // ---------------------------------------------------------------------------
  // PATCH /translations/entities/:entityType/:entityId/override
  // Bulk owner override: writes source='revisado' so auto re-seed never overwrites.
  // Body: { fields: Record<string, string> }
  // IDOR-guarded in TranslationSeedingService.overrideTranslation (MT-02, T-28-02).
  // ---------------------------------------------------------------------------
  @Patch('entities/:entityType/:entityId/override')
  @Auth()
  override(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Body('fields') fields: Record<string, string>,
    @GetUser() user: User,
  ) {
    return this.seedingService.overrideTranslation(entityType, entityId, fields ?? {}, user.id);
  }

  // ---------------------------------------------------------------------------
  // POST /translations/entities/:entityType/:entityId/seed
  // On-demand seed of auto/empty fields for an owned entity (synchronous, one Gemini call).
  // No body required — the server loads ES source values from the base entity table.
  // IDOR-guarded in TranslationSeedingService.seedOnDemand (T-28-04).
  // ---------------------------------------------------------------------------
  @Post('entities/:entityType/:entityId/seed')
  @Auth()
  seed(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @GetUser() user: User,
  ) {
    return this.seedingService.seedOnDemand(entityType, entityId, user.id);
  }
}
