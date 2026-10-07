import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseInterceptors,
  UploadedFiles,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { PublicEventsService } from './public-events.service';
import { CreatePublicEventDto, UpdatePublicEventDto, PublicEventFiltersDto, PublicEventDto } from './dto';
import { SwaggerTags } from 'src/config';
import { Auth, OptionalAuth } from '../auth/decorators';
import { GetUser } from '../common/decorators';
import { User } from '../users/entities';
import { ContentTypes } from '../common/constants';
import { ReorderImagesDto } from '../common/dto/reoder-images.dto';
import { EntityAccess } from '../common/decorators/entity-access.decorator';
import { SearchSync } from 'src/modules/search/decorators/search-sync.decorator';

@ApiTags(SwaggerTags.PublicEvents)
@Controller('public-events')
export class PublicEventsController {
  constructor(private readonly publicEventsService: PublicEventsService) {}

  @Post()
  @SearchSync('event', { fromResponse: true })
  @Auth()
  @ApiOperation({ summary: 'Create a new public event' })
  @ApiResponse({
    status: 201,
    description: 'The event has been successfully created.',
    type: PublicEventDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid input data' })
  @ApiConflictResponse({ description: 'Event with this slug already exists' })
  create(@Body() createPublicEventDto: CreatePublicEventDto, @GetUser() user: User) {
    // The event belongs to the caller. Only a super-admin or a town-admin of the event's town
    // may create it on behalf of another user.
    const isAdmin = !!user.isSuperUser || (user.towns ?? []).some(t => t.id === createPublicEventDto.townId);
    if (!isAdmin) createPublicEventDto.userId = user.id;
    return this.publicEventsService.create(createPublicEventDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all public events with filters' })
  @ApiResponse({
    status: 200,
    description: 'List of public events',
    type: [PublicEventDto],
  })
  findAll(@Query() filters: PublicEventFiltersDto) {
    return this.publicEventsService.findAll(filters);
  }

  @Get('debug/all')
  @ApiOperation({ summary: 'Debug: Get all events without filters' })
  async debugAll() {
    return this.publicEventsService.debugAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a public event by ID' })
  @ApiResponse({
    status: 200,
    description: 'The public event details',
    type: PublicEventDto,
  })
  @ApiNotFoundResponse({ description: 'Public event not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.publicEventsService.findOne(id);
  }

  @Get('slug/:slug')
  @ApiOperation({ summary: 'Get a public event by slug' })
  @ApiResponse({
    status: 200,
    description: 'The public event details',
    type: PublicEventDto,
  })
  @ApiNotFoundResponse({ description: 'Public event not found' })
  findBySlug(@Param('slug') slug: string) {
    return this.publicEventsService.findBySlug(slug);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get all public events for a specific user' })
  @ApiResponse({
    status: 200,
    description: 'List of public events for the user',
    type: [PublicEventDto],
  })
  async findUserEvents(@Param('userId', ParseUUIDPipe) userId: string) {
    try {
      return await this.publicEventsService.findAll({ userId });
    } catch (error) {
      console.error('Error in findUserEvents:', error);
      throw error;
    }
  }

  @Patch(':id')
  @EntityAccess('manage', 'public_event', { param: 'id' })
  @ApiOperation({ summary: 'Update a public event' })
  @ApiResponse({
    status: 200,
    description: 'The event has been successfully updated.',
    type: PublicEventDto,
  })
  @ApiNotFoundResponse({ description: 'Public event not found' })
  @ApiConflictResponse({ description: 'Event with this slug already exists' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() updatePublicEventDto: UpdatePublicEventDto) {
    return this.publicEventsService.update(id, updatePublicEventDto);
  }

  @Delete(':id')
  @EntityAccess('manage', 'public_event', { param: 'id' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a public event' })
  @ApiResponse({
    status: 204,
    description: 'The event has been successfully deleted.',
  })
  @ApiNotFoundResponse({ description: 'Public event not found' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.publicEventsService.remove(id);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * IMAGE MANAGEMENT ENDPOINTS
  // * ----------------------------------------------------------------------------------------------------------------

  @Post(':id/upload-images')
  @EntityAccess('manage', 'public_event', { param: 'id' })
  @UseInterceptors(FilesInterceptor('files', 10))
  @ApiOperation({ summary: 'Upload images for a public event' })
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
  @ApiResponse({
    status: 200,
    description: 'Images uploaded successfully',
  })
  @ApiNotFoundResponse({ description: 'Public event not found' })
  @ApiBadRequestResponse({ description: 'Error uploading images' })
  uploadImages(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() uploadDto: { mediaFormat?: string; videoUrl?: string },
  ) {
    return this.publicEventsService.uploadImages(id, files, uploadDto.mediaFormat, uploadDto.videoUrl);
  }

  @Delete(':id/images/:imageId')
  @EntityAccess('manage', 'public_event', { param: 'id' })
  @ApiOkResponse({ description: 'Image Deleted' })
  @ApiBadRequestResponse({ description: 'The image cannot be deleted' })
  deleteImage(@Param('id', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string) {
    return this.publicEventsService.deleteImage(id, imageId);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * REORDER PUBLIC EVENT IMAGES
  // * ----------------------------------------------------------------------------------------------------------------
  @Patch(':id/images/reorder')
  @EntityAccess('manage', 'public_event', { param: 'id' })
  @ApiOkResponse({ description: 'Images Reordered' })
  @ApiBadRequestResponse({ description: 'The images cannot be reordered' })
  reorderImages(@Param('id', ParseUUIDPipe) id: string, @Body() reorderImagesDto: ReorderImagesDto) {
    return this.publicEventsService.reorderImages(id, reorderImagesDto);
  }

  @Patch(':eventId/images/:imageId/main')
  @EntityAccess('manage', 'public_event', { param: 'eventId' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set an image as main for a public event' })
  @ApiResponse({
    status: 204,
    description: 'Main image set successfully',
  })
  @ApiNotFoundResponse({ description: 'Public event or image not found' })
  setMainImage(@Param('eventId', ParseUUIDPipe) eventId: string, @Param('imageId', ParseUUIDPipe) imageId: string) {
    return this.publicEventsService.setMainImage(eventId, imageId);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET PUBLIC EVENT IMAGES
  // * ----------------------------------------------------------------------------------------------------------------
  @Get(':id/images')
  @OptionalAuth()
  @ApiOkResponse({ description: 'Public Event Images List' })
  getImages(@Param('id', ParseUUIDPipe) id: string) {
    return this.publicEventsService.getImages(id);
  }
}
