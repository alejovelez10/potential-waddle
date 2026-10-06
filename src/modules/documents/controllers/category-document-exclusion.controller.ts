import { Controller, Get, Post, Delete, Param, Body, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CategoryDocumentExclusionService } from '../services';
import { Auth, SuperAdmin } from '../../auth/decorators';

@ApiTags('Category Document Exclusions')
@Controller('category-document-exclusions')
export class CategoryDocumentExclusionController {
  constructor(private readonly exclusionService: CategoryDocumentExclusionService) {}

  @Get('category/:categoryId')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get exclusions for a category' })
  getExclusionsByCategoryId(@Param('categoryId', ParseUUIDPipe) categoryId: string) {
    return this.exclusionService.getExclusionsByCategoryId(categoryId);
  }

  @Get('category/:categoryId/with-details')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get category with exclusions and available document types' })
  getCategoryWithExclusions(@Param('categoryId', ParseUUIDPipe) categoryId: string) {
    return this.exclusionService.getCategoryWithExclusions(categoryId);
  }

  @Post('category/:categoryId')
  @SuperAdmin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update exclusions for a category (replace all)' })
  updateExclusions(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() body: { documentTypeIds: string[] },
  ) {
    return this.exclusionService.updateExclusions(categoryId, body.documentTypeIds);
  }

  @Post('category/:categoryId/document-type/:documentTypeId')
  @SuperAdmin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a single exclusion' })
  addExclusion(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('documentTypeId', ParseUUIDPipe) documentTypeId: string,
  ) {
    return this.exclusionService.addExclusion(categoryId, documentTypeId);
  }

  @Delete('category/:categoryId/document-type/:documentTypeId')
  @SuperAdmin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a single exclusion' })
  removeExclusion(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('documentTypeId', ParseUUIDPipe) documentTypeId: string,
  ) {
    return this.exclusionService.removeExclusion(categoryId, documentTypeId);
  }
}
