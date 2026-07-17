import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { SuperAdmin } from '../auth/decorators';
import {
  ADMIN_TRANSLATABLE_ENTITY_TYPES,
  AdminTranslatableEntityType,
} from './seeding/admin-translatable-entities.constant';
import { TranslationSeedingService } from './seeding/translation-seeding.service';

/**
 * AdminTranslationsController — superadmin-only HTTP surface for translating
 * category/facility (quick 260717-abz). Distinct from TranslationsController
 * (owner-facing, @Auth() + IDOR ownership) because category/facility have no
 * `user` column — the owner-scoped model does not apply to them.
 *
 * ALL routes are @SuperAdmin() (JwtAuthGuard + SuperAdminGuard). entityType is
 * validated against ADMIN_TRANSLATABLE_ENTITY_TYPES on every route so this
 * surface can never become a bypass of the owner-scoped model for
 * lodging/restaurant/experience/guide/commerce (DD-3).
 *
 * Route order: the static `entities/:entityType/:entityId/*` routes are
 * declared BEFORE the `:entityType/*` routes so Nest never has to disambiguate
 * the literal `entities` segment against the `:entityType` wildcard.
 */
@Controller('translations/admin')
@ApiTags('Translations')
export class AdminTranslationsController {
  constructor(private readonly seedingService: TranslationSeedingService) {}

  private assertAdminEntityType(entityType: string): asserts entityType is AdminTranslatableEntityType {
    if (!ADMIN_TRANSLATABLE_ENTITY_TYPES.includes(entityType as AdminTranslatableEntityType)) {
      throw new BadRequestException(`Unsupported admin entityType: ${entityType}`);
    }
  }

  // ---------------------------------------------------------------------------
  // POST /translations/admin/entities/:entityType/:entityId/seed
  // Per-row ✨ button. body.force=true bypasses the revisado guard (DD-5).
  // ---------------------------------------------------------------------------
  @Post('entities/:entityType/:entityId/seed')
  @SuperAdmin()
  seed(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Body('force') force: boolean | undefined,
  ) {
    this.assertAdminEntityType(entityType);
    return this.seedingService.seedAdminEntity(entityType, entityId, { force });
  }

  // ---------------------------------------------------------------------------
  // PATCH /translations/admin/entities/:entityType/:entityId/override
  // Manual EN edit from the inline cell. Writes source='revisado'.
  // ---------------------------------------------------------------------------
  @Patch('entities/:entityType/:entityId/override')
  @SuperAdmin()
  override(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Body('fields') fields: Record<string, string>,
  ) {
    this.assertAdminEntityType(entityType);
    return this.seedingService.overrideAdmin(entityType, entityId, fields ?? {});
  }

  // ---------------------------------------------------------------------------
  // GET /translations/admin/:entityType/state?ids=a,b,c
  // Batch translation state for the admin list's current page. Cap 200 ids
  // (T-abz-05 — bounded cost).
  // ---------------------------------------------------------------------------
  @Get(':entityType/state')
  @SuperAdmin()
  state(@Param('entityType') entityType: string, @Query('ids') ids: string | undefined) {
    this.assertAdminEntityType(entityType);
    const idList = (ids ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 200);
    return this.seedingService.batchStateForIds(entityType, idList);
  }

  // ---------------------------------------------------------------------------
  // GET /translations/admin/:entityType/pending-count
  // ---------------------------------------------------------------------------
  @Get(':entityType/pending-count')
  @SuperAdmin()
  async pendingCount(@Param('entityType') entityType: string) {
    this.assertAdminEntityType(entityType);
    const count = await this.seedingService.countMissingForType(entityType);
    return { count };
  }

  // ---------------------------------------------------------------------------
  // POST /translations/admin/:entityType/seed-missing
  // "Traducir faltantes (N)" bulk button. Bounded batch (default 50). NOT force —
  // only touches rows without an EN row / with a stale one (never revisado).
  // ---------------------------------------------------------------------------
  @Post(':entityType/seed-missing')
  @SuperAdmin()
  seedMissing(@Param('entityType') entityType: string, @Body('batchSize') batchSize: number | undefined) {
    this.assertAdminEntityType(entityType);
    return this.seedingService.seedMissingForType(entityType, batchSize ?? 50);
  }
}
