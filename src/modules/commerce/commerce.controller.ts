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
  CommerceFiltersDto,
  CreateCommerceDto,
  UpdateCommerceDto,
  CommerceFullDto,
  CommerceIndexDto,
  AdminCommerceFiltersDto,
  AdminCommerceListDto,
  BulkDeleteCommerceDto,
} from './dto';
import { Auth, OptionalAuth } from '../auth/decorators';
import { CommerceService } from './commerce.service';
import { CommerceFilters, CommerceListQueryParamsDocs } from './decorators';
import { GetUser } from '../common/decorators';
import { User } from '../users/entities';
import { TENANT_ID_KEY } from '../tenant/tenant.interceptor';
import { RequestLocale } from '../translations/request-locale.decorator';

@Controller(SwaggerTags.Commerce)
@ApiTags(SwaggerTags.Commerce)
export class CommerceController {
  constructor(private readonly commerceService: CommerceService) {}

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ALL COMMERCE
  // * ----------------------------------------------------------------------------------------------------------------
  @Get()
  @OptionalAuth()
  @CommerceListQueryParamsDocs()
  @ApiOkResponse({ description: 'Commerce List', type: [CommerceIndexDto] })
  findAll(@CommerceFilters() filters: CommerceFiltersDto, @Req() request: Request) {
    const tenantId = (request as any)[TENANT_ID_KEY];
    if (tenantId && !filters.townId) {
      filters.townId = tenantId;
    }
    return this.commerceService.findAll({ filters });
  }

