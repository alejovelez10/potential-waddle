import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, In } from 'typeorm';
import { Document, DocumentType, TownDocumentRequirement, CategoryDocumentExclusion } from '../entities';
import { CreateDocumentDto, UpdateDocumentStatusDto, EntityDocumentStatusDto } from '../dto';
import { DocumentEntityType, DocumentStatus } from '../enums';
import { GcpStorageService } from './gcp-storage.service';
import { Town } from '../../towns/entities/town.entity';

@Injectable()
export class DocumentService {
  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    @InjectRepository(DocumentType)
    private readonly documentTypeRepository: Repository<DocumentType>,
    @InjectRepository(TownDocumentRequirement)
    private readonly requirementRepository: Repository<TownDocumentRequirement>,
    @InjectRepository(Town)
    private readonly townRepository: Repository<Town>,
    @InjectRepository(CategoryDocumentExclusion)
    private readonly exclusionRepository: Repository<CategoryDocumentExclusion>,
    private readonly gcpStorageService: GcpStorageService,
  ) {}

  async uploadDocument(
    createDto: CreateDocumentDto,
    file: Express.Multer.File,
    uploadedById: string,
    townId: string,
  ): Promise<Document> {
    const documentType = await this.documentTypeRepository.findOne({
      where: { id: createDto.documentTypeId },
    });

    if (!documentType) {
      throw new NotFoundException(`Document type with ID ${createDto.documentTypeId} not found`);
    }

    // Validate expiration date if required
    if (documentType.hasExpiration && !createDto.expirationDate) {
      throw new BadRequestException('Expiration date is required for this document type');
    }

    // Get town for folder structure
    const town = await this.townRepository.findOne({ where: { id: townId } });
    if (!town) {
      throw new NotFoundException(`Town with ID ${townId} not found`);
    }

    // Check if document already exists for this entity and type
    const existingDocument = await this.documentRepository.findOne({
      where: {
        documentTypeId: createDto.documentTypeId,
        entityType: createDto.entityType,
        entityId: createDto.entityId,
      },
    });

    // If exists, delete the old file from GCP
    if (existingDocument) {
      try {
        await this.gcpStorageService.deleteFile(existingDocument.gcpPath);
      } catch (error) {
        console.error('Error deleting old file:', error);
      }
      await this.documentRepository.remove(existingDocument);
    }

    // Upload to GCP
    const uploadResult = await this.gcpStorageService.uploadFile({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      townSlug: town.slug,
      entityType: createDto.entityType,
      entityId: createDto.entityId,
      isPrivate: true,
    });

    // Create document record
    const document = this.documentRepository.create({
      documentTypeId: createDto.documentTypeId,
      entityType: createDto.entityType,
      entityId: createDto.entityId,
      fileName: uploadResult.fileName,
      url: uploadResult.publicUrl,
      gcpPath: uploadResult.gcpPath,
      mimeType: file.mimetype,
      size: uploadResult.size,
      expirationDate: createDto.expirationDate ? new Date(createDto.expirationDate) : null,
      status: DocumentStatus.PENDING,
      uploadedById,
    });

    return this.documentRepository.save(document);
  }

  /**
   * Copy of the document whose `url` is a short-lived signed URL (identity/legal documents must
   * never be exposed through their raw bucket URL). Falls back to the stored URL if signing fails.
   */
  async withSignedUrl(document: Document): Promise<Document> {
    const signedUrl = document.gcpPath ? await this.gcpStorageService.getSignedReadUrl(document.gcpPath) : null;
    return { ...document, url: signedUrl ?? document.url };
  }

  async findByEntity(entityType: DocumentEntityType, entityId: string): Promise<Document[]> {
    return this.documentRepository.find({
      where: { entityType, entityId },
      relations: ['documentType', 'uploadedBy'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Document> {
    const document = await this.documentRepository.findOne({
      where: { id },
      relations: ['documentType', 'uploadedBy', 'reviewedBy'],
    });

    if (!document) {
      throw new NotFoundException(`Document with ID ${id} not found`);
    }

    return document;
  }

  async updateStatus(id: string, updateDto: UpdateDocumentStatusDto, reviewedById: string): Promise<Document> {
    const document = await this.findOne(id);

    document.status = updateDto.status;
    document.rejectionReason = updateDto.rejectionReason || null;
    document.reviewedById = reviewedById;
    document.reviewedAt = new Date();

    return this.documentRepository.save(document);
  }

  async remove(id: string): Promise<void> {
    const document = await this.findOne(id);

    // Delete from GCP
    try {
      await this.gcpStorageService.deleteFile(document.gcpPath);
    } catch (error) {
      console.error('Error deleting file from GCP:', error);
    }

    await this.documentRepository.remove(document);
  }

  // Get document status for an entity with all required documents
  async getEntityDocumentStatus(
    townId: string,
    entityType: DocumentEntityType,
    entityId: string,
    categoryIds?: string[],
  ): Promise<EntityDocumentStatusDto[]> {
    // Get requirements for this town and entity type
    const requirements = await this.requirementRepository.find({
      where: { townId, entityType },
      relations: ['documentType'],
    });

    // Get excluded document type IDs for the entity's categories
    // A document is only excluded if ALL categories exclude it
    const excludedDocumentTypeIds: string[] = [];
    if (categoryIds && categoryIds.length > 0) {
      const exclusions = await this.exclusionRepository.find({
        where: { category: { id: In(categoryIds) } },
        relations: ['documentType', 'category'],
      });

      // Count how many categories exclude each document type
      const exclusionCounts = new Map<string, number>();
      exclusions.forEach(e => {
        const count = exclusionCounts.get(e.documentType.id) || 0;
        exclusionCounts.set(e.documentType.id, count + 1);
      });

      // Only exclude if ALL categories exclude it
      exclusionCounts.forEach((count, documentTypeId) => {
        if (count === categoryIds.length) {
          excludedDocumentTypeIds.push(documentTypeId);
        }
      });
    }

    // Filter out excluded document types
    const filteredRequirements = requirements.filter(req => !excludedDocumentTypeIds.includes(req.documentTypeId));

    // Get existing documents for this entity
    const documents = await this.findByEntity(entityType, entityId);
    const documentMap = new Map(documents.map(d => [d.documentTypeId, d]));

    const now = new Date();
    const signedUrls = new Map(
      await Promise.all(documents.map(async d => [d.id, (await this.withSignedUrl(d)).url] as const)),
    );

    return filteredRequirements.map(req => {
      const document = documentMap.get(req.documentTypeId);
      const isExpired = document?.expirationDate ? new Date(document.expirationDate) < now : false;
      const isUploaded = !!document;
      const needsAttention =
        (req.isRequired && !isUploaded) || isExpired || document?.status === DocumentStatus.REJECTED;

      return {
        documentType: {
          id: req.documentType.id,
          name: req.documentType.name,
          description: req.documentType.description,
          category: req.documentType.category,
          hasExpiration: req.documentType.hasExpiration,
        },
        isRequired: req.isRequired,
        document: document
          ? {
              id: document.id,
              documentTypeId: document.documentTypeId,
              entityType: document.entityType,
              entityId: document.entityId,
              fileName: document.fileName,
              url: signedUrls.get(document.id) ?? document.url,
              mimeType: document.mimeType,
              size: document.size,
              expirationDate: document.expirationDate,
              status: document.status,
              rejectionReason: document.rejectionReason,
              uploadedById: document.uploadedById,
              createdAt: document.createdAt,
            }
          : null,
        isUploaded,
        isExpired,
        needsAttention,
      };
    });
  }

  // Check if entity has all required documents
  async hasAllRequiredDocuments(
    townId: string,
    entityType: DocumentEntityType,
    entityId: string,
    categoryIds?: string[],
  ): Promise<{ complete: boolean; missing: string[]; expired: string[] }> {
    const status = await this.getEntityDocumentStatus(townId, entityType, entityId, categoryIds);

    const missing = status.filter(s => s.isRequired && !s.isUploaded).map(s => s.documentType.name);

    const expired = status.filter(s => s.isExpired).map(s => s.documentType.name);

    return {
      complete: missing.length === 0 && expired.length === 0,
      missing,
      expired,
    };
  }

  // Cron job: Mark expired documents
  async markExpiredDocuments(): Promise<number> {
    const now = new Date();
    const result = await this.documentRepository.update(
      {
        expirationDate: LessThan(now),
        status: DocumentStatus.APPROVED,
      },
      { status: DocumentStatus.EXPIRED },
    );

    return result.affected || 0;
  }
}
