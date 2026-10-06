import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GooglePlacesService } from './google-places.service';
import { SwaggerTags } from 'src/config';
import { RemoveGooglePlaceIdDto } from './dto/remove-google-place-id.dto';
import { GoogleReviewsListQueryDocsGroup } from './decorators/google-reviews-list-query-docs-group.decorator';
import { GoogleReviewsFilters } from './decorators/google-reviews-filters.decorator';
import { GoogleReviewsFiltersDto } from './dto/google-reviews-filters.dto';
import { GoogleReviewSummaryRequestDto } from './dto/google-review-summary-request.dto';
import { Auth } from 'src/modules/auth/decorators/auth.decorator';
import { GetUser } from 'src/modules/common/decorators/get-user.decorator';
import { User } from 'src/modules/users/entities';
import { GoogleSyncManualService } from './services/google-sync-manual.service';
import { EntityAccess } from '../common/decorators/entity-access.decorator';

@Controller('google-places')
@ApiTags(SwaggerTags.GooglePlaces)
export class GooglePlacesController {
  constructor(
    private readonly googlePlacesService: GooglePlacesService,
    private readonly googleSyncManualService: GoogleSyncManualService,
  ) {}

  // * ----------------------------------------------------------------------------------------------------------------
  // * MANUAL SYNC — owner-triggered (202 async fire-and-forget)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post('sync/:type/:id')
  @EntityAccess('manage', 'param:type', { param: 'id' })
  @HttpCode(HttpStatus.ACCEPTED)
  triggerSync(@Param('type') type: string, @Param('id') id: string, @GetUser() currentUser: User) {
    return this.googleSyncManualService.triggerSync(id, type as any, currentUser);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * SYNC HISTORY — paginated, owner-scoped
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('sync-history/:type/:id')
  @Auth()
  getSyncHistory(
    @Param('type') type: string,
    @Param('id') id: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @GetUser() currentUser: User,
  ) {
    return this.googleSyncManualService.getSyncHistory(id, type as any, currentUser, +page, +limit);
  }

  @Patch('remove-google-place-id')
  @EntityAccess('manage', 'body:model', { bodyId: 'placeId' })
  @ApiOkResponse({
    description: 'Google Place ID removed correctly',
  })
  removeGooglePlaceId(@Body() body: RemoveGooglePlaceIdDto) {
    return this.googlePlacesService.removeGooglePlaceId(body.placeId, body.model);
  }

  @Get('get-all-reviews/:entityId/:entityType')
  @EntityAccess('manage', 'param:entityType', { param: 'entityId' })
  @ApiOkResponse({
    description: 'All reviews retrieved successfully',
  })
  getAllReviews(@Param('entityId') entityId: string, @Param('entityType') entityType: string) {
    return this.googlePlacesService.fetchReviewsFromApify(entityId, entityType);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ALL GOOGLE REVIEWS
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('reviews/:entityId/:entityType')
  @GoogleReviewsListQueryDocsGroup()
  findAll(
    @Param('entityId') entityId: string,
    @Param('entityType') entityType: string,
    @GoogleReviewsFilters() filters: GoogleReviewsFiltersDto,
  ) {
    return this.googlePlacesService.getAllReviews({ filters, entityId, entityType });
  }

  @Delete('delete-all-reviews/:entityId/:entityType')
  @EntityAccess('manage', 'param:entityType', { param: 'entityId' })
  @ApiOkResponse({
    description: 'All reviews deleted successfully',
  })
  deleteAllReviews(@Param('entityId') entityId: string, @Param('entityType') entityType: string) {
    return this.googlePlacesService.deleteAllReviewsforEntity(entityId, entityType);
  }

  @Post('review-summary')
  @EntityAccess('manage', 'body:entityType', { bodyId: 'entityId' })
  @ApiOkResponse({
    description: 'Review summary retrieved successfully',
  })
  reviewSummary(@Body() body: GoogleReviewSummaryRequestDto) {
    return this.googlePlacesService.reviewSummary(
      body.message,
      body.entityId,
      body.entityType as 'lodging' | 'restaurant' | 'commerce',
    );
  }

  @Get('last-review-summary/:entityId/:entityType')
  @ApiOkResponse({
    description: 'Last review summary retrieved successfully',
  })
  getReviewsSummary(@Param('entityId') entityId: string, @Param('entityType') entityType: string) {
    return this.googlePlacesService.getReviewsSummary(entityId, entityType as 'lodging' | 'restaurant' | 'commerce');
  }

  @Get('reviews-for-chart/:entityId/:entityType')
  @ApiOkResponse({
    description: 'Reviews for chart retrieved successfully.',
  })
  getReviewsforChart(@Param('entityId') entityId: string, @Param('entityType') entityType: string) {
    return this.googlePlacesService.getReviewsCountByRating(
      entityId,
      entityType as 'lodging' | 'restaurant' | 'commerce',
    );
  }

  @Get('reviews-for-chart-by-year/:entityId/:entityType')
  @ApiOkResponse({
    description: 'Reviews for chart by year retrieved successfully.',
  })
  getReviewsforChartByYear(@Param('entityId') entityId: string, @Param('entityType') entityType: string) {
    return this.googlePlacesService.getReviewsCountByYear(
      entityId,
      entityType as 'lodging' | 'restaurant' | 'commerce',
    );
  }

  @Get('reviews-by-month/:entityId/:entityType')
  @ApiOkResponse({
    description: 'Reviews count by month for current year.',
  })
  getReviewsByMonth(@Param('entityId') entityId: string, @Param('entityType') entityType: string) {
    return this.googlePlacesService.getReviewsCountByMonth(
      entityId,
      entityType as 'lodging' | 'restaurant' | 'commerce',
    );
  }

  @Get('reviews-rating-trend/:entityId/:entityType')
  @ApiOkResponse({
    description: 'Rating trend over time (average rating per month).',
  })
  getReviewsRatingTrend(@Param('entityId') entityId: string, @Param('entityType') entityType: string) {
    return this.googlePlacesService.getReviewsRatingTrend(
      entityId,
      entityType as 'lodging' | 'restaurant' | 'commerce',
    );
  }

  @Get('reviews-metrics/:entityId/:entityType')
  @ApiOkResponse({
    description: 'Aggregate metrics for reviews (average, total, distribution, etc.).',
  })
  getReviewsMetrics(@Param('entityId') entityId: string, @Param('entityType') entityType: string) {
    return this.googlePlacesService.getReviewsMetrics(entityId, entityType as 'lodging' | 'restaurant' | 'commerce');
  }

  @Get('analytics/:type/:id')
  @ApiOkResponse({ description: 'Star distribution + monthly rating trend for the reviews charts' })
  getAnalytics(@Param('type') type: string, @Param('id') id: string) {
    return this.googlePlacesService.getAnalytics(id, type as 'lodging' | 'restaurant' | 'commerce');
  }
}