  // ------------------------------------------------------------------------------------------------
  // Find all public commerce
  // ------------------------------------------------------------------------------------------------
  @Get('public')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Commerce List', type: [CommerceIndexDto] })
  findPublicCommerce(
    @CommerceFilters() filters: CommerceFiltersDto,
    @GetUser() user: User | undefined,
    @Req() request: Request,
    @RequestLocale() locale: string,
  ) {
    const tenantId = (request as any)[TENANT_ID_KEY];
    if (tenantId && !filters.townId) {
      filters.townId = tenantId;
    }
    return this.commerceService.findPublicCommerce({ filters, user, locale });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ALL COMMERCE PAGINATED (ADMIN)
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('admin/list')
  @Auth()
  @ApiOkResponse({ description: 'Commerce List Paginated', type: AdminCommerceListDto })
  findAllPaginated(@Query() filters: AdminCommerceFiltersDto, @Req() request: Request) {
    const tenantId = (request as any)[TENANT_ID_KEY];
    if (tenantId && !filters.townId) {
      filters.townId = tenantId;
    }
    return this.commerceService.findAllPaginated(filters);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET COMMERCE BY IDENTIFIER
  // * ----------------------------------------------------------------------------------------------------------------
  @Get(':identifier')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Commerce Detail', type: CommerceFullDto })
  findOne(@Param('identifier') identifier: string, @GetUser() user?: User) {
    // Pass the requester id so the service enriches owner-scoped fields (status,
    // 3-indicator completion, skipped fields) only when the caller owns the commerce.
    return this.commerceService.findOne(identifier, user);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * SUBMIT COMMERCE FOR REVIEW (owner action)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post(':identifier/submit-for-review')
  @Auth()
  @ApiOkResponse({ description: 'Commerce submitted for review', type: CommerceFullDto })
  submitForReview(@Param('identifier') identifier: string, @GetUser() user: User) {
    return this.commerceService.submitForReview({ identifier, user });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * APPROVE COMMERCE (admin action)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post('admin/:identifier/approve')
  @Auth()
  @ApiOkResponse({ description: 'Commerce approved', type: CommerceFullDto })
  approve(@Param('identifier') identifier: string) {
    return this.commerceService.approve({ identifier });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * REJECT COMMERCE (admin action)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post('admin/:identifier/reject')
  @Auth()
  @ApiOkResponse({ description: 'Commerce rejected', type: CommerceFullDto })
  reject(@Param('identifier') identifier: string, @Body() body: { reason: string }) {
    return this.commerceService.reject({ identifier, reason: body.reason });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET COMMERCE BY SLUG
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('slug/:slug')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Commerce Detail', type: CommerceFullDto })
  findOneBySlug(@Param('slug') slug: string, @GetUser() user?: User, @RequestLocale() locale: string = 'es') {
    return this.commerceService.findOneBySlug({ slug, user, locale });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * CREATE COMMERCE
  // * ----------------------------------------------------------------------------------------------------------------
  @Post()
  @Auth()
  @ApiOkResponse({ description: 'Commerce Created', type: CommerceFullDto })
  create(@Body() createCommerceDto: CreateCommerceDto, @GetUser() user: User) {
    return this.commerceService.create(createCommerceDto, user.id);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPDATE COMMERCE
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':identifier')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Commerce Updated', type: CommerceFullDto })
  update(@Param('identifier') identifier: string, @Body() updateCommerceDto: UpdateCommerceDto) {
    return this.commerceService.update(identifier, updateCommerceDto);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * DELETE COMMERCE
  // * ----------------------------------------------------------------------------------------------------------------
  @Delete(':identifier')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Commerce Deleted' })
  deleteCommerce(@Param('identifier') identifier: string) {
    return this.commerceService.delete(identifier);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * BULK DELETE COMMERCES (admin)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post('admin/bulk-delete')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Count of commerces deleted', schema: { example: { deleted: 4 } } })
  bulkDelete(@Body() dto: BulkDeleteCommerceDto) {
    return this.commerceService.bulkDelete(dto.ids);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPDATE USER IN COMMERCE
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':identifier/users/:userId')
  @OptionalAuth()
  @ApiOkResponse({ description: 'User Updated in Commerce', type: CommerceFullDto })
  @ApiBadRequestResponse({ description: 'The user cannot be updated in the commerce' })
  updateUser(@Param('identifier') identifier: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.commerceService.updateUser(identifier, userId);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPDATE COMMERCE VISIBILITY
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':identifier/visibility')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Commerce Visibility Updated', type: CommerceFullDto })
  @ApiBadRequestResponse({ description: 'The visibility cannot be updated' })
  updateVisibility(@Param('identifier') identifier: string, @Body() body: { isPublic: boolean }) {
    return this.commerceService.updateVisibility(identifier, body.isPublic);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPDATE COMMERCE GOOGLE MAPS REVIEWS VISIBILITY
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':identifier/show-google-maps-reviews')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Commerce Google Maps Reviews Visibility Updated', type: CommerceFullDto })
  @ApiBadRequestResponse({ description: 'The visibility cannot be updated' })
  updateShowGoogleMapsReviews(
    @Param('identifier') identifier: string,
    @Body() body: { showGoogleMapsReviews: boolean },
  ) {
    return this.commerceService.updateShowGoogleMapsReviews(identifier, body.showGoogleMapsReviews);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPLOAD COMMERCE IMAGES
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
    type: CommerceFullDto,
  })
  @ApiBadRequestResponse({ description: 'The images cannot be uploaded' })
  uploadImages(@UploadedFiles() files: Express.Multer.File[], @Param('identifier') identifier: string) {
    return this.commerceService.uploadImages(identifier, files);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET COMMERCE IMAGES
  // * ----------------------------------------------------------------------------------------------------------------
  @Get(':identifier/images')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Commerce Images List' })
  getImages(@Param('identifier') identifier: string) {
    return this.commerceService.getImages(identifier);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * DELETE COMMERCE IMAGE
  // * ----------------------------------------------------------------------------------------------------------------
  @Delete(':identifier/images/:imageId')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Image Deleted' })
  @ApiBadRequestResponse({ description: 'The image cannot be deleted' })
  deleteImage(@Param('identifier') identifier: string, @Param('imageId', ParseUUIDPipe) imageId: string) {
    return this.commerceService.deleteImage(identifier, imageId);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * REORDER COMMERCE IMAGES
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':identifier/images/reorder')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Images Reordered' })
  @ApiBadRequestResponse({ description: 'The images cannot be reordered' })
  reorderImages(@Param('identifier') identifier: string, @Body() reorderImagesDto: ReorderImagesDto) {
    return this.commerceService.reorderImages(identifier, reorderImagesDto);
  }
}
