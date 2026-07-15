import { ApiBadRequestResponse, ApiBody, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseInterceptors,
  UploadedFiles,
  Body,
  Req,
} from '@nestjs/common';
import { Request } from 'express';

import { SwaggerTags } from 'src/config';
import { Auth, OptionalAuth } from '../auth/decorators';
import { GetUser } from '../common/decorators';
import { User } from '../users/entities';

import { ExperiencesService } from './experiences.service';
import {
  AdminExperiencesFiltersDto,
  AdminExperiencesListDto,
  BulkDeleteExperiencesDto,
  CreateExperienceDto,
  ExperienceDto,
  ExperienceFiltersDto,
  UpdateExperienceDto,
} from './dto';
import { ExperienceFilters, ExperienceListApiQueries } from './decorators';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ContentTypes } from '../common/constants';
import { ReorderImagesDto } from '../common/dto/reoder-images.dto';
import { ExperienceVectorDto } from './dto/experience-vector.dto';
import { TENANT_ID_KEY } from '../tenant/tenant.interceptor';
import { RequestLocale } from '../translations/request-locale.decorator';

@Controller(SwaggerTags.Experiences)
@ApiTags(SwaggerTags.Experiences)
export class ExperiencesController {
  constructor(private readonly experiencesService: ExperiencesService) {}

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ALL EXPERIENCES
  // * ----------------------------------------------------------------------------------------------------------------
  @Get()
  @OptionalAuth()
  @ExperienceListApiQueries()
  @ApiOkResponse({ description: 'Experience List', type: [CreateExperienceDto] })
  findAll(@ExperienceFilters() filters: ExperienceFiltersDto, @Req() request: Request) {
    const tenantId = (request as any)[TENANT_ID_KEY];
    if (tenantId && !filters.townId) {
      filters.townId = tenantId;
    }
    return this.experiencesService.findAll({ filters });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ALL EXPERIENCES PAGINATED (ADMIN)
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('admin/list')
  @Auth()
  @ApiOkResponse({ description: 'Experience List Paginated', type: AdminExperiencesListDto })
  findAllPaginated(@Query() filters: AdminExperiencesFiltersDto, @Req() request: Request) {
    const tenantId = (request as any)[TENANT_ID_KEY];
    if (tenantId && !filters.townId) {
      filters.townId = tenantId;
    }
    return this.experiencesService.findAllPaginated(filters);
  }

  // ------------------------------------------------------------------------------------------------
  // GET ALL PUBLIC EXPERIENCES
  // ------------------------------------------------------------------------------------------------
  @Get('public')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Experience List', type: [CreateExperienceDto] })
  findPublicExperiences(
    @ExperienceFilters() filters: ExperienceFiltersDto,
    @GetUser() user: User | undefined,
    @Req() request: Request,
    @RequestLocale() locale: string,
  ) {
    const tenantId = (request as any)[TENANT_ID_KEY];
    if (tenantId && !filters.townId) {
      filters.townId = tenantId;
    }
    return this.experiencesService.findPublicExperiences({ filters, user, locale });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ALL PUBLIC EXPERIENCES WITH FULL INFO
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('public/full-info')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Experience List', type: [ExperienceVectorDto] })
  findPublicFullInfoExperiences(@ExperienceFilters() filters: ExperienceFiltersDto, @Req() request: Request) {
    const tenantId = (request as any)[TENANT_ID_KEY];
    if (tenantId && !filters.townId) {
      filters.townId = tenantId;
    }
    return this.experiencesService.findPublicFullInfoExperiences({ filters });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET EXPERIENCE BY IDENTIFIER
  // * ----------------------------------------------------------------------------------------------------------------
  @Get(':identifier')
  @OptionalAuth()
  findOne(@Param('identifier') id: string, @GetUser() user?: User) {
    return this.experiencesService.findOne(id, user);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET EXPERIENCE BY SLUG
  // * ----------------------------------------------------------------------------------------------------------------
  @Get('slug/:slug')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Experience Detail', type: CreateExperienceDto })
  findOneBySlug(@Param('slug') slug: string, @GetUser() user?: User, @RequestLocale() locale: string = 'es') {
    return this.experiencesService.findOneBySlug({ slug, user, locale });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * SUBMIT EXPERIENCE FOR REVIEW (owner)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post(':identifier/submit-for-review')
  @Auth()
  @ApiOkResponse({ description: 'Experience submitted for review', type: ExperienceDto })
  submitForReview(@Param('identifier') identifier: string, @GetUser() user: User) {
    return this.experiencesService.submitForReview({ identifier, user });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * APPROVE EXPERIENCE (admin)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post('admin/:identifier/approve')
  @Auth()
  @ApiOkResponse({ description: 'Experience approved', type: ExperienceDto })
  approve(@Param('identifier') identifier: string) {
    return this.experiencesService.approve({ identifier });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * REJECT EXPERIENCE (admin)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post('admin/:identifier/reject')
  @Auth()
  @ApiOkResponse({ description: 'Experience rejected', type: ExperienceDto })
  reject(@Param('identifier') identifier: string, @Body() body: { reason: string }) {
    return this.experiencesService.reject({ identifier, reason: body.reason });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * CREATE EXPERIENCE
  // * ----------------------------------------------------------------------------------------------------------------
  @Post()
  @OptionalAuth()
  @ApiOkResponse({ description: 'Experience Created', type: CreateExperienceDto })
  create(@Body() createExperienceDto: CreateExperienceDto) {
    return this.experiencesService.create(createExperienceDto);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPDATE EXPERIENCE
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':identifier')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Experience Updated', type: CreateExperienceDto })
  update(@Param('identifier') identifier: string, @Body() updateExperienceDto: UpdateExperienceDto) {
    return this.experiencesService.update(identifier, updateExperienceDto);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPDATE GUIDE IN EXPERIENCE
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':identifier/guides/:guideId')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Guide Updated in Experience', type: ExperienceDto })
  @ApiBadRequestResponse({ description: 'The guide cannot be updated in the experience' })
  updateGuide(@Param('identifier') identifier: string, @Param('guideId', ParseUUIDPipe) guideId: string) {
    return this.experiencesService.updateGuide(identifier, guideId);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * DELETE EXPERIENCE
  // * ----------------------------------------------------------------------------------------------------------------
  @Delete(':identifier')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Experience Deleted' })
  deleteExperience(@Param('identifier') identifier: string) {
    return this.experiencesService.delete(identifier);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * BULK DELETE EXPERIENCES (admin)
  // * ----------------------------------------------------------------------------------------------------------------
  @Post('admin/bulk-delete')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Count of experiences deleted', schema: { example: { deleted: 4 } } })
  bulkDelete(@Body() dto: BulkDeleteExperiencesDto) {
    return this.experiencesService.bulkDelete(dto.ids);
  }

  @Patch(':identifier/visibility')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Experience Visibility Updated', type: ExperienceDto })
  @ApiBadRequestResponse({ description: 'The visibility cannot be updated' })
  updateVisibility(@Param('identifier') identifier: string, @Body() body: { isPublic: boolean }) {
    return this.experiencesService.updateVisibility(identifier, body.isPublic);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * UPLOAD EXPERIENCE IMAGE
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
    type: ExperienceDto,
  })
  @ApiBadRequestResponse({ description: 'The images cannot be uploaded' })
  uploadImages(@UploadedFiles() files: Express.Multer.File[], @Param('identifier') identifier: string) {
    return this.experiencesService.uploadImages(identifier, files);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET EXPERIENCE IMAGES
  // * ----------------------------------------------------------------------------------------------------------------
  @Get(':identifier/images')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Experience Images List' })
  getImages(@Param('identifier') identifier: string) {
    return this.experiencesService.getImages(identifier);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * DELETE EXPERIENCE IMAGE
  // * ----------------------------------------------------------------------------------------------------------------
  @Delete(':identifier/images/:imageId')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Image Deleted' })
  @ApiBadRequestResponse({ description: 'The image cannot be deleted' })
  deleteImage(@Param('identifier') identifier: string, @Param('imageId', ParseUUIDPipe) imageId: string) {
    return this.experiencesService.deleteImage(identifier, imageId);
  }

  @Patch(':identifier/images/reorder')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Images Reordered' })
  @ApiBadRequestResponse({ description: 'The images cannot be reordered' })
  reorderImages(@Param('identifier') identifier: string, @Body() reorderImagesDto: ReorderImagesDto) {
    return this.experiencesService.reorderImages(identifier, reorderImagesDto);
  }
}
