import { Body, Controller, Delete, Get, HttpStatus, NotImplementedException, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SwaggerTags } from 'src/config';
import { Auth } from 'src/modules/auth/decorators';
import { CreateModelDto, AdminModelsFiltersDto } from '../dto';
import { ModelsService } from '../services';
import { SuperAdmin } from '../../auth/decorators';

@Controller('models')
@ApiTags(SwaggerTags.Models)
export class ModelsController {
  constructor(private readonly modelsService: ModelsService) {}

  // * -------------------------------------------------------------------------------------------------------------
  // * GET ALL MODELS PAGINATED (ADMIN)
  // * -------------------------------------------------------------------------------------------------------------
  @Get('admin/list')
  @Auth()
  getAdminList(@Query() filters: AdminModelsFiltersDto) {
    return this.modelsService.findAllPaginated(filters);
  }

  // * -------------------------------------------------------------------------------------------------------------
  // * CREATE NEW MODEL
  // * -------------------------------------------------------------------------------------------------------------
  @Post()
  @SuperAdmin()
  create(@Body() createModelDto: CreateModelDto) {
    return this.modelsService.create(createModelDto);
  }
  // * -------------------------------------------------------------------------------------------------------------
  // * GET ALL MODELS
  // * -------------------------------------------------------------------------------------------------------------
  @Get()
  findAll() {
    return this.modelsService.findAll();
  }
  // * -------------------------------------------------------------------------------------------------------------
  // * GET MODEL BY ID
  // * -------------------------------------------------------------------------------------------------------------
  @Get(':id')
  @ApiOperation({ summary: 'This endpoint is currently disabled' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'This endpoint is disabled' })
  findOne() {
    throw new NotImplementedException('This action is not implemented');
  }
  // * -------------------------------------------------------------------------------------------------------------
  // * UPDATE MODEL
  // * -------------------------------------------------------------------------------------------------------------
  @Patch(':id')
  @SuperAdmin()
  @ApiOperation({ summary: 'This endpoint is currently disabled' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'This endpoint is disabled' })
  update() {
    throw new NotImplementedException('This action is not implemented');
  }
  // * -------------------------------------------------------------------------------------------------------------
  // * DELETE MODEL
  // * -------------------------------------------------------------------------------------------------------------
  @Delete(':id')
  @SuperAdmin()
  @ApiOperation({ summary: 'This endpoint is currently disabled' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'This endpoint is disabled' })
  remove() {
    throw new NotImplementedException('This action is not implemented');
  }
  // * -------------------------------------------------------------------------------------------------------------
  // * ADD CATEGORY TO MODEL
  // * -------------------------------------------------------------------------------------------------------------
  @Patch(':id/categories/:categoryId')
  @SuperAdmin()
  @ApiOperation({ summary: 'This endpoint is currently disabled' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'This endpoint is disabled' })
  addCategory() {
    throw new NotImplementedException('This action is not implemented');
  }
  // * -------------------------------------------------------------------------------------------------------------
  // * REMOVE CATEGORY FROM MODEL
  // * -------------------------------------------------------------------------------------------------------------
  @Delete(':id/categories/:categoryId')
  @SuperAdmin()
  @ApiOperation({ summary: 'This endpoint is currently disabled' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'This endpoint is disabled' })
  removeCategory() {
    throw new NotImplementedException('This action is not implemented');
  }
  // * -------------------------------------------------------------------------------------------------------------
  // * ADD FACILITY TO MODEL
  // * -------------------------------------------------------------------------------------------------------------
  @Patch(':id/facilities/:facilityId')
  @SuperAdmin()
  @ApiOperation({ summary: 'This endpoint is currently disabled' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'This endpoint is disabled' })
  addFacility() {
    throw new NotImplementedException('This action is not implemented');
  }
  // * -------------------------------------------------------------------------------------------------------------
  // * REMOVE FACILITY FROM MODEL
  // * -------------------------------------------------------------------------------------------------------------
  @Delete(':id/facilities/:facilityId')
  @SuperAdmin()
  @ApiOperation({ summary: 'This endpoint is currently disabled' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'This endpoint is disabled' })
  removeFacility() {
    throw new NotImplementedException('This action is not implemented');
  }
}
