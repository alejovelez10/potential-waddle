import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Delete,
  Body,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFiles,
  Req,
  Query,
} from '@nestjs/common';
import { SwaggerTags } from 'src/config';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiBody,
  ApiBadRequestResponse,
  ApiConsumes,
} from '@nestjs/swagger';
import { Request } from 'express';
import { CreateGuideDto } from './dto/create-guide.dto';
import { UpdateGuideDto } from './dto/update-guide.dto';
import { GuidesService } from './guides.service';
import { GuideDto } from './dto/guide.dto';
import { BulkDeleteGuidesDto } from './dto/bulk-delete-guides.dto';
import { GuidesFilters } from './decorators/guides-filters.decorator';
import { GuidesFiltersDto } from './dto/guides-filters.dto';
import { AdminGuidesFiltersDto } from './dto/admin-guides-filters.dto';
import { AdminGuidesListDto } from './dto/admin-guides-list.dto';
import { GuideListQueryDocsGroup } from './decorators/guides-list-query-docs-group.decorator';
import { Auth, OptionalAuth } from '../auth/decorators';
import { ContentTypes } from '../common/constants/content-types';
import { ReorderImagesDto } from '../common/dto/reoder-images.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { GetUser } from '../common/decorators';
import { User } from '../users/entities';
import { TENANT_ID_KEY } from '../tenant/tenant.interceptor';
import { RequestLocale } from '../translations/request-locale.decorator';

@Controller('guides')
@ApiTags(SwaggerTags.Guides)
export class GuidesController {
  constructor(private readonly guidesService: GuidesService) {}

