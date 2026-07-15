import { Body, Controller, Delete, Get, HttpStatus, ParseEnumPipe, Patch, Post, Query, Param } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SwaggerTags } from 'src/config';
import { Auth } from 'src/modules/auth/decorators';
import { CreateFacilityDto, UpdateFacilityDto, AdminFacilitiesFiltersDto } from '../dto';
import { FacilitiesService } from '../services';
import { ModelsEnum } from '../enums';
import { RequestLocale } from '../../translations/request-locale.decorator';
import { TranslationResolverService } from '../../translations/translation-resolver.service';

@Controller('facilities')
@ApiTags(SwaggerTags.Facilities)
export class FacilitiesController {
  constructor(
    private readonly facilitiesService: FacilitiesService,
    private readonly translationResolver: TranslationResolverService,
  ) {}

  // * -------------------------------------------------------------------------------------------------------------
  // * GET ALL FACILITIES PAGINATED (ADMIN)
  // * -------------------------------------------------------------------------------------------------------------
  @Get('admin/list')
  @Auth()
  getAdminList(@Query() filters: AdminFacilitiesFiltersDto) {
    return this.facilitiesService.findAllPaginated(filters);
  }

  // * -------------------------------------------------------------------------------------------------------------
  // * CREATE NEW FACILITY
  // * -------------------------------------------------------------------------------------------------------------
  @Post()
  create(@Body() createFacilityDto: CreateFacilityDto) {
    return this.facilitiesService.create(createFacilityDto);
  }
  // * -------------------------------------------------------------------------------------------------------------
  // * GET ALL FACILITY
  // * -------------------------------------------------------------------------------------------------------------
  @Get()
  @ApiQuery({
    name: 'slug',
    required: false,
    description: 'Slug model: Retrieves the model facilities along with the general facilities.',
    type: String,
  })
  @ApiQuery({
    name: 'inner-join',
    required: false,
    enum: ModelsEnum,
    description:
      'Retrieves the categories assigned to the model. This parameter takes precedence over the slug parameter.',
  })
  async findAll(
    @Query('slug') slug?: string,
    @Query('inner-join', new ParseEnumPipe(ModelsEnum, { optional: true })) innerJoin?: ModelsEnum,
    @RequestLocale() locale: string = 'es',
  ) {
    const facilities = await this.facilitiesService.findAll({ slug, innerJoin });
    if (locale === 'es' || !facilities.length) return facilities;
    const translationsMap = await this.translationResolver.batchLoad('facility', facilities.map(f => f.id), locale);
    return facilities.map(fac =>
      this.translationResolver.overlay({ ...fac }, translationsMap.get(fac.id) ?? {}),
    );
  }

  @Get('full')
  findAllFull() {
    return this.facilitiesService.findAllFull();
  }

  // * -------------------------------------------------------------------------------------------------------------
  // * GET FACILITY BY ID
  // * -------------------------------------------------------------------------------------------------------------
  @Get(':id')
  @ApiOperation({ summary: 'Get facility by ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Facility retrieved successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Facility not found' })
  findOne(@Param('id') id: string) {
    return this.facilitiesService.findOne(id);
  }
  // * -------------------------------------------------------------------------------------------------------------
  // * UPDATE FACILITY
  // * -------------------------------------------------------------------------------------------------------------
  @Patch(':id')
  @ApiOperation({ summary: 'Update facility by ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Facility updated successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Facility not found' })
  update(@Param('id') id: string, @Body() updateFacilityDto: UpdateFacilityDto) {
    return this.facilitiesService.update(id, updateFacilityDto);
  }
  // * -------------------------------------------------------------------------------------------------------------
  // * DELETE FACILITY
  // * -------------------------------------------------------------------------------------------------------------
  @Delete(':id')
  @ApiOperation({ summary: 'Delete facility by ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Facility deleted successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Facility not found' })
  remove(@Param('id') id: string) {
    return this.facilitiesService.remove(id);
  }
}
