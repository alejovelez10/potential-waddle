import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { ApiTags, ApiOkResponse, ApiBadRequestResponse, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { EntityAccess } from '../common/decorators/entity-access.decorator';

import { SwaggerTags } from 'src/config';
import { LodgingRoomTypesService } from './lodging-room-types.service';
import { CreateLodgingRoomTypeDto, UpdateLodgingRoomTypeDto } from './dto';
import { ContentTypes } from '../common/constants';
import { ReorderImagesDto } from '../common/dto/reoder-images.dto';

@Controller('lodgings/:lodgingId/room-types')
@ApiTags(SwaggerTags.Lodgings)
export class LodgingRoomTypesController {
  constructor(private readonly lodgingRoomTypesService: LodgingRoomTypesService) {}

  @Post()
  @EntityAccess('manage', 'lodging', { param: 'lodgingId' })
  @ApiOkResponse({ description: 'Room type created successfully' })
  @ApiBadRequestResponse({ description: 'Bad request' })
  create(
    @Param('lodgingId', ParseUUIDPipe) lodgingId: string,
    @Body() createLodgingRoomTypeDto: CreateLodgingRoomTypeDto,
  ) {
    return this.lodgingRoomTypesService.create(lodgingId, createLodgingRoomTypeDto);
  }

  @Get()
  @ApiOkResponse({ description: 'Room types retrieved successfully' })
  findAll(@Param('lodgingId', ParseUUIDPipe) lodgingId: string) {
    return this.lodgingRoomTypesService.findByLodging(lodgingId);
  }

  @Get(':id')
  @ApiOkResponse({ description: 'Room type retrieved successfully' })
  @ApiBadRequestResponse({ description: 'Room type not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.lodgingRoomTypesService.findOne(id);
  }

  @Patch(':id')
  @EntityAccess('manage', 'lodging_room_type', { param: 'id' })
  @ApiOkResponse({ description: 'Room type updated successfully' })
  @ApiBadRequestResponse({ description: 'Bad request' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() updateLodgingRoomTypeDto: UpdateLodgingRoomTypeDto) {
    return this.lodgingRoomTypesService.update(id, updateLodgingRoomTypeDto);
  }

  @Delete(':id')
  @EntityAccess('manage', 'lodging_room_type', { param: 'id' })
  @ApiOkResponse({ description: 'Room type deleted successfully' })
  @ApiBadRequestResponse({ description: 'Room type not found' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.lodgingRoomTypesService.remove(id);
  }

  @Delete(':id/permanent')
  @EntityAccess('manage', 'lodging_room_type', { param: 'id' })
  @ApiOkResponse({ description: 'Room type permanently deleted successfully' })
  @ApiBadRequestResponse({ description: 'Room type not found' })
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.lodgingRoomTypesService.delete(id);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * ROOM TYPE IMAGE ENDPOINTS
  // * ----------------------------------------------------------------------------------------------------------------

  @Post(':id/upload-images')
  @EntityAccess('manage', 'lodging_room_type', { param: 'id' })
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
  @ApiOkResponse({ description: 'Images uploaded successfully' })
  @ApiBadRequestResponse({ description: 'The images cannot be uploaded' })
  uploadImages(@UploadedFiles() files: Express.Multer.File[], @Param('id', ParseUUIDPipe) id: string) {
    return this.lodgingRoomTypesService.uploadImages(id, files);
  }

  @Get(':id/images')
  @ApiOkResponse({ description: 'Room type images list' })
  getImages(@Param('id', ParseUUIDPipe) id: string) {
    return this.lodgingRoomTypesService.getImages(id);
  }

  @Delete(':id/images/:imageId')
  @EntityAccess('manage', 'lodging_room_type', { param: 'id' })
  @ApiOkResponse({ description: 'Image deleted successfully' })
  @ApiBadRequestResponse({ description: 'Image not found' })
  deleteImage(@Param('id', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string) {
    return this.lodgingRoomTypesService.deleteImage(id, imageId);
  }

  @Patch(':id/images/reorder')
  @EntityAccess('manage', 'lodging_room_type', { param: 'id' })
  @ApiOkResponse({ description: 'Images reordered successfully' })
  @ApiBadRequestResponse({ description: 'Error reordering images' })
  reorderImages(@Param('id', ParseUUIDPipe) id: string, @Body() reorderDto: ReorderImagesDto) {
    return this.lodgingRoomTypesService.reorderImages(id, reorderDto);
  }
}
