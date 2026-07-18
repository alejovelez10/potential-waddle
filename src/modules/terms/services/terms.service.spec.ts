import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, QueryFailedError } from 'typeorm';

import { User } from 'src/modules/users/entities';
import { CloudinaryService } from 'src/modules/cloudinary/cloudinary.service';
import { TranslationResolverService } from 'src/modules/translations/translation-resolver.service';

import { TermsService } from './terms.service';
import { TermsDocument, TermsAcceptance } from '../entities';
import { TermsTypeEnum, TermsFormatEnum, TermsContextEnum } from '../interfaces';

describe('TermsService', () => {
  let service: TermsService;

  // Mocked repositories
  const docsRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
  };
  const acceptsRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  // Mocked TranslationResolverService (quick 260718-ka1) — real implementation exercised in
  // translation-resolver.service.spec.ts; here we only assert TermsService wiring/guards.
  const translationResolver = {
    load: jest.fn(),
    overlay: jest.fn(),
  };

  const USER_ID = '00000000-0000-0000-0000-000000000001';
  const DOC_ID = '00000000-0000-0000-0000-000000000100';
  const ACCEPTANCE_ID = '00000000-0000-0000-0000-000000000200';
  const user = { id: USER_ID } as User;

  const buildActiveDoc = (type: TermsTypeEnum, id: string): TermsDocument =>
    ({
      id,
      type,
      format: TermsFormatEnum.Markdown,
      content: `# ${type}`,
      fileUrl: null,
      isActive: true,
      createdBy: null,
      creator: null,
      createdAt: new Date('2026-04-24T00:00:00Z'),
      updatedAt: new Date('2026-04-24T00:00:00Z'),
    }) as TermsDocument;

  beforeEach(async () => {
    jest.clearAllMocks();
    // reset to fresh jest.fn refs on each
    docsRepo.findOne = jest.fn();
    docsRepo.find = jest.fn();
    acceptsRepo.findOne = jest.fn();
    acceptsRepo.find = jest.fn();
    acceptsRepo.create = jest.fn();
    acceptsRepo.save = jest.fn();
    translationResolver.load = jest.fn();
    translationResolver.overlay = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TermsService,
        { provide: getRepositoryToken(TermsDocument), useValue: docsRepo },
        { provide: getRepositoryToken(TermsAcceptance), useValue: acceptsRepo },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
        { provide: CloudinaryService, useValue: { uploadRawFile: jest.fn() } },
        { provide: TranslationResolverService, useValue: translationResolver },
      ],
    }).compile();

    service = module.get<TermsService>(TermsService);
  });

  // * ----------------------------------------------------------------------------------------------------------------
  // * findActive
  // * ----------------------------------------------------------------------------------------------------------------
  describe('findActive', () => {
    it('returns a DTO when an active doc exists for the requested type', async () => {
      const doc = buildActiveDoc(TermsTypeEnum.User, DOC_ID);
      docsRepo.findOne.mockResolvedValueOnce(doc);

      const result = await service.findActive(TermsTypeEnum.User);

      expect(docsRepo.findOne).toHaveBeenCalledWith({
        where: { type: TermsTypeEnum.User, isActive: true },
      });
      expect(result.id).toBe(DOC_ID);
      expect(result.type).toBe(TermsTypeEnum.User);
      expect(result.format).toBe(TermsFormatEnum.Markdown);
      expect(result.content).toBe('# user');
      expect(result.fileUrl).toBeNull();
      expect(result.updatedAt).toBe('2026-04-24T00:00:00.000Z');
    });

    it('throws NotFoundException when no active doc exists for the type', async () => {
      docsRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.findActive(TermsTypeEnum.Lodging)).rejects.toBeInstanceOf(NotFoundException);
    });

    // * ------------------------------------------------------------------------------------------------------------
    // * locale overlay (quick 260718-ka1, T-ka1-01)
    // * ------------------------------------------------------------------------------------------------------------
    it("does NOT call translationResolver when locale='es' (guard, no cache/behavior regression)", async () => {
      const doc = buildActiveDoc(TermsTypeEnum.User, DOC_ID);
      docsRepo.findOne.mockResolvedValueOnce(doc);

      const result = await service.findActive(TermsTypeEnum.User, 'es');

      expect(translationResolver.load).not.toHaveBeenCalled();
      expect(translationResolver.overlay).not.toHaveBeenCalled();
      expect(result.id).toBe(DOC_ID);
      expect(result.content).toBe('# user');
    });

    it("overlays content via translationResolver when locale='en' and format=markdown, WITHOUT changing id/isActive", async () => {
      const doc = buildActiveDoc(TermsTypeEnum.User, DOC_ID);
      docsRepo.findOne.mockResolvedValueOnce(doc);
      translationResolver.load.mockResolvedValueOnce({ content: '# English content' });
      translationResolver.overlay.mockImplementationOnce((dto, translations) => ({ ...dto, ...translations }));

      const result = await service.findActive(TermsTypeEnum.User, 'en');

      expect(translationResolver.load).toHaveBeenCalledWith('termsDocument', DOC_ID, 'en');
      expect(result.id).toBe(DOC_ID); // id preserved — no re-acceptance risk
      expect(result.content).toBe('# English content');
    });

    it("does NOT overlay when format=pdf, even for locale='en' (D-3, out of scope)", async () => {
      const pdfDoc = {
        ...buildActiveDoc(TermsTypeEnum.User, DOC_ID),
        format: TermsFormatEnum.Pdf,
        content: null,
        fileUrl: 'https://cdn.example.com/terms.pdf',
      };
      docsRepo.findOne.mockResolvedValueOnce(pdfDoc);

      const result = await service.findActive(TermsTypeEnum.User, 'en');

      expect(translationResolver.load).not.toHaveBeenCalled();
      expect(translationResolver.overlay).not.toHaveBeenCalled();
      expect(result.content).toBeNull();
      expect(result.fileUrl).toBe('https://cdn.example.com/terms.pdf');
    });
  });

  // * ----------------------------------------------------------------------------------------------------------------
  // * accept — error paths
  // * ----------------------------------------------------------------------------------------------------------------
  describe('accept', () => {
    it('throws NotFoundException when the document does not exist', async () => {
      docsRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.accept({
          termsId: DOC_ID,
          user,
          context: TermsContextEnum.UserLoginCheck,
          ip: '127.0.0.1',
          userAgent: 'jest-ua',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(acceptsRepo.save).not.toHaveBeenCalled();
    });

    it("throws BadRequestException('TERMS_NOT_ACTIVE') when doc.isActive === false (T-1-03)", async () => {
      const staleDoc = { ...buildActiveDoc(TermsTypeEnum.User, DOC_ID), isActive: false };
      docsRepo.findOne.mockResolvedValueOnce(staleDoc);

      await expect(
        service.accept({
          termsId: DOC_ID,
          user,
          context: TermsContextEnum.UserLoginCheck,
          ip: '127.0.0.1',
          userAgent: 'jest-ua',
        }),
      ).rejects.toMatchObject({
        message: 'TERMS_NOT_ACTIVE',
      });
      expect(acceptsRepo.save).not.toHaveBeenCalled();
    });

    // * --------------------------------------------------------------------------------------------------------------
    // * accept — idempotency and race handling (T-1-02)
    // * --------------------------------------------------------------------------------------------------------------
    it('returns existing acceptance without calling save (idempotent)', async () => {
      const doc = buildActiveDoc(TermsTypeEnum.User, DOC_ID);
      const existing = {
        id: ACCEPTANCE_ID,
        userId: USER_ID,
        termsDocumentId: DOC_ID,
        acceptedAt: new Date('2026-04-24T00:00:00Z'),
      } as TermsAcceptance;

      docsRepo.findOne.mockResolvedValueOnce(doc);
      acceptsRepo.findOne.mockResolvedValueOnce(existing);

      const result = await service.accept({
        termsId: DOC_ID,
        user,
        context: TermsContextEnum.UserLoginCheck,
        ip: '127.0.0.1',
        userAgent: 'jest-ua',
      });

      expect(result).toEqual({ id: ACCEPTANCE_ID, acceptedAt: '2026-04-24T00:00:00.000Z' });
      expect(acceptsRepo.save).not.toHaveBeenCalled();
    });

    it('creates and saves a new acceptance when none exists', async () => {
      const doc = buildActiveDoc(TermsTypeEnum.User, DOC_ID);
      const newRow = {
        userId: USER_ID,
        termsDocumentId: DOC_ID,
        context: TermsContextEnum.UserLoginCheck,
        ipAddress: '127.0.0.1',
        userAgent: 'jest-ua',
      };
      const saved = {
        ...newRow,
        id: ACCEPTANCE_ID,
        acceptedAt: new Date('2026-04-24T00:00:00Z'),
      } as TermsAcceptance;

      docsRepo.findOne.mockResolvedValueOnce(doc);
      acceptsRepo.findOne.mockResolvedValueOnce(null);
      acceptsRepo.create.mockReturnValueOnce(newRow as unknown as TermsAcceptance);
      acceptsRepo.save.mockResolvedValueOnce(saved);

      const result = await service.accept({
        termsId: DOC_ID,
        user,
        context: TermsContextEnum.UserLoginCheck,
        ip: '127.0.0.1',
        userAgent: 'jest-ua',
      });

      expect(acceptsRepo.create).toHaveBeenCalledWith({
        userId: USER_ID,
        termsDocumentId: DOC_ID,
        context: TermsContextEnum.UserLoginCheck,
        ipAddress: '127.0.0.1',
        userAgent: 'jest-ua',
      });
      expect(acceptsRepo.save).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ id: ACCEPTANCE_ID, acceptedAt: '2026-04-24T00:00:00.000Z' });
    });

    it('re-reads the existing row on 23505 unique violation (T-1-02 race handling)', async () => {
      const doc = buildActiveDoc(TermsTypeEnum.User, DOC_ID);
      const existingAfterRace = {
        id: ACCEPTANCE_ID,
        userId: USER_ID,
        termsDocumentId: DOC_ID,
        acceptedAt: new Date('2026-04-24T00:00:00Z'),
      } as TermsAcceptance;

      docsRepo.findOne.mockResolvedValueOnce(doc);
      // First findOne: no existing (race); second findOne (after 23505 catch): found
      acceptsRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(existingAfterRace);
      acceptsRepo.create.mockReturnValueOnce({} as TermsAcceptance);

      const dupError = Object.assign(new QueryFailedError('INSERT', [], new Error('dup') as Error), {
        code: '23505',
      });
      acceptsRepo.save.mockRejectedValueOnce(dupError);

      const result = await service.accept({
        termsId: DOC_ID,
        user,
        context: TermsContextEnum.UserLoginCheck,
        ip: '127.0.0.1',
        userAgent: 'jest-ua',
      });

      expect(result).toEqual({ id: ACCEPTANCE_ID, acceptedAt: '2026-04-24T00:00:00.000Z' });
      expect(acceptsRepo.findOne).toHaveBeenCalledTimes(2);
    });
  });

  // * ----------------------------------------------------------------------------------------------------------------
  // * getStatusForUser
  // * ----------------------------------------------------------------------------------------------------------------
  describe('getStatusForUser', () => {
    it('returns 6 booleans + activeDocumentIds with hasAcceptedUserTerms set from matching acceptance', async () => {
      const userDoc = buildActiveDoc(TermsTypeEnum.User, 'doc-user');
      const lodgingDoc = buildActiveDoc(TermsTypeEnum.Lodging, 'doc-lodging');
      const restaurantDoc = buildActiveDoc(TermsTypeEnum.Restaurant, 'doc-restaurant');
      const commerceDoc = buildActiveDoc(TermsTypeEnum.Commerce, 'doc-commerce');
      const transportDoc = buildActiveDoc(TermsTypeEnum.Transport, 'doc-transport');
      const guideDoc = buildActiveDoc(TermsTypeEnum.Guide, 'doc-guide');

      docsRepo.find.mockResolvedValueOnce([userDoc, lodgingDoc, restaurantDoc, commerceDoc, transportDoc, guideDoc]);

      acceptsRepo.find.mockResolvedValueOnce([{ userId: USER_ID, termsDocumentId: 'doc-user' } as TermsAcceptance]);

      const status = await service.getStatusForUser(USER_ID);

      expect(status.hasAcceptedUserTerms).toBe(true);
      expect(status.hasAcceptedLodgingTerms).toBe(false);
      expect(status.hasAcceptedRestaurantTerms).toBe(false);
      expect(status.hasAcceptedCommerceTerms).toBe(false);
      expect(status.hasAcceptedTransportTerms).toBe(false);
      expect(status.hasAcceptedGuideTerms).toBe(false);
      expect(status.activeDocumentIds).toEqual({
        user: 'doc-user',
        lodging: 'doc-lodging',
        restaurant: 'doc-restaurant',
        commerce: 'doc-commerce',
        transport: 'doc-transport',
        guide: 'doc-guide',
      });
    });

    it('sets activeDocumentIds[type]=null and corresponding boolean=false when a type has no active doc', async () => {
      // Only user has an active doc; others null
      docsRepo.find.mockResolvedValueOnce([buildActiveDoc(TermsTypeEnum.User, 'doc-user')]);
      acceptsRepo.find.mockResolvedValueOnce([]);

      const status = await service.getStatusForUser(USER_ID);

      expect(status.activeDocumentIds.user).toBe('doc-user');
      expect(status.activeDocumentIds.lodging).toBeNull();
      expect(status.activeDocumentIds.restaurant).toBeNull();
      expect(status.activeDocumentIds.commerce).toBeNull();
      expect(status.activeDocumentIds.transport).toBeNull();
      expect(status.activeDocumentIds.guide).toBeNull();
      expect(status.hasAcceptedUserTerms).toBe(false);
      expect(status.hasAcceptedLodgingTerms).toBe(false);
    });
  });
});
