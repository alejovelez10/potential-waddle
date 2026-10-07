import { Body, Controller, Get, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiBody, ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { AppConfigService } from '../services';
import { SuperAdmin } from '../../auth/decorators';
import { SearchSyncSkip } from 'src/modules/search/decorators/search-sync.decorator';

// DTOs
class SetConfigValueDto {
  @ApiProperty()
  @IsString()
  key: string;

  @ApiProperty()
  @IsString()
  value: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;
}

class UpdateRafaModeDto {
  @ApiProperty({ enum: ['basic', 'superIA'] })
  @IsEnum(['basic', 'superIA'])
  mode: 'basic' | 'superIA';
}

// Search sync: these routes never change catalog records.
@SearchSyncSkip()
@Controller('app-config')
@ApiTags('App Configuration')
export class AppConfigController {
  constructor(private readonly appConfigService: AppConfigService) {}

  // * -------------------------------------------------------------------------------------------------------------
  // * GET ALL CONFIGURATIONS
  // * -------------------------------------------------------------------------------------------------------------
  @Get()
  @ApiOperation({ summary: 'Get all app configurations' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of all app configurations retrieved successfully',
  })
  async findAll() {
    return this.appConfigService.findAll();
  }

  // * -------------------------------------------------------------------------------------------------------------
  // * GET CONFIGURATION BY KEY
  // * -------------------------------------------------------------------------------------------------------------
  @Get(':key')
  @ApiOperation({ summary: 'Get configuration by key' })
  @ApiParam({ name: 'key', description: 'Configuration key' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Configuration retrieved successfully',
  })
  async findByKey(@Param('key') key: string) {
    return this.appConfigService.findByKey(key);
  }

  // * -------------------------------------------------------------------------------------------------------------
  // * SET/UPDATE CONFIGURATION VALUE
  // * -------------------------------------------------------------------------------------------------------------
  @Post()
  @SuperAdmin()
  @ApiOperation({ summary: 'Set or update configuration value' })
  @ApiBody({ type: SetConfigValueDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Configuration value set successfully',
  })
  async setValue(@Body() setConfigDto: SetConfigValueDto) {
    return this.appConfigService.setValue(setConfigDto.key, setConfigDto.value, setConfigDto.description);
  }

  // * -------------------------------------------------------------------------------------------------------------
  // * UPDATE CONFIGURATION VALUE BY KEY
  // * -------------------------------------------------------------------------------------------------------------
  @Patch(':key')
  @SuperAdmin()
  @ApiOperation({ summary: 'Update configuration value by key' })
  @ApiParam({ name: 'key', description: 'Configuration key' })
  @ApiBody({ schema: { properties: { value: { type: 'string' } } } })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Configuration value updated successfully',
  })
  async updateValue(@Param('key') key: string, @Body('value') value: string) {
    return this.appConfigService.updateValue(key, value);
  }

  // * -------------------------------------------------------------------------------------------------------------
  // * GET RAFA MODE (PUBLIC)
  // * -------------------------------------------------------------------------------------------------------------
  @Get('rafa/mode')
  @ApiOperation({ summary: 'Get current Rafa mode configuration' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Current Rafa mode retrieved successfully',
    schema: {
      properties: {
        mode: { type: 'string', enum: ['basic', 'superIA'] },
      },
    },
  })
  async getRafaMode() {
    const mode = await this.appConfigService.getRafaMode();
    return { mode };
  }

  // * -------------------------------------------------------------------------------------------------------------
  // * SET RAFA MODE
  // * -------------------------------------------------------------------------------------------------------------
  @Patch('rafa/mode')
  @SuperAdmin()
  @ApiOperation({ summary: 'Update Rafa mode configuration' })
  @ApiBody({ type: UpdateRafaModeDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Rafa mode updated successfully',
  })
  async setRafaMode(@Body() updateRafaMode: UpdateRafaModeDto) {
    return this.appConfigService.setRafaMode(updateRafaMode.mode);
  }
}
