import { ApiBadRequestResponse, ApiBody, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Delete,
  UseInterceptors,
  UploadedFiles,
  Body,
  Req,
  Query,
} from '@nestjs/common';
import { Request } from 'express';

import { SwaggerTags } from 'src/config';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ContentTypes } from '../common/constants';
import { ReorderImagesDto } from '../common/dto/reoder-images.dto';

import {
  RestaurantFiltersDto,
  CreateRestaurantDto,
  UpdateRestaurantDto,
  RestaurantDto,
  AdminRestaurantsFiltersDto,
  AdminRestaurantsListDto,
  BulkDeleteRestaurantsDto,
} from './dto';
import { Auth, OptionalAuth } from '../auth/decorators';
import { RestaurantsService } from './restaurants.service';
import { RestaurantFilters, RestaurantListApiQueries } from './decorators';
import { RestaurantVectorDto } from './dto/restaurant-vector.dto';
import { GetUser } from '../common/decorators';
import { User } from '../users/entities';
import { TENANT_ID_KEY } from '../tenant/tenant.interceptor';
import { RequestLocale } from '../translations/request-locale.decorator';

@Controller(SwaggerTags.Restaurants)
@ApiTags(SwaggerTags.Restaurants)
export class RestaurantsController {
  constructor(private readonly restaurantsService: RestaurantsService) {}

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ALL RESTAURANTS
  // * ----------------------------------------------------------------------------------------------------------------
  @Get()
  @OptionalAuth()
  @RestaurantListApiQueries()
  @ApiOkResponse({ description: 'Restaurant List', type: [RestaurantDto] })
  findAll(@RestaurantFilters() filters: RestaurantFiltersDto, @Req() request: Request) {
    const tenantId = (request as any)[TENANT_ID_KEY];
    if (tenantId && !filters.townId) {
      filters.townId = tenantId;
    }
    return this.restaurantsService.findAll({ filters });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ALL RESTAURANTS PAGINATED (ADMIN)
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('admin/list')
  @Auth()
  @ApiOkResponse({ description: 'Restaurant List Paginated', type: AdminRestaurantsListDto })
  findAllPaginated(@Query() filters: AdminRestaurantsFiltersDto, @Req() request: Request) {
    const tenantId = (request as any)[TENANT_ID_KEY];
    if (tenantId && !filters.townId) {
      filters.townId = tenantId;
    }
    return this.restaurantsService.findAllPaginated(filters);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ALL PUBLIC RESTAURANTS
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('public')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Restaurant List', type: [RestaurantDto] })
  findPublicRestaurants(
    @RestaurantFilters() filters: RestaurantFiltersDto,
    @GetUser() user: User | undefined,
    @Req() request: Request,
    @RequestLocale() locale: string,
  ) {
    const tenantId = (request as any)[TENANT_ID_KEY];
    if (tenantId && !filters.townId) {
      filters.townId = tenantId;
    }
    return this.restaurantsService.findPublicRestaurants({ filters, user, locale });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ALL PUBLIC RESTAURANTS WITH FULL INFO
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('public/full-info')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Restaurant List', type: [RestaurantVectorDto] })
  findPublicFullInfoRestaurants(@RestaurantFilters() filters: RestaurantFiltersDto, @Req() request: Request) {
    const tenantId = (request as any)[TENANT_ID_KEY];
    if (tenantId && !filters.townId) {
      filters.townId = tenantId;
    }
    return this.restaurantsService.findPublicFullInfoRestaurants({ filters });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET RESTAURANT BY IDENTIFIER
  // * ----------------------------------------------------------------------------------------------------------------
  @Get(':identifier')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Restaurant Detail', type: RestaurantDto })
  findOne(@Param('identifier') identifier: string, @GetUser() user?: User) {
    return this.restaurantsService.findOne(identifier, user);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * SUBMIT RESTAURANT FOR REVIEW (owner)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post(':identifier/submit-for-review')
  @Auth()
  @ApiOkResponse({ description: 'Restaurant submitted for review', type: RestaurantDto })
  submitForReview(@Param('identifier') identifier: string, @GetUser() user: User) {
    return this.restaurantsService.submitForReview({ identifier, user });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * APPROVE RESTAURANT (admin)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post('admin/:identifier/approve')
  @Auth()
  @ApiOkResponse({ description: 'Restaurant approved', type: RestaurantDto })
  approve(@Param('identifier') identifier: string) {
    return this.restaurantsService.approve({ identifier });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * REJECT RESTAURANT (admin)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post('admin/:identifier/reject')
  @Auth()
  @ApiOkResponse({ description: 'Restaurant rejected', type: RestaurantDto })
  reject(@Param('identifier') identifier: string, @Body() body: { reason: string }) {
    return this.restaurantsService.reject({ identifier, reason: body.reason });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET RESTAURANT BY SLUG
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('slug/:slug')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Restaurant Detail', type: RestaurantDto })
  findOneBySlug(@Param('slug') slug: string, @GetUser() user?: User, @RequestLocale() locale: string = 'es') {
    return this.restaurantsService.findOneBySlug({ slug, user, locale });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * CREATE RESTAURANT
  // * ----------------------------------------------------------------------------------------------------------------
  @Post()
  @Auth()
  @ApiOkResponse({ description: 'Restaurant Created', type: RestaurantDto })
  create(@Body() createRestaurantDto: CreateRestaurantDto, @GetUser() user: User) {
    return this.restaurantsService.create(createRestaurantDto, user.id);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPDATE RESTAURANT
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':identifier')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Restaurant Updated', type: RestaurantDto })
  update(@Param('identifier') identifier: string, @Body() updateRestaurantDto: UpdateRestaurantDto) {
    return this.restaurantsService.update(identifier, updateRestaurantDto);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * DELETE RESTAURANT
  // * ----------------------------------------------------------------------------------------------------------------
  @Delete(':identifier')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Restaurant Deleted' })
  deleteRestaurant(@Param('identifier') identifier: string) {
    return this.restaurantsService.delete(identifier);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * BULK DELETE RESTAURANTS (admin)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post('admin/bulk-delete')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Count of restaurants deleted', schema: { example: { deleted: 4 } } })
  bulkDelete(@Body() dto: BulkDeleteRestaurantsDto) {
    return this.restaurantsService.bulkDelete(dto.ids);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPDATE USER IN RESTAURANT
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':identifier/users/:userId')
  @OptionalAuth()
  @ApiOkResponse({ description: 'User Updated in Restaurant', type: RestaurantDto })
  @ApiBadRequestResponse({ description: 'The user cannot be updated in the restaurant' })
  updateUser(@Param('identifier') identifier: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.restaurantsService.updateUser(identifier, userId);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPDATE RESTAURANT GOOGLE MAPS REVIEWS VISIBILITY
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':identifier/show-google-maps-reviews')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Restaurant Google Maps Reviews Visibility Updated', type: RestaurantDto })
  @ApiBadRequestResponse({ description: 'The visibility cannot be updated' })
  updateShowGoogleMapsReviews(
    @Param('identifier') identifier: string,
    @Body() body: { showGoogleMapsReviews: boolean },
  ) {
    return this.restaurantsService.updateShowGoogleMapsReviews(identifier, body.showGoogleMapsReviews);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPDATE RESTAURANT VISIBILITY
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':identifier/visibility')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Restaurant Visibility Updated', type: RestaurantDto })
  @ApiBadRequestResponse({ description: 'The visibility cannot be updated' })
  updateVisibility(@Param('identifier') identifier: string, @Body() body: { isPublic: boolean }) {
    return this.restaurantsService.updateVisibility(identifier, body.isPublic);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPLOAD RESTAURANT IMAGES
  // * ----------------------------------------------------------------------------------------------------------------
  @Post(':identifier/upload-images')
  @OptionalAuth()
  @UseInterceptors(FilesInterceptor('files', 10))
  @ApiConsumes(ContentTypes.MULTIPART_FORM_DATA)
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Images uploaded successfully',
    type: RestaurantDto,
  })
  @ApiBadRequestResponse({ description: 'The images cannot be uploaded' })
  uploadImages(@UploadedFiles() files: Express.Multer.File[], @Param('identifier') identifier: string) {
    return this.restaurantsService.uploadImages(identifier, files);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET RESTAURANT IMAGES
  // * ----------------------------------------------------------------------------------------------------------------
  @Get(':identifier/images')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Restaurant Images List' })
  getImages(@Param('identifier') identifier: string) {
    return this.restaurantsService.getImages(identifier);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * DELETE RESTAURANT IMAGE
  // * ----------------------------------------------------------------------------------------------------------------
  @Delete(':identifier/images/:imageId')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Image Deleted' })
  @ApiBadRequestResponse({ description: 'The image cannot be deleted' })
  deleteImage(@Param('identifier') identifier: string, @Param('imageId', ParseUUIDPipe) imageId: string) {
    return this.restaurantsService.deleteImage(identifier, imageId);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * REORDER RESTAURANT IMAGES
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':identifier/images/reorder')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Images Reordered' })
  @ApiBadRequestResponse({ description: 'The images cannot be reordered' })
  reorderImages(@Param('identifier') identifier: string, @Body() reorderImagesDto: ReorderImagesDto) {
    return this.restaurantsService.reorderImages(identifier, reorderImagesDto);
  }
}
