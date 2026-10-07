import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Delete, Param, ParseUUIDPipe } from '@nestjs/common';
import { SwaggerTags } from 'src/config';
import { Controller } from '@nestjs/common';
import { ReviewsService } from './services';
import { Auth } from 'src/modules/auth/decorators';
import { SearchSyncSkip } from 'src/modules/search/decorators/search-sync.decorator';
@Controller('public/reviews')
@ApiTags(SwaggerTags.PublicReviews)
export class PublicReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}
  // * ----------------------------------------------------------------------------------------------------------------
  // * DELETE REVIEW IMAGE
  // * ----------------------------------------------------------------------------------------------------------------
  @Delete('/images/:imageId')
  @SearchSyncSkip()
  @ApiOperation({ summary: 'Delete a review image' })
  @Auth()
  delete(@Param('imageId', new ParseUUIDPipe()) imageId: string) {
    return this.reviewsService.deleteImage({ imageId });
  }
}
