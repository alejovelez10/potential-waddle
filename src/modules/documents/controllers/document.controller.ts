import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  Req,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { DocumentService } from '../services';
import { CreateDocumentDto, UpdateDocumentStatusDto, DocumentResponseDto, EntityDocumentStatusDto } from '../dto';
import { Auth, SuperAdmin } from '../../auth/decorators';
import { GetUser } from '../../common/decorators';
import { EntityOwnershipResolver } from '../../common/services/entity-ownership.resolver';
import { User } from '../../users/entities';
import { DocumentEntityType } from '../enums';
import { TENANT_ID_KEY } from '../../tenant/tenant.interceptor';

@ApiTags('Documents')
@Controller('documents')
export class DocumentController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly ownership: EntityOwnershipResolver,
  ) {}

  @Post('upload')
  @Auth()
  @ApiBearerAuth()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a document' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        documentTypeId: { type: 'string', format: 'uuid' },
        entityType: { type: 'string', enum: Object.values(DocumentEntityType) },
        entityId: { type: 'string', format: 'uuid' },
        expirationDate: { type: 'string', format: 'date', nullable: true },
      },
      required: ['file', 'documentTypeId', 'entityType', 'entityId'],
    },
  })
  @ApiOkResponse({ type: DocumentResponseDto })
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() createDto: CreateDocumentDto,
    @GetUser() user: User,
    @Req() request: Request,
  ) {
    await this.ownership.assertCanManage(createDto.entityType, createDto.entityId, user);
    const townId = (request as any)[TENANT_ID_KEY];
    const document = await this.documentService.uploadDocument(createDto, file, user.id, townId);
    return this.documentService.withSignedUrl(document);
  }

  @Get('entity/:entityType/:entityId')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all documents for an entity' })
  @ApiOkResponse({ type: [DocumentResponseDto] })
  async findByEntity(
    @Param('entityType') entityType: DocumentEntityType,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @GetUser() user: User,
  ) {
    await this.ownership.assertCanRead(entityType, entityId, user);
    const documents = await this.documentService.findByEntity(entityType, entityId);
    return Promise.all(documents.map(document => this.documentService.withSignedUrl(document)));
  }

  @Get('entity/:entityType/:entityId/status')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get document status for an entity with all requirements' })
  @ApiOkResponse({ type: [EntityDocumentStatusDto] })
  async getEntityDocumentStatus(
    @Param('entityType') entityType: DocumentEntityType,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Query('categoryIds') categoryIds: string,
    @Req() request: Request,
    @GetUser() user: User,
  ) {
    await this.ownership.assertCanRead(entityType, entityId, user);
    const townId = (request as any)[TENANT_ID_KEY];
    const categoryIdArray = categoryIds ? categoryIds.split(',') : undefined;
    return this.documentService.getEntityDocumentStatus(townId, entityType, entityId, categoryIdArray);
  }

  @Get('entity/:entityType/:entityId/check')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Check if entity has all required documents' })
  async hasAllRequiredDocuments(
    @Param('entityType') entityType: DocumentEntityType,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Query('categoryIds') categoryIds: string,
    @Req() request: Request,
    @GetUser() user: User,
  ) {
    await this.ownership.assertCanRead(entityType, entityId, user);
    const townId = (request as any)[TENANT_ID_KEY];
    const categoryIdArray = categoryIds ? categoryIds.split(',') : undefined;
    return this.documentService.hasAllRequiredDocuments(townId, entityType, entityId, categoryIdArray);
  }

  @Get(':id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a document by ID' })
  @ApiOkResponse({ type: DocumentResponseDto })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User) {
    const document = await this.documentService.findOne(id);
    await this.ownership.assertCanRead(document.entityType, document.entityId, user);
    return this.documentService.withSignedUrl(document);
  }

  @Patch(':id/status')
  @SuperAdmin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update document status (approve/reject)' })
  @ApiOkResponse({ type: DocumentResponseDto })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateDocumentStatusDto,
    @GetUser() user: User,
  ) {
    return this.documentService.updateStatus(id, updateDto, user.id);
  }

  @Delete(':id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a document' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User) {
    const document = await this.documentService.findOne(id);
    await this.ownership.assertCanManage(document.entityType, document.entityId, user);
    return this.documentService.remove(id);
  }
}
