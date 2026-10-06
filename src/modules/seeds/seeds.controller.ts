import { ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  Controller,
  Get,
  ParseBoolPipe,
  ParseEnumPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { SuperAdmin } from '../auth/decorators';

import { FileDto } from './dto';
import { FileSheetsEnum } from './enums';
import { SwaggerTags } from 'src/config';
import { SeedsService } from './seeds.service';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('seeds')
@SuperAdmin()
@ApiTags(SwaggerTags.Seeds)
export class SeedsController {
  constructor(private readonly seedsService: SeedsService) {}

  @Post('')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary:
      'Seed the data from excel file. The file should be in the format of .xlsx and should contain the required data.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: FileDto })
  @ApiQuery({ name: 'truncate', required: false, type: Boolean })
  @ApiQuery({ name: 'collection', required: false, enum: FileSheetsEnum })
  @ApiQuery({
    name: 'omit-images',
    required: false,
    type: Boolean,
    description: 'By default this end point create or recreate the images.',
  })
  seedFromFile(
    @UploadedFile() file: Express.Multer.File,
    @Query('truncate', new ParseBoolPipe({ optional: true })) truncate?: boolean,
    @Query('collection', new ParseEnumPipe(FileSheetsEnum, { optional: true })) collection?: FileSheetsEnum,
    @Query('omit-images', new ParseBoolPipe({ optional: true })) omitImages?: boolean,
  ) {
    return this.seedsService.seedFromFile({ file, truncate, collection, omitImages });
  }

  @Post('truncate')
  @ApiOperation({ summary: 'Truncate all the data in the database.' })
  truncate() {
    return this.seedsService.truncateAllData();
  }

  @Get('avaliable-sheets')
  sheets() {
    const sheets: string[] = Object.values(FileSheetsEnum);
    return sheets;
  }
}
