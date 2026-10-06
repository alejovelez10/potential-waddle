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
import { CommerceProductsService } from './commerce-products.service';
import { CreateCommerceProductDto, UpdateCommerceProductDto, CommerceProductDto } from './dto';
import { ContentTypes } from '../common/constants';
import { ReorderImagesDto } from '../common/dto/reoder-images.dto';

@Controller('commerce/:commerceId/products')
@ApiTags(SwaggerTags.Commerce)
export class CommerceProductsController {
  constructor(private readonly productsService: CommerceProductsService) {}

  @Post()
  @EntityAccess('manage', 'commerce', { param: 'commerceId' })
  @ApiOkResponse({ description: 'Product created successfully' })
  @ApiBadRequestResponse({ description: 'Bad request' })
  async create(@Param('commerceId', ParseUUIDPipe) commerceId: string, @Body() createDto: CreateCommerceProductDto) {
    const product = await this.productsService.create(commerceId, createDto);
    return new CommerceProductDto(product);
  }

  @Get()
  @ApiOkResponse({ description: 'Products retrieved successfully' })
  async findAll(@Param('commerceId', ParseUUIDPipe) commerceId: string) {
    const products = await this.productsService.findByCommerce(commerceId);
    return products.map(product => new CommerceProductDto(product));
  }

  @Get(':id')
  @ApiOkResponse({ description: 'Product retrieved successfully' })
  @ApiBadRequestResponse({ description: 'Product not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const product = await this.productsService.findOne(id);
    return new CommerceProductDto(product);
  }

  @Patch(':id')
  @EntityAccess('manage', 'commerce_product', { param: 'id' })
  @ApiOkResponse({ description: 'Product updated successfully' })
  @ApiBadRequestResponse({ description: 'Bad request' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() updateDto: UpdateCommerceProductDto) {
    console.log('Update product controller - id:', id);
    console.log('Update product controller - body:', JSON.stringify(updateDto));
    const product = await this.productsService.update(id, updateDto);
    return new CommerceProductDto(product);
  }

  @Delete(':id')
  @EntityAccess('manage', 'commerce_product', { param: 'id' })
  @ApiOkResponse({ description: 'Product deleted successfully' })
  @ApiBadRequestResponse({ description: 'Product not found' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.remove(id);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * PRODUCT IMAGE ENDPOINTS
  // * ----------------------------------------------------------------------------------------------------------------

  @Post(':id/upload-images')
  @EntityAccess('manage', 'commerce_product', { param: 'id' })
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
  async uploadImages(@UploadedFiles() files: Express.Multer.File[], @Param('id', ParseUUIDPipe) id: string) {
    const product = await this.productsService.uploadImages(id, files);
    return new CommerceProductDto(product);
  }

  @Get(':id/images')
  @ApiOkResponse({ description: 'Product images list' })
  getImages(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.getImages(id);
  }

  @Delete(':id/images/:imageId')
  @EntityAccess('manage', 'commerce_product', { param: 'id' })
  @ApiOkResponse({ description: 'Image deleted successfully' })
  @ApiBadRequestResponse({ description: 'Image not found' })
  deleteImage(@Param('id', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string) {
    return this.productsService.deleteImage(id, imageId);
  }

  @Patch(':id/images/reorder')
  @EntityAccess('manage', 'commerce_product', { param: 'id' })
  @ApiOkResponse({ description: 'Images reordered successfully' })
  @ApiBadRequestResponse({ description: 'Error reordering images' })
  reorderImages(@Param('id', ParseUUIDPipe) id: string, @Body() reorderDto: ReorderImagesDto) {
    return this.productsService.reorderImages(id, reorderDto);
  }
}
