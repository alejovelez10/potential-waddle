import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DocumentType, TownDocumentRequirement, Document, CategoryDocumentExclusion } from './entities';
import {
  GcpStorageService,
  DocumentTypeService,
  TownDocumentRequirementService,
  DocumentService,
  CategoryDocumentExclusionService,
} from './services';
import {
  DocumentTypeController,
  TownDocumentRequirementController,
  DocumentController,
  CategoryDocumentExclusionController,
} from './controllers';
import { Town } from '../towns/entities/town.entity';
import { Category } from '../core/entities/category.entity';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    CommonModule,
    TypeOrmModule.forFeature([
      DocumentType,
      TownDocumentRequirement,
      Document,
      CategoryDocumentExclusion,
      Town,
      Category,
    ]),
  ],
  controllers: [
    DocumentTypeController,
    TownDocumentRequirementController,
    DocumentController,
    CategoryDocumentExclusionController,
  ],
  providers: [
    GcpStorageService,
    DocumentTypeService,
    TownDocumentRequirementService,
    DocumentService,
    CategoryDocumentExclusionService,
  ],
  exports: [DocumentService, TownDocumentRequirementService, GcpStorageService, CategoryDocumentExclusionService],
})
export class DocumentsModule {}
