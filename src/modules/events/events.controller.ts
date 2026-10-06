import { Body, Controller, Get, HttpCode, HttpStatus, Ip, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Auth, OptionalAuth } from '../auth/decorators';
import { GetUser } from '../common/decorators';
import { TenantId } from '../tenant/tenant.decorator';
import { User } from '../users/entities';
import { CreateEventDto, EntityAnalyticsQueryDto, PlatformAnalyticsQueryDto } from './dto';
import { EventsService } from './events.service';
import { EntityOwnershipResolver } from '../common/services/entity-ownership.resolver';
import { EntityAnalyticsService, EntityAnalyticsResponse } from './entity-analytics.service';
import { PlatformAnalyticsService, PlatformAnalyticsResponse } from './platform-analytics.service';
import { resolvePlatformScope } from './platform-analytics.scope';
import { SubscriptionsService } from '../subscriptions/services';

@ApiTags('Events')
@Controller('events') // real path is /api/events due to the global 'api' prefix (Pitfall 6)
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly ownership: EntityOwnershipResolver,
    private readonly entityAnalytics: EntityAnalyticsService,
    private readonly platformAnalytics: PlatformAnalyticsService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  @Post()
  @OptionalAuth() // attaches req.user if Bearer present, else anonymous — never 401 (T-15-04)
  @HttpCode(HttpStatus.ACCEPTED) // 202 — fire-and-forget, not awaiting the write (EVENT-01)
  @ApiOperation({ summary: 'Ingest a generic analytics event (fire-and-forget)' })
  @ApiResponse({ status: 202, description: 'Event accepted' })
  async ingest(
    @Body() dto: CreateEventDto,
    @Ip() ip: string,
    @TenantId() townId: string | null, // server-derived via global TenantInterceptor (D-04)
    @Req() req: Request,
  ): Promise<void> {
    const userAgent = (req.headers['user-agent'] as string) ?? null;
    const user = (req as any).user ?? null; // set by @OptionalAuth
    // Do NOT await — 202 returns immediately; ingest never throws to the client.
    void this.events.ingest({ dto, ip, townId, userAgent, user });
  }

  // BIZ-08: per-entity analytics read. @Auth() => 401 without a valid Bearer (never public).
  // The IDOR gate (assertCanRead) runs BEFORE any data query: non-owner/non-town-admin/non-super
  // gets 403; a missing entity gets 404 (T-17-01/02/06).
  @Get('analytics/entity') // real path /api/events/analytics/entity (global 'api' prefix)
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Per-entity analytics for the business dashboard (auth + ownership-scoped)' })
  @ApiResponse({ status: 200, description: 'Analytics for the owned entity' })
  @ApiForbiddenResponse({ description: 'Caller is not owner / town-admin / super-admin of this entity' })
  async getEntityAnalytics(
    @Query() query: EntityAnalyticsQueryDto,
    @GetUser() user: User,
  ): Promise<EntityAnalyticsResponse> {
    const { townId } = await this.ownership.assertCanRead(query.entityType, query.entityId, user);

    // Freemium: business-owner analytics are a Premium benefit. Super-admins and town-admins of the
    // entity's town always see them (they manage the territory, not the subscription).
    const isAdmin = !!user?.isSuperUser || (user?.towns ?? []).some(t => t.id === townId);
    if (!isAdmin && query.entityType !== 'place') {
      await this.subscriptions.assertPremium(query.entityType, query.entityId, 'analytics');
    }

    return this.entityAnalytics.getEntityAnalytics({ ...query, townId });
  }

  // PLAT-01..04: platform analytics read. @Auth() => 401 without a valid Bearer (never public).
  // The IDOR gate (resolvePlatformScope) runs BEFORE any data query: a town-admin is FORCED to
  // their own towns and can never read another town; a non-super user with no towns gets 403
  // (T-18-01/02). super-admin sees all towns or filters by `town`.
  @Get('analytics/platform') // real path /api/events/analytics/platform (global 'api' prefix)
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Platform analytics for the /admin/analytics dashboard (auth + admin-scoped)' })
  @ApiResponse({ status: 200, description: 'Platform aggregates scoped to the caller' })
  @ApiForbiddenResponse({ description: 'Non-super caller with no towns has no platform access' })
  async getPlatformAnalytics(
    @Query() query: PlatformAnalyticsQueryDto,
    @GetUser() user: User,
  ): Promise<PlatformAnalyticsResponse> {
    // Gate runs BEFORE the query (mirrors assertCanRead ordering). A town-admin's `query.town` is
    // ignored here — scope is forced to their own towns. Throws ForbiddenException for no-town non-super.
    const { townIds, resolveSlug } = resolvePlatformScope(user, query.town);
    return this.platformAnalytics.getPlatformAnalytics({ from: query.from, to: query.to, townIds, resolveSlug });
  }
}
