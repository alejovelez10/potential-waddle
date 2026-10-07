import { Body, Controller, Delete, Get, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiParam } from '@nestjs/swagger';
import { SwaggerTags } from 'src/config';
import { Auth } from 'src/modules/auth/decorators';
import { CreateAppIconDto, UpdateAppIconDto, AdminAppIconsFiltersDto } from '../dto';
import { AppIconsService } from '../services';
import { SuperAdmin } from '../../auth/decorators';
import { SearchSyncSkip } from 'src/modules/search/decorators/search-sync.decorator';

// Search sync: these routes never change catalog records.
@SearchSyncSkip()
@Controller('app-icons')
@ApiTags(SwaggerTags.AppIcons)
export class AppIconsController {
  constructor(private readonly appIconsService: AppIconsService) {}

  // * -------------------------------------------------------------------------------------------------------------
  // * GET ALL APP ICONS PAGINATED (ADMIN)
  // * -------------------------------------------------------------------------------------------------------------
  @Get('admin/list')
  @SuperAdmin()
  getAdminList(@Query() filters: AdminAppIconsFiltersDto) {
    return this.appIconsService.findAllPaginated(filters);
  }

  // * -------------------------------------------------------------------------------------------------------------
  // * CREATE NEW APP ICON
  // * -------------------------------------------------------------------------------------------------------------
  @Post()
  @SuperAdmin()
  @ApiOperation({ summary: 'Create a new app icon' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'App icon successfully created',
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input data' })
  create(@Body() createAppIconDto: CreateAppIconDto) {
    return this.appIconsService.create(createAppIconDto);
  }

  // * -------------------------------------------------------------------------------------------------------------
  // * GET ALL APP ICONS
  // * -------------------------------------------------------------------------------------------------------------
  @Get()
  @ApiOperation({ summary: 'Get all app icons' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns a list of app icons',
  })
  findAll() {
    return this.appIconsService.findAll();
  }

  // * -------------------------------------------------------------------------------------------------------------
  // * GET ALL APP ICONS (FULL)
  // * -------------------------------------------------------------------------------------------------------------
  @Get('full')
  @ApiOperation({ summary: 'Get all app icons with complete information' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns all app icons with complete information including all relationships',
  })
  findAllFull() {
    return this.appIconsService.findAllFull();
  }

  // * -------------------------------------------------------------------------------------------------------------
  // * GET APP ICON BY ID
  // * -------------------------------------------------------------------------------------------------------------
  @Get(':id')
  @ApiOperation({ summary: 'Get an app icon by ID' })
  @ApiParam({ name: 'id', description: 'App Icon UUID', type: 'string' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns the app icon with complete information',
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'App Icon not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.appIconsService.findOne(id);
  }

  // * -------------------------------------------------------------------------------------------------------------
  // * UPDATE APP ICON
  // * -------------------------------------------------------------------------------------------------------------
  @Patch(':id')
  @SuperAdmin()
  @ApiOperation({ summary: 'Update an app icon' })
  @ApiParam({ name: 'id', description: 'App Icon UUID', type: 'string' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns the updated app icon',
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'App Icon not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input data' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() updateAppIconDto: UpdateAppIconDto) {
    return this.appIconsService.update(id, updateAppIconDto);
  }

  // * -------------------------------------------------------------------------------------------------------------
  // * DELETE APP ICON
  // * -------------------------------------------------------------------------------------------------------------
  @Delete(':id')
  @SuperAdmin()
  @ApiOperation({ summary: 'Delete an app icon' })
  @ApiParam({ name: 'id', description: 'App Icon UUID', type: 'string' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'App icon successfully deleted',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'App Icon "Restaurant" has been successfully deleted' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'App Icon not found' })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Cannot delete app icon with active relationships',
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.appIconsService.remove(id);
  }
}
