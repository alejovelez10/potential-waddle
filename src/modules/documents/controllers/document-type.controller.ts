import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseUUIDPipe,
  Query,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentTypeService } from '../services';
import { CreateDocumentTypeDto, UpdateDocumentTypeDto, DocumentTypeResponseDto } from '../dto';
import { Auth, SuperAdmin } from '../../auth/decorators';

@ApiTags('Document Types')
@Controller('document-types')
export class DocumentTypeController {
  constructor(private readonly documentTypeService: DocumentTypeService) {}

  @Post()
  @SuperAdmin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new document type (Super Admin only)' })
  @ApiOkResponse({ type: DocumentTypeResponseDto })
  create(@Body() createDto: CreateDocumentTypeDto) {
    return this.documentTypeService.create(createDto);
  }

  @Get()
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all document types' })
  @ApiOkResponse({ type: [DocumentTypeResponseDto] })
  findAll(@Query('includeInactive') includeInactive?: string) {
    return this.documentTypeService.findAll(includeInactive === 'true');
  }

  @Get(':id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a document type by ID' })
  @ApiOkResponse({ type: DocumentTypeResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.documentTypeService.findOne(id);
  }

  @Patch(':id')
  @SuperAdmin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a document type' })
  @ApiOkResponse({ type: DocumentTypeResponseDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() updateDto: UpdateDocumentTypeDto) {
    return this.documentTypeService.update(id, updateDto);
  }

  @Patch(':id/toggle-active')
  @SuperAdmin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle document type active status' })
  @ApiOkResponse({ type: DocumentTypeResponseDto })
  toggleActive(@Param('id', ParseUUIDPipe) id: string) {
    return this.documentTypeService.toggleActive(id);
  }

  @Delete(':id')
  @SuperAdmin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a document type' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.documentTypeService.remove(id);
  }

  @Post(':id/template')
  @SuperAdmin()
  @ApiBearerAuth()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a template document for a document type' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiOkResponse({ type: DocumentTypeResponseDto })
  uploadTemplate(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.documentTypeService.uploadTemplate(id, file);
  }

  @Delete(':id/template')
  @SuperAdmin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete template document from a document type' })
  @ApiOkResponse({ type: DocumentTypeResponseDto })
  deleteTemplate(@Param('id', ParseUUIDPipe) id: string) {
    return this.documentTypeService.deleteTemplate(id);
  }
}
