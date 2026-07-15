import {
  Controller,
  Get,
  Param,
  Patch,
  Body,
  Post,
  UseInterceptors,
  Delete,
  ParseUUIDPipe,
  UploadedFiles,
  Req,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBadRequestResponse, ApiBody, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { SwaggerTags } from 'src/config';
import { Auth, OptionalAuth } from '../auth/decorators';
import { GetUser } from '../common/decorators';
import { User } from '../users/entities';

import { LodgingsService } from './lodgings.service';
import { LodgingFilters, LodgingListQueryParamsDocs } from './decorators';
import { RequestLocale } from '../translations/request-locale.decorator';
import {
  AdminLodgingsFiltersDto,
  AdminLodgingsListDto,
  BulkDeleteLodgingsDto,
  CreateLodgingDto,
  LodgingFiltersDto,
  LodgingFullDto,
  LodgingIndexDto,
  UpdateLodgingDto,
  UploadLodgingImagesDto,
} from './dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ContentTypes } from '../common/constants';
import { ReorderImagesDto } from '../common/dto/reoder-images.dto';
import { LodgingVectorDto } from './dto/lodging-vector.dto';
import { TENANT_ID_KEY } from '../tenant/tenant.interceptor';

@Controller('lodgings')
@ApiTags(SwaggerTags.Lodgings)
export class LodgingsController {
  constructor(private readonly lodgingsService: LodgingsService) {}

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ALL LODGINGS
  // * ----------------------------------------------------------------------------------------------------------------
  @Get()
  @LodgingListQueryParamsDocs()
  @OptionalAuth()
  @ApiOkResponse({ description: 'Lodging List', type: [LodgingIndexDto] })
  findAll(@LodgingFilters() filters: LodgingFiltersDto, @Req() request: Request) {
    const tenantId = (request as any)[TENANT_ID_KEY];
    if (tenantId && !filters.townId) {
      filters.townId = tenantId;
    }
    return this.lodgingsService.findAll({ filters });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ALL LODGINGS PAGINATED (ADMIN)
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('admin/list')
  @Auth()
  @ApiOkResponse({ description: 'Lodging List Paginated', type: AdminLodgingsListDto })
  findAllPaginated(@Query() filters: AdminLodgingsFiltersDto, @Req() request: Request) {
    const tenantId = (request as any)[TENANT_ID_KEY];
    if (tenantId && !filters.townId) {
      filters.townId = tenantId;
    }
    return this.lodgingsService.findAllPaginated(filters);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ALL PUBLIC LODGINGS
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('public')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Lodging List', type: [LodgingIndexDto] })
  findPublicLodgings(
    @LodgingFilters() filters: LodgingFiltersDto,
    @GetUser() user: User | undefined,
    @Req() request: Request,
    @RequestLocale() locale: string,
  ) {
    const tenantId = (request as any)[TENANT_ID_KEY];
    if (tenantId && !filters.townId) {
      filters.townId = tenantId;
    }
    return this.lodgingsService.findPublicLodgings({ filters, user, locale });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ALL PUBLIC LODGINGS WITH FULL INFO
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('public/full-info')
  @ApiOkResponse({ description: 'Lodging List', type: [LodgingVectorDto] })
  findPublicFullInfoLodgings(
    @LodgingFilters() filters: LodgingFiltersDto,
    @Req() request: Request,
    @RequestLocale() locale: string,
  ) {
    const tenantId = (request as any)[TENANT_ID_KEY];
    if (tenantId && !filters.townId) {
      filters.townId = tenantId;
    }
    return this.lodgingsService.findPublicFullInfoLodgings({ filters, locale });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET LODGING BY IDENTIFIER
  // * ----------------------------------------------------------------------------------------------------------------
  @Get(':identifier')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Lodging Detail', type: LodgingFullDto })
  findOne(@Param('identifier') identifier: string, @GetUser() user?: User) {
    return this.lodgingsService.findOne({ identifier, user });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET LODGING BY SLUG
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('slug/:slug')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Lodging Detail', type: LodgingFullDto })
  findOneBySlug(@Param('slug') slug: string, @GetUser() user?: User, @RequestLocale() locale: string = 'es') {
    return this.lodgingsService.findOneBySlug({ slug, user, locale });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * CREATE LODGING
  // * ----------------------------------------------------------------------------------------------------------------
  @Post()
  @Auth()
  @ApiOkResponse({ description: 'Lodging Created', type: LodgingFullDto })
  create(@Body() createLodgingDto: CreateLodgingDto, @GetUser() user: User) {
    return this.lodgingsService.create(createLodgingDto, user.id);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPDATE LODGING
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':identifier')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Lodging Updated', type: LodgingFullDto })
  update(@Param('identifier') identifier: string, @Body() updateLodgingDto: UpdateLodgingDto) {
    return this.lodgingsService.update(identifier, updateLodgingDto);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPDATE USER IN LODGING
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':identifier/users/:userId')
  @OptionalAuth()
  @ApiOkResponse({ description: 'User Updated in Lodging', type: LodgingFullDto })
  @ApiBadRequestResponse({ description: 'The user cannot be updated in the lodging' })
  updateUser(@Param('identifier') identifier: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.lodgingsService.updateUser(identifier, userId);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * DELETE LODGING
  // * ----------------------------------------------------------------------------------------------------------------
  @Delete(':identifier')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Lodging Deleted' })
  deleteLodging(@Param('identifier') identifier: string) {
    return this.lodgingsService.delete(identifier);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * BULK DELETE LODGINGS (admin)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post('admin/bulk-delete')
  @OptionalAuth()
  @ApiOkResponse({
    description: 'Count of lodgings deleted',
    schema: { example: { deleted: 4 } },
  })
  bulkDelete(@Body() dto: BulkDeleteLodgingsDto) {
    return this.lodgingsService.bulkDelete(dto.ids);
  }

  @Patch(':identifier/visibility')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Lodging Visibility Updated', type: LodgingFullDto })
  @ApiBadRequestResponse({ description: 'The visibility cannot be updated' })
  updateVisibility(@Param('identifier') identifier: string, @Body() body: { isPublic: boolean }) {
    return this.lodgingsService.updateVisibility(identifier, body.isPublic);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPDATE LODGING GOOGLE MAPS REVIEWS VISIBILITY
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':identifier/show-google-maps-reviews')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Lodging Google Maps Reviews Visibility Updated', type: LodgingFullDto })
  @ApiBadRequestResponse({ description: 'The visibility cannot be updated' })
  updateShowGoogleMapsReviews(
    @Param('identifier') identifier: string,
    @Body() body: { showGoogleMapsReviews: boolean },
  ) {
    return this.lodgingsService.updateShowGoogleMapsReviews(identifier, body.showGoogleMapsReviews);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * SUBMIT LODGING FOR REVIEW
  // * ----------------------------------------------------------------------------------------------------------------
  @Post(':identifier/submit-for-review')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Lodging submitted for review', type: LodgingFullDto })
  submitForReview(@Param('identifier') identifier: string, @GetUser() user: User) {
    return this.lodgingsService.submitForReview({ identifier, user });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPLOAD LODGING IMAGES
  // * ----------------------------------------------------------------------------------------------------------------
  @Post(':identifier/upload-images')
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
        mediaFormat: {
          type: 'string',
          enum: ['image', 'video'],
          default: 'image',
        },
        videoUrl: {
          type: 'string',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Images uploaded successfully',
    type: LodgingFullDto,
  })
  @ApiBadRequestResponse({ description: 'The images cannot be uploaded' })
  uploadImages(
    @UploadedFiles() files: Express.Multer.File[],
    @Param('identifier') identifier: string,
    @Body() uploadLodgingImagesDto: UploadLodgingImagesDto,
  ) {
    return this.lodgingsService.uploadImages(
      identifier,
      files,
      uploadLodgingImagesDto.mediaFormat,
      uploadLodgingImagesDto.videoUrl,
    );
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET LODGING IMAGES
  // * ----------------------------------------------------------------------------------------------------------------
  @Get(':identifier/images')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Lodging Images List' })
  getImages(@Param('identifier') identifier: string) {
    return this.lodgingsService.getImages(identifier);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * DELETE LODGING IMAGE
  // * ----------------------------------------------------------------------------------------------------------------
  @Delete(':identifier/images/:imageId')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Image Deleted' })
  @ApiBadRequestResponse({ description: 'The image cannot be deleted' })
  deleteImage(@Param('identifier') identifier: string, @Param('imageId', ParseUUIDPipe) imageId: string) {
    return this.lodgingsService.deleteImage(identifier, imageId);
  }

  @Patch(':identifier/images/reorder')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Images Reordered' })
  @ApiBadRequestResponse({ description: 'The images cannot be reordered' })
  reorderImages(@Param('identifier') identifier: string, @Body() reorderImagesDto: ReorderImagesDto) {
    return this.lodgingsService.reorderImages(identifier, reorderImagesDto);
  }
}
