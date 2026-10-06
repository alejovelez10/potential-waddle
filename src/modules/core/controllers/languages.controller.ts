import { Body, Controller, Delete, Get, HttpStatus, NotImplementedException, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SuperAdmin } from '../../auth/decorators';

import { SwaggerTags } from 'src/config';
import { CreateLanguageDto } from '../dto';
import { LanguagesService } from '../services';

@Controller('languages')
@ApiTags(SwaggerTags.Languages)
export class LanguagesController {
  constructor(private readonly languagesService: LanguagesService) {}
  // * -------------------------------------------------------------------------------------------------------------
  // * CREATE NEW LANGUAGE
  // * -------------------------------------------------------------------------------------------------------------
  @Post()
  @SuperAdmin()
  create(@Body() createLanguageDto: CreateLanguageDto) {
    return this.languagesService.create(createLanguageDto);
  }
  // * -------------------------------------------------------------------------------------------------------------
  // * GET ALL LANGUAGE
  // * -------------------------------------------------------------------------------------------------------------
  @Get()
  findAll() {
    return this.languagesService.findAll();
  }
  // * -------------------------------------------------------------------------------------------------------------
  // * GET LANGUAGE BY ID
  // * -------------------------------------------------------------------------------------------------------------
  @Get(':id')
  @ApiOperation({ summary: 'This endpoint is currently disabled' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'This endpoint is disabled' })
  findOne() {
    throw new NotImplementedException('This action is not implemented');
  }
  // * -------------------------------------------------------------------------------------------------------------
  // * UPDATE LANGUAGE
  // * -------------------------------------------------------------------------------------------------------------
  @Patch(':id')
  @SuperAdmin()
  @ApiOperation({ summary: 'This endpoint is currently disabled' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'This endpoint is disabled' })
  update() {
    throw new NotImplementedException('This action is not implemented');
  }
  // * -------------------------------------------------------------------------------------------------------------
  // * DELETE LANGUAGE
  // * -------------------------------------------------------------------------------------------------------------
  @Delete(':id')
  @SuperAdmin()
  @ApiOperation({ summary: 'This endpoint is currently disabled' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'This endpoint is disabled' })
  remove() {
    throw new NotImplementedException('This action is not implemented');
  }
}
