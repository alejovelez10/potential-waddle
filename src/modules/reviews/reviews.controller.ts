import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { AppPermissions, SwaggerTags } from 'src/config';
import { ReviewSortByEnum } from './enums';
import { ReviewsService } from './services';
import { AdminReviewsDto, ReviewStatusWasChangeDto, ReviewChangeStatusDto, ReviewFindAllQueriesDto } from './dto';
import { ReviewFindAllApiQueries } from './decorators';
import { GenericFindAllFilters, GetUser } from '../common/decorators';
import { Auth } from '../auth/decorators';
import { User } from '../users/entities';
import { SearchSyncSkip } from 'src/modules/search/decorators/search-sync.decorator';
// import { Auth } from '../auth/decorators';

@Controller('admin/reviews')
@ApiTags(SwaggerTags.Reviews)
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all reviews' })
  // @Auth(AppPermissions.READ_REVIEWS)
  @ReviewFindAllApiQueries()
  @ApiOkResponse({ description: 'Get all reviews', type: AdminReviewsDto })
  findAll(@GenericFindAllFilters(ReviewFindAllQueriesDto, ReviewSortByEnum) queries: ReviewFindAllQueriesDto) {
    return this.reviewsService.findAll({ queries });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * APPROVE REVIEW
  // * ----------------------------------------------------------------------------------------------------------------
  @Post(':id/change-status')
  @SearchSyncSkip() // changing a review status does not recompute the entity rating
  @Auth(AppPermissions.UPDATE_REVIEW_STATUS)
  @ApiOperation({ summary: 'This endpoint changes the review status and adds a new entry to the history report.' })
  @ApiParam({ name: 'id', type: 'string', description: 'Review UUID' })
  @ApiBody({ type: ReviewChangeStatusDto })
  @ApiConsumes('application/json', 'application/x-www-form-urlencoded')
  @ApiOkResponse({ description: 'The review status was changed.', type: ReviewStatusWasChangeDto })
  @ApiNotFoundResponse({ description: 'If the review not found' })
  @ApiBadRequestResponse({
    description: 'If the review does not have a user or the review status is not valid.',
  })
  @ApiUnprocessableEntityResponse({ description: 'This endpoint is only available for place reviews.' })
  approve(@Param('id', new ParseUUIDPipe()) id: string, @GetUser() user: User, @Body() body: ReviewChangeStatusDto) {
    return this.reviewsService.chnageStatus({ id, user, body });
  }
}
