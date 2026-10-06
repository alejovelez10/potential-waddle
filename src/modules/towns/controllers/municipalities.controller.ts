import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ApiNotImplementedResponse, ApiTags } from '@nestjs/swagger';
import { SuperAdmin } from '../../auth/decorators';

import { SwaggerTags } from 'src/config';
import { Auth } from 'src/modules/auth/decorators';
import { CreateMunicipalityDto, UpdateMunicipalityDto, AdminDepartmentsFiltersDto } from '../dto';
import { MunicipalitiesService } from '../services/municipalities.service';

@Controller('municipalities')
@ApiTags(SwaggerTags.Municipality)
export class MunicipalitiesController {
  constructor(private readonly municipalitiesServices: MunicipalitiesService) {}

  @Get('admin/list')
  @Auth()
  getAdminList(@Query() filters: AdminDepartmentsFiltersDto) {
    return this.municipalitiesServices.findAllPaginated(filters);
  }

  @Post()
  @SuperAdmin()
  create(@Body() createMunicipalityDto: CreateMunicipalityDto) {
    return this.municipalitiesServices.create(createMunicipalityDto);
  }

  @Get()
  findAll() {
    return this.municipalitiesServices.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.municipalitiesServices.findOne(id);
  }

  @Patch(':id')
  @SuperAdmin()
  @ApiNotImplementedResponse({ description: 'This endpoint is not implemented yet' })
  update(@Param('id') id: string, @Body() updateMunicipalityDto: UpdateMunicipalityDto) {
    return this.municipalitiesServices.update(id, updateMunicipalityDto);
  }

  @Delete(':id')
  @SuperAdmin()
  @ApiNotImplementedResponse({ description: 'This endpoint is not implemented yet' })
  remove(@Param('id') id: string) {
    return this.municipalitiesServices.remove(id);
  }
}
