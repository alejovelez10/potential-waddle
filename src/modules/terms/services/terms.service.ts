import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';

import { User } from 'src/modules/users/entities';
import { CloudinaryService } from 'src/modules/cloudinary/cloudinary.service';
import { CLOUDINARY_FOLDERS } from 'src/config/cloudinary-folders';
import { TranslationResolverService } from 'src/modules/translations/translation-resolver.service';

import { TermsDocument, TermsAcceptance } from '../entities';
import { TermsTypeEnum, TermsContextEnum, TermsFormatEnum } from '../interfaces';
import {
  TermsDocumentDto,
  TermsStatusDto,
  TermsActiveIdsDto,
  AdminTermsDocumentDto,
  AdminTermsListDto,
  AdminAcceptancesListDto,
} from '../dto';
import { isTermsEnforcementEnabled } from '../utils';

interface AcceptInput {
  termsId: string;
  user: User;
  context: TermsContextEnum;
  ip: string;
  userAgent: string | undefined;
}

@Injectable()
export class TermsService {
  constructor(
    @InjectRepository(TermsDocument)
    private readonly docsRepo: Repository<TermsDocument>,
    @InjectRepository(TermsAcceptance)
    private readonly acceptsRepo: Repository<TermsAcceptance>,
    private readonly dataSource: DataSource,
    private readonly cloudinaryService: CloudinaryService,
    private readonly translationResolver: TranslationResolverService,
  ) {}

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ACTIVE TERMS DOCUMENT FOR A TYPE
  // * ----------------------------------------------------------------------------------------------------------------
  /**
   * `locale` defaults to 'es' (canonical, never overlaid). For any other supported locale,
   * when the active doc is markdown, overlay the AI-translated `content` from entity_translation
   * (quick 260718-ka1). The document's `id`/`isActive` are NEVER touched here — acceptances
   * point to `id`, so overlaying content must not force re-acceptance (T-ka1-01).
   * PDF docs have `content=null` and are skipped (D-3, out of scope).
   */
  async findActive(type: TermsTypeEnum, locale: string = 'es'): Promise<TermsDocumentDto> {
    const doc = await this.docsRepo.findOne({ where: { type, isActive: true } });
    if (!doc) throw new NotFoundException(`No active terms document for type '${type}'`);

    const dto = new TermsDocumentDto(doc);
    if (locale !== 'es' && doc.format === TermsFormatEnum.Markdown) {
      const translations = await this.translationResolver.load('termsDocument', doc.id, locale);
      return this.translationResolver.overlay({ ...dto }, translations);
    }
    return dto;
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * RECORD ACCEPTANCE (IDEMPOTENT)
  // * ----------------------------------------------------------------------------------------------------------------
  async accept({ termsId, user, context, ip, userAgent }: AcceptInput): Promise<{ id: string; acceptedAt: string }> {
    const doc = await this.docsRepo.findOne({ where: { id: termsId } });
    if (!doc) throw new NotFoundException(`Terms document ${termsId} not found`);
    if (!doc.isActive) throw new BadRequestException('TERMS_NOT_ACTIVE');

    // Idempotent short-circuit: if an acceptance already exists, return it
    const existing = await this.acceptsRepo.findOne({
      where: { userId: user.id, termsDocumentId: termsId },
    });
    if (existing) {
      return { id: existing.id, acceptedAt: existing.acceptedAt.toISOString() };
    }

    try {
      const row = this.acceptsRepo.create({
        userId: user.id,
        termsDocumentId: termsId,
        context,
        ipAddress: ip,
        userAgent: userAgent ?? null,
      });
      const saved = await this.acceptsRepo.save(row);
      return { id: saved.id, acceptedAt: saved.acceptedAt.toISOString() };
    } catch (err) {
      // Handle race: unique violation on (user_id, terms_document_id) → re-read existing row
      if (err instanceof QueryFailedError && (err as unknown as { code?: string }).code === '23505') {
        const existingAfterRace = await this.acceptsRepo.findOne({
          where: { userId: user.id, termsDocumentId: termsId },
        });
        if (existingAfterRace) {
          return { id: existingAfterRace.id, acceptedAt: existingAfterRace.acceptedAt.toISOString() };
        }
      }
      throw err;
    }
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET STATUS FOR A USER (6 BOOLEANS + ACTIVE IDS)
  // * ----------------------------------------------------------------------------------------------------------------
  async getStatusForUser(userId: string): Promise<TermsStatusDto> {
    // Feature flag short-circuit: when enforcement is off, return all-true so the
    // frontend (PostLoginTermsGate, BusinessTermsAcceptance, UserTermsSection)
    // doesn't gate any UI. activeDocumentIds still reflects DB state so admins
    // can keep prepping content.
    if (!isTermsEnforcementEnabled()) {
      const actives = await this.docsRepo.find({ where: { isActive: true } });
      const activeIds: TermsActiveIdsDto = {
        user: null,
        lodging: null,
        restaurant: null,
        commerce: null,
        transport: null,
        guide: null,
      };
      for (const doc of actives) {
        activeIds[doc.type] = doc.id;
      }
      const dto = new TermsStatusDto();
      dto.hasAcceptedUserTerms = true;
      dto.hasAcceptedLodgingTerms = true;
      dto.hasAcceptedRestaurantTerms = true;
      dto.hasAcceptedCommerceTerms = true;
      dto.hasAcceptedTransportTerms = true;
      dto.hasAcceptedGuideTerms = true;
      dto.activeDocumentIds = activeIds;
      return dto;
    }

    const actives = await this.docsRepo.find({ where: { isActive: true } });

    const activeIds: TermsActiveIdsDto = {
      user: null,
      lodging: null,
      restaurant: null,
      commerce: null,
      transport: null,
      guide: null,
    };
    for (const doc of actives) {
      activeIds[doc.type] = doc.id;
    }

    const nonNullIds = (Object.values(activeIds) as (string | null)[]).filter((v): v is string => v !== null);
    const accepted = nonNullIds.length
      ? await this.acceptsRepo.find({
          where: { userId, termsDocumentId: In(nonNullIds) },
        })
      : [];
    const acceptedSet = new Set(accepted.map(a => a.termsDocumentId));

    const has = (t: TermsTypeEnum): boolean => {
      const id = activeIds[t];
      return id !== null && acceptedSet.has(id);
    };

    const dto = new TermsStatusDto();
    dto.hasAcceptedUserTerms = has(TermsTypeEnum.User);
    dto.hasAcceptedLodgingTerms = has(TermsTypeEnum.Lodging);
    dto.hasAcceptedRestaurantTerms = has(TermsTypeEnum.Restaurant);
    dto.hasAcceptedCommerceTerms = has(TermsTypeEnum.Commerce);
    dto.hasAcceptedTransportTerms = has(TermsTypeEnum.Transport);
    dto.hasAcceptedGuideTerms = has(TermsTypeEnum.Guide);
    dto.activeDocumentIds = activeIds;
    return dto;
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * BATCH: WHICH OWNERS HAVE ACCEPTED THE ACTIVE DOC OF A TYPE?
  // * ----------------------------------------------------------------------------------------------------------------
  /**
   * Returns the set of user ids (from `ownerIds`) that have an acceptance row
   * pointing to the currently-active document of the given type. Used by admin
   * listing endpoints to render a per-row "T&C ✓" indicator without N+1 queries.
   *
   * Returns an empty Set when:
   *  - `ownerIds` is empty
   *  - There is no active document for `type` (admin hasn't seeded it)
   */
  async getOwnersWithAcceptance(type: TermsTypeEnum, ownerIds: string[]): Promise<Set<string>> {
    if (ownerIds.length === 0) return new Set();

    const activeDoc = await this.docsRepo.findOne({ where: { type, isActive: true } });
    if (!activeDoc) return new Set();

    const rows = await this.acceptsRepo.find({
      where: { termsDocumentId: activeDoc.id, userId: In(ownerIds) },
      select: ['userId'],
    });
    return new Set(rows.map(r => r.userId));
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * ADMIN — LIST ALL DOCUMENTS WITH ACCEPTANCE COUNTS
  // * ----------------------------------------------------------------------------------------------------------------
  async adminFindAll(): Promise<AdminTermsListDto> {
    const docs = await this.docsRepo.find({
      relations: { creator: true },
      order: { type: 'ASC', isActive: 'DESC', createdAt: 'DESC' },
    });

    if (docs.length === 0) {
      return new AdminTermsListDto([]);
    }

    // Single batch query for acceptance counts grouped by document id
    const counts = await this.acceptsRepo
      .createQueryBuilder('a')
      .select('a.terms_document_id', 'docId')
      .addSelect('COUNT(*)', 'count')
      .where('a.terms_document_id IN (:...ids)', { ids: docs.map(d => d.id) })
      .groupBy('a.terms_document_id')
      .getRawMany<{ docId: string; count: string }>();

    const countMap = new Map<string, number>();
    for (const row of counts) {
      countMap.set(row.docId, parseInt(row.count, 10));
    }

    return new AdminTermsListDto(docs.map(doc => new AdminTermsDocumentDto(doc, countMap.get(doc.id) ?? 0)));
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * ADMIN — CREATE A NEW DOCUMENT (markdown JSON or PDF multipart)
  // * ----------------------------------------------------------------------------------------------------------------
  async adminCreate(input: {
    type: TermsTypeEnum;
    format: TermsFormatEnum;
    content?: string;
    file?: Express.Multer.File;
    creator: User;
  }): Promise<AdminTermsDocumentDto> {
    const { type, format, content, file, creator } = input;

    if (format === TermsFormatEnum.Markdown) {
      if (!content || !content.trim()) {
        throw new BadRequestException('content is required when format=markdown');
      }
      const doc = this.docsRepo.create({
        type,
        format,
        content,
        fileUrl: null,
        isActive: false,
        creator,
        createdBy: creator.id,
      });
      const saved = await this.docsRepo.save(doc);
      const reloaded = await this.docsRepo.findOne({ where: { id: saved.id }, relations: { creator: true } });
      return new AdminTermsDocumentDto(reloaded!, 0);
    }

    // PDF branch — multipart upload
    if (!file) {
      throw new BadRequestException('file is required when format=pdf');
    }
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException(`Invalid mimetype "${file.mimetype}" — only application/pdf is allowed`);
    }
    const MAX_PDF_SIZE = 5 * 1024 * 1024; // 5 MB per BACKEND-SPEC §Security
    if (file.size > MAX_PDF_SIZE) {
      throw new BadRequestException(`PDF exceeds 5MB limit (received ${Math.round(file.size / 1024)} KB)`);
    }

    const uploaded = await this.cloudinaryService.uploadRawFile({
      file,
      folder: CLOUDINARY_FOLDERS.TERMS_PDF,
      fileName: `terms-${type}-${Date.now()}`,
    });
    if (!uploaded) {
      throw new BadRequestException('PDF upload failed');
    }

    const doc = this.docsRepo.create({
      type,
      format: TermsFormatEnum.Pdf,
      content: null,
      fileUrl: uploaded.url,
      isActive: false,
      creator,
      createdBy: creator.id,
    });
    const saved = await this.docsRepo.save(doc);
    const reloaded = await this.docsRepo.findOne({ where: { id: saved.id }, relations: { creator: true } });
    return new AdminTermsDocumentDto(reloaded!, 0);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * ADMIN — UPDATE A DOCUMENT (markdown JSON or PDF multipart replace)
  // * ----------------------------------------------------------------------------------------------------------------
  async adminUpdate(
    id: string,
    input: { content?: string; format?: TermsFormatEnum; file?: Express.Multer.File },
  ): Promise<AdminTermsDocumentDto> {
    const doc = await this.docsRepo.findOne({ where: { id }, relations: { creator: true } });
    if (!doc) throw new NotFoundException(`Terms document ${id} not found`);

    if (input.file) {
      if (input.file.mimetype !== 'application/pdf') {
        throw new BadRequestException(`Invalid mimetype "${input.file.mimetype}" — only application/pdf is allowed`);
      }
      const MAX_PDF_SIZE = 5 * 1024 * 1024;
      if (input.file.size > MAX_PDF_SIZE) {
        throw new BadRequestException(`PDF exceeds 5MB limit`);
      }
      const uploaded = await this.cloudinaryService.uploadRawFile({
        file: input.file,
        folder: CLOUDINARY_FOLDERS.TERMS_PDF,
        fileName: `terms-${doc.type}-${Date.now()}`,
      });
      if (!uploaded) throw new BadRequestException('PDF upload failed');
      doc.format = TermsFormatEnum.Pdf;
      doc.fileUrl = uploaded.url;
      doc.content = null;
    } else if (input.content !== undefined) {
      // Switching to markdown or updating existing markdown body
      doc.format = TermsFormatEnum.Markdown;
      doc.content = input.content;
      doc.fileUrl = null;
    }

    const saved = await this.docsRepo.save(doc);
    const count = await this.acceptsRepo.count({ where: { termsDocumentId: saved.id } });
    return new AdminTermsDocumentDto(saved, count);
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * ADMIN — ACTIVATE A DOCUMENT (atomic deactivate-previous + activate-this)
  // * ----------------------------------------------------------------------------------------------------------------
  async adminActivate(id: string): Promise<{ success: true; deactivatedPreviousId: string | null }> {
    return this.dataSource.transaction(async manager => {
      const docsRepo = manager.getRepository(TermsDocument);
      const target = await docsRepo.findOne({ where: { id } });
      if (!target) throw new NotFoundException(`Terms document ${id} not found`);

      if (target.isActive) {
        return { success: true as const, deactivatedPreviousId: null };
      }

      const previous = await docsRepo.findOne({ where: { type: target.type, isActive: true } });
      if (previous) {
        previous.isActive = false;
        await docsRepo.save(previous);
      }
      target.isActive = true;
      await docsRepo.save(target);

      return { success: true as const, deactivatedPreviousId: previous?.id ?? null };
    });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * ADMIN — DELETE A DOCUMENT (rejects if active OR has acceptances)
  // * ----------------------------------------------------------------------------------------------------------------
  async adminDelete(id: string): Promise<void> {
    const doc = await this.docsRepo.findOne({ where: { id } });
    if (!doc) throw new NotFoundException(`Terms document ${id} not found`);
    if (doc.isActive) {
      throw new ConflictException('Cannot delete the active T&C document — deactivate it first');
    }
    const count = await this.acceptsRepo.count({ where: { termsDocumentId: id } });
    if (count > 0) {
      throw new ConflictException('Cannot delete a T&C document with acceptance records');
    }
    await this.docsRepo.delete({ id });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * ADMIN — PAGINATED ACCEPTANCES FOR A DOCUMENT
  // * ----------------------------------------------------------------------------------------------------------------
  async adminGetAcceptances(docId: string, page = 1, pageSize = 50): Promise<AdminAcceptancesListDto> {
    const docExists = await this.docsRepo.exist({ where: { id: docId } });
    if (!docExists) throw new NotFoundException(`Terms document ${docId} not found`);

    const skip = (page - 1) * pageSize;
    const [rows, total] = await this.acceptsRepo.findAndCount({
      where: { termsDocumentId: docId },
      relations: { user: true },
      order: { acceptedAt: 'DESC' },
      skip,
      take: pageSize,
    });

    return new AdminAcceptancesListDto(rows, { total, page, pageSize });
  }
}