  // * ----------------------------------------------------------------------------------------------------------------
  // * CREATE GUIDE
  // * ----------------------------------------------------------------------------------------------------------------
  @Post()
  @Auth()
  @ApiOperation({ summary: 'Create a new guide' })
  @ApiOkResponse({ description: 'The guide has been successfully created.', type: GuideDto })
  create(@Body() createGuideDto: CreateGuideDto, @GetUser() user: User) {
    return this.guidesService.create(createGuideDto, user.id);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ALL GUIDES
  // * ----------------------------------------------------------------------------------------------------------------
  @Get()
  @GuideListQueryDocsGroup()
  findAll(@GuidesFilters() filters: GuidesFiltersDto, @Req() request: Request) {
    const tenantId = (request as any)[TENANT_ID_KEY];
    if (tenantId && !filters.townId) {
      filters.townId = tenantId;
    }
    return this.guidesService.findAll({ filters });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ALL GUIDES PAGINATED (ADMIN)
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('admin/list')
  @Auth()
  @ApiOkResponse({ description: 'Guide List Paginated', type: AdminGuidesListDto })
  findAllPaginated(@Query() filters: AdminGuidesFiltersDto, @Req() request: Request) {
    const tenantId = (request as any)[TENANT_ID_KEY];
    if (tenantId && !filters.townId) {
      filters.townId = tenantId;
    }
    return this.guidesService.findAllPaginated(filters);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ALL PUBLIC GUIDES
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('public')
  @OptionalAuth()
  @GuideListQueryDocsGroup()
  findPublicGuides(
    @GuidesFilters() filters: GuidesFiltersDto,
    @GetUser() user: User | undefined,
    @Req() request: Request,
    @RequestLocale() locale: string,
  ) {
    const tenantId = (request as any)[TENANT_ID_KEY];
    if (tenantId && !filters.townId) {
      filters.townId = tenantId;
    }
    return this.guidesService.findPublicGuides({ filters, user, locale });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ALL PUBLIC GUIDES WITH FULL INFO
  @Get('public/full-info')
  @GuideListQueryDocsGroup()
  findPublicFullInfoGuides(@GuidesFilters() filters: GuidesFiltersDto, @Req() request: Request) {
    const tenantId = (request as any)[TENANT_ID_KEY];
    if (tenantId && !filters.townId) {
      filters.townId = tenantId;
    }
    return this.guidesService.findPublicFullInfoGuides(filters);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET GUIDE BY IDENTIFIER
  // * ----------------------------------------------------------------------------------------------------------------
  @Get(':identifier')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Guide Detail', type: GuideDto })
  findOne(@Param('identifier') identifier: string, @GetUser() user?: User) {
    return this.guidesService.findOne({ identifier, user });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET GUIDE BY IDENTIFIER
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('public/:id')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Guide Detail', type: GuideDto })
  findOneById(@Param('id') id: string, @GetUser() user?: User, @RequestLocale() locale: string = 'es') {
    return this.guidesService.findOneById(id, user, locale);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * SUBMIT GUIDE FOR REVIEW (owner)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post(':identifier/submit-for-review')
  @Auth()
  @ApiOkResponse({ description: 'Guide submitted for review', type: GuideDto })
  submitForReview(@Param('identifier') identifier: string, @GetUser() user: User) {
    return this.guidesService.submitForReview({ identifier, user });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * APPROVE GUIDE (admin)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post('admin/:identifier/approve')
  @Auth()
  @ApiOkResponse({ description: 'Guide approved', type: GuideDto })
  approve(@Param('identifier') identifier: string) {
    return this.guidesService.approve({ identifier });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * REJECT GUIDE (admin)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post('admin/:identifier/reject')
  @Auth()
  @ApiOkResponse({ description: 'Guide rejected', type: GuideDto })
  reject(@Param('identifier') identifier: string, @Body() body: { reason: string }) {
    return this.guidesService.reject({ identifier, reason: body.reason });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPDATE GUIDE
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':slug')
  @ApiParam({ name: 'slug', type: 'string', description: 'The slug of the guide' })
  @ApiOkResponse({ description: 'The guide has been successfully updated.', type: GuideDto })
  update(@Param('slug') slug: string, @Body() updateGuideDto: UpdateGuideDto) {
    return this.guidesService.update(slug, updateGuideDto);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * DELETE GUIDE
  // * ----------------------------------------------------------------------------------------------------------------
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a guide' })
  remove(@Param('id') id: string) {
    return this.guidesService.remove(id);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * BULK DELETE GUIDES (admin)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post('admin/bulk-delete')
  @ApiOperation({ summary: 'Bulk delete guides' })
  @ApiOkResponse({ description: 'Count of guides deleted', schema: { example: { deleted: 4 } } })
  bulkDelete(@Body() dto: BulkDeleteGuidesDto) {
    return this.guidesService.bulkDelete(dto.ids);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPDATE GUIDE AVAILABILITY
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':id/availability')
  @ApiOperation({ summary: 'Update guide availability status' })
  @ApiParam({ name: 'id', type: 'string', description: 'The UUID of the guide' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        isAvailable: { type: 'boolean' },
      },
    },
  })
  @ApiOkResponse({ description: 'The guide availability has been successfully updated.', type: GuideDto })
  updateAvailability(@Param('id', ParseUUIDPipe) id: string, @Body('isAvailable') isAvailable: boolean) {
    return this.guidesService.updateAvailability(id, isAvailable);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPLOAD LODGING IMAGE
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
      },
    },
  })
  @ApiOkResponse({
    description: 'Images uploaded successfully',
    type: GuideDto,
  })
  @ApiBadRequestResponse({ description: 'The images cannot be uploaded' })
  uploadImages(@UploadedFiles() files: Express.Multer.File[], @Param('identifier') identifier: string) {
    return this.guidesService.uploadImages(identifier, files);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET LODGING IMAGES
  // * ----------------------------------------------------------------------------------------------------------------
  @Get(':identifier/images')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Lodging Images List' })
  getImages(@Param('identifier') identifier: string) {
    return this.guidesService.getImages(identifier);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * DELETE LODGING IMAGE
  // * ----------------------------------------------------------------------------------------------------------------
  @Delete(':identifier/images/:imageId')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Image Deleted' })
  @ApiBadRequestResponse({ description: 'The image cannot be deleted' })
  deleteImage(@Param('identifier') identifier: string, @Param('imageId', ParseUUIDPipe) imageId: string) {
    return this.guidesService.deleteImage(identifier, imageId);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * REORDER GUIDE IMAGES
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':identifier/images/reorder')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Images Reordered' })
  @ApiBadRequestResponse({ description: 'The images cannot be reordered' })
  reorderImages(@Param('identifier') identifier: string, @Body() reorderImagesDto: ReorderImagesDto) {
    return this.guidesService.reorderImages(identifier, reorderImagesDto);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPDATE USER IN GUIDE
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':identifier/users/:userId')
  @OptionalAuth()
  @ApiOkResponse({ description: 'User Updated in Guide', type: GuideDto })
  @ApiBadRequestResponse({ description: 'The user cannot be updated in the guide' })
  updateUser(@Param('identifier') identifier: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.guidesService.updateUser(identifier, userId);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * ----------------------------------------------------------------------------------------------------------------
  // * UPDATE GUIDE VISIBILITY
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':identifier/visibility')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Guide Visibility Updated', type: GuideDto })
  @ApiBadRequestResponse({ description: 'The visibility cannot be updated' })
  updateVisibility(@Param('identifier') identifier: string, @Body() body: { isPublic: boolean }) {
    return this.guidesService.updateVisibility(identifier, body.isPublic);
  }
}
