import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags, ApiParam, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { SwaggerTags } from 'src/config';
import { CreateCategoryDto, UpdateCategoryDto } from '../dto';
import { CategoriesService } from '../services';
import { ModelsEnum } from '../enums';
import {
  PublicCategoryDto,
  FullCategoryDto,
  AdminCategoriesFiltersDto,
  AdminCategoriesListDto,
} from '../dto/categories';
import { ContentTypes } from 'src/modules/common/constants';
import { Auth } from '../../auth/decorators';
import { RequestLocale } from '../../translations/request-locale.decorator';
import { TranslationResolverService } from '../../translations/translation-resolver.service';

@Controller('categories')
@ApiTags(SwaggerTags.Categories)
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly translationResolver: TranslationResolverService,
  ) {}
  // * -------------------------------------------------------------------------------------------------------------
  // * CREATE NEW CATEGORY
  // * -------------------------------------------------------------------------------------------------------------
  @Post()
  @Auth()
  create(@Body() createCategoryDto: CreateCategoryDto) {
    return this.categoriesService.create(createCategoryDto);
  }
  // * -------------------------------------------------------------------------------------------------------------
  // * GET ALL CATEGORY
  // * -------------------------------------------------------------------------------------------------------------
  @Get()
  @ApiQuery({
    name: 'model',
    required: false,
    enum: ModelsEnum,
    description:
      'Retrieves the categories assigned to the selected model, ensuring they have at least one relationship',
  })
  @ApiQuery({
    name: 'only-enabled',
    required: false,
    type: Boolean,
    description: 'Retrieves only enabled categories, by default is true.',
  })
  @ApiQuery({
    name: 'only-asigned',
    required: false,
    type: Boolean,
    description:
      'Retrieves only the categories that have relationships with any reference model. By default, this is set to false. This query parameter is applied only when no specific model is provided, and it ensures that only categories with at least one relationship to a reference model are retrieved.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: [PublicCategoryDto],
    description: 'Returns a list of categories',
  })
  async findAll(
    @Query('model', new ParseEnumPipe(ModelsEnum, { optional: true })) model?: ModelsEnum,
    @Query('only-enabled', new ParseBoolPipe({ optional: true })) onlyEnabled?: boolean,
    @Query('only-asigned', new ParseBoolPipe({ optional: true })) onlyAsigned?: boolean,
    @RequestLocale() locale: string = 'es',
  ) {
    const categories = await this.categoriesService.findAll({ model, onlyEnabled, onlyAsigned });
    if (locale === 'es' || !categories.length) return categories;
    const translationsMap = await this.translationResolver.batchLoad('category', categories.map(c => c.id), locale);
    return categories.map(cat =>
      this.translationResolver.overlay({ ...cat }, translationsMap.get(cat.id) ?? {}),
    );
  }
  // * -------------------------------------------------------------------------------------------------------------
  // * GET ALL CATEGORIES (FULL)
  // * -------------------------------------------------------------------------------------------------------------
  @Get('full')
  @ApiOperation({ summary: 'Get all categories with complete information' })
  @ApiResponse({
    status: HttpStatus.OK,
    type: [FullCategoryDto],
    description: 'Returns all categories with complete information including all relationships',
  })
  findAllFull() {
    return this.categoriesService.findAllFull();
  }
  // * -------------------------------------------------------------------------------------------------------------
  // * GET ALL CATEGORIES (PAGINATED - ADMIN)
  // * -------------------------------------------------------------------------------------------------------------
  @Get('admin/list')
  @Auth()
  @ApiOperation({ summary: 'Get paginated categories for admin' })
  @ApiResponse({
    status: HttpStatus.OK,
    type: AdminCategoriesListDto,
    description: 'Returns paginated categories with complete information for admin management',
  })
  findAllPaginated(@Query() filters: AdminCategoriesFiltersDto) {
    return this.categoriesService.findAllPaginated(filters);
  }
  // * -------------------------------------------------------------------------------------------------------------
  // * GET CATEGORY BY ID
  // * -------------------------------------------------------------------------------------------------------------
  @Get(':id')
  @ApiOperation({ summary: 'Get a category by ID' })
  @ApiParam({ name: 'id', description: 'Category UUID', type: 'string' })
  @ApiResponse({
    status: HttpStatus.OK,
    type: FullCategoryDto,
    description: 'Returns the category with complete information',
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Category not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoriesService.findOne(id);
  }
  // * -------------------------------------------------------------------------------------------------------------
  // * UPDATE CATEGORY
  // * -------------------------------------------------------------------------------------------------------------
  @Patch(':id')
  @Auth()
  @ApiOperation({ summary: 'Update a category' })
  @ApiParam({ name: 'id', description: 'Category UUID', type: 'string' })
  @ApiResponse({
    status: HttpStatus.OK,
    type: FullCategoryDto,
    description: 'Returns the updated category',
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Category not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input data' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() updateCategoryDto: UpdateCategoryDto) {
    return this.categoriesService.update(id, updateCategoryDto);
  }
  // * -------------------------------------------------------------------------------------------------------------
  // * DELETE CATEGORY
  // * -------------------------------------------------------------------------------------------------------------
  @Delete(':id')
  @Auth()
  @ApiOperation({ summary: 'Delete a category' })
  @ApiParam({ name: 'id', description: 'Category UUID', type: 'string' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Category successfully deleted',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Category "Food" has been successfully deleted' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Category not found' })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Cannot delete category with active relationships',
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoriesService.remove(id);
  }

  // * -------------------------------------------------------------------------------------------------------------
  // * UPLOAD CATEGORY IMAGE
  // * -------------------------------------------------------------------------------------------------------------
  @Post(':id/upload-image')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload an image for a category' })
  @ApiParam({ name: 'id', description: 'Category UUID', type: 'string' })
  @ApiConsumes(ContentTypes.MULTIPART_FORM_DATA)
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: FullCategoryDto,
    description: 'Image uploaded successfully',
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Category not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Error uploading image' })
  uploadImage(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.categoriesService.uploadImage(id, file);
  }

  // * -------------------------------------------------------------------------------------------------------------
  // * DELETE CATEGORY IMAGE
  // * -------------------------------------------------------------------------------------------------------------
  @Delete(':id/image')
  @ApiOperation({ summary: 'Delete category image' })
  @ApiParam({ name: 'id', description: 'Category UUID', type: 'string' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Image deleted successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Category image deleted successfully' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Category or image not found' })
  deleteImage(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoriesService.deleteImage(id);
  }
}
