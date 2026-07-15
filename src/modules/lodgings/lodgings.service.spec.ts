import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { LodgingsService } from './lodgings.service';
import { Lodging, LodgingImage, LodgingPlace, LodgingRoomType } from './entities';
import { Category, Facility } from '../core/entities';
import { User } from '../users/entities';
import { Town } from '../towns/entities';
import { Place } from '../places/entities';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { GooglePlacesService } from '../google-places/google-places.service';
import { PromotionsService } from '../promotions/promotions.service';
import { EntityReviewsService } from '../reviews/services/entity-reviews.service';
import { TermsService } from '../terms/services';
import { DocumentService } from '../documents/services';
import { ResendService } from '../email/services/resend.service';
import { SubscriptionsService } from '../subscriptions/services';
import { TranslationResolverService } from '../translations/translation-resolver.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = '00000000-0000-0000-0000-000000000001';
const LODGING_ID = '00000000-0000-0000-0000-000000000010';
const TERMS_DOC_ID = '00000000-0000-0000-0000-000000000030';

const NOW = new Date('2026-05-13T00:00:00Z');

const mockUser = {
  id: USER_ID,
  email: 'owner@test.com',
  createdAt: NOW,
  updatedAt: NOW,
  name: 'Test Owner',
  hasPassword: true,
  country: null,
  location: null,
  birthDate: null,
  profileImage: null,
  role: null,
  town: null,
} as unknown as User;

function buildFullLodging(overrides: Partial<Lodging> = {}): Lodging {
  return {
    id: LODGING_ID,
    name: 'Test Lodging',
    slug: 'test-lodging',
    status: 'draft',
    submittedAt: null,
    rejectionReason: null,
    isPublic: false,
    stateDB: true,
    description: 'A'.repeat(60),
    points: 0,
    reviewCount: 0,
    rating: 0,
    roomTypes: [],
    amenities: ['WiFi'],
    roomCount: 0,
    lowestPrice: 50000 as any,
    highestPrice: null,
    priceUnit: 'noche',
    address: '123 Main St',
    phoneNumbers: [],
    email: 'contact@lodge.com',
    website: null,
    facebook: null,
    instagram: null,
    whatsappNumbers: ['+573001234567'],
    openingHours: null,
    spokenLanguages: [],
    capacity: null,
    location: { type: 'Point', coordinates: [-75.5, 6.2] } as any,
    googleMapsUrl: null,
    urbanCenterDistance: null,
    howToGetThere: null,
    arrivalReference: null,
    paymentMethods: ['cash'],
    googleMapsRating: null,
    googleMapsId: null,
    googleMapsReviewsCount: null,
    showGoogleMapsReviews: true,
    showBinntuReviews: true,
    googleMapsName: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: mockUser,
    town: { id: 'town-1', department: { id: 'dept-1' } } as any,
    categories: [{ id: 'cat-1', name: 'Hostal', icon: null } as any],
    images: [
      { id: 'img-1', imageResource: { id: 'res-1', url: 'https://x.com/1.jpg' } as any, order: 1 } as any,
      { id: 'img-2', imageResource: { id: 'res-2', url: 'https://x.com/2.jpg' } as any, order: 2 } as any,
      { id: 'img-3', imageResource: { id: 'res-3', url: 'https://x.com/3.jpg' } as any, order: 3 } as any,
    ],
    facilities: [{ id: 'fac-1', name: 'Pool', icon: null } as any],
    reviews: [],
    places: [],
    lodgingRoomTypes: [
      {
        id: 'rt-1',
        name: 'Standard',
        price: 50000 as any,
        maxCapacity: 2,
        images: [],
      } as any,
    ],
    ...overrides,
  } as Lodging;
}

// ---------------------------------------------------------------------------
// Test module setup
// ---------------------------------------------------------------------------

const makeRepo = () => ({
  findOne: jest.fn(),
  findBy: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  delete: jest.fn(),
  update: jest.fn(),
  manager: { transaction: jest.fn(), create: jest.fn(), save: jest.fn() },
  createQueryBuilder: jest.fn(),
});

describe('LodgingsService — submitForReview', () => {
  let service: LodgingsService;
  let lodgingRepo: ReturnType<typeof makeRepo>;
  let termsService: jest.Mocked<Partial<TermsService>>;
  let dataSource: jest.Mocked<Partial<DataSource>>;
  let resendService: jest.Mocked<Partial<ResendService>>;

  beforeEach(async () => {
    jest.clearAllMocks();

    lodgingRepo = makeRepo();
    termsService = {
      getStatusForUser: jest.fn(),
      getOwnersWithAcceptance: jest.fn(),
    };
    dataSource = {
      transaction: jest.fn(),
    };
    resendService = {
      sendLodgingSubmittedEmail: jest.fn().mockResolvedValue(true),
      sendAdminLodgingPendingNotification: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LodgingsService,
        { provide: getRepositoryToken(Lodging), useValue: lodgingRepo },
        { provide: getRepositoryToken(LodgingImage), useValue: makeRepo() },
        { provide: getRepositoryToken(Category), useValue: makeRepo() },
        { provide: getRepositoryToken(User), useValue: makeRepo() },
        { provide: getRepositoryToken(Town), useValue: makeRepo() },
        { provide: getRepositoryToken(Facility), useValue: makeRepo() },
        { provide: getRepositoryToken(Place), useValue: makeRepo() },
        { provide: getRepositoryToken(LodgingPlace), useValue: makeRepo() },
        { provide: getRepositoryToken(LodgingRoomType), useValue: makeRepo() },
        {
          provide: CloudinaryService,
          useValue: { uploadImage: jest.fn(), destroyFile: jest.fn(), destroyFolder: jest.fn() },
        },
        { provide: GooglePlacesService, useValue: { getPlaceDetails: jest.fn() } },
        {
          provide: PromotionsService,
          useValue: {
            hasActivePromotions: jest.fn(),
            getLatestActivePromotion: jest.fn(),
            getActivePromotions: jest.fn(),
          },
        },
        { provide: EntityReviewsService, useValue: { getUserReviews: jest.fn(), findUserReview: jest.fn() } },
        { provide: TermsService, useValue: termsService },
        { provide: DocumentService, useValue: { getEntityDocumentStatus: jest.fn().mockResolvedValue([]) } },
        { provide: DataSource, useValue: dataSource },
        { provide: ResendService, useValue: resendService },
        { provide: SubscriptionsService, useValue: { getActiveSubscribedEntityIds: jest.fn().mockResolvedValue([]) } },
        { provide: TranslationResolverService, useValue: { batchLoad: jest.fn(), load: jest.fn(), overlay: jest.fn((e: any, t: any) => ({ ...e, ...t })) } },
      ],
    }).compile();

    service = module.get<LodgingsService>(LodgingsService);
  });

  // -------------------------------------------------------------------------
  // Test 1: Happy path — draft lodging with full completion + T&C accepted
  // -------------------------------------------------------------------------
  it('happy path: transitions draft → pending_review, sets submittedAt, returns enriched DTO', async () => {
    const lodging = buildFullLodging({ status: 'draft' });
    const updatedLodging = buildFullLodging({ status: 'pending_review', submittedAt: new Date() });

    // First findOne (load for guards), second findOne (reload after save)
    lodgingRepo.findOne.mockResolvedValueOnce(lodging).mockResolvedValueOnce(updatedLodging);
    lodgingRepo.save.mockResolvedValueOnce(updatedLodging);

    // T&C accepted — enforcement on by default in test env (TERMS_ENFORCEMENT_ENABLED not set to 'false')
    (termsService.getStatusForUser as jest.Mock).mockResolvedValueOnce({
      hasAcceptedLodgingTerms: true,
      activeDocumentIds: { lodging: TERMS_DOC_ID },
    });

    const result = await service.submitForReview({ identifier: LODGING_ID, user: mockUser });

    expect(lodgingRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending_review', rejectionReason: null }),
    );
    expect(result.status).toBe('pending_review');
    expect(result.completionPercentage).toBeGreaterThanOrEqual(80);

    // Email dispatchers called fire-and-forget (give void a tick to run)
    await new Promise(r => setImmediate(r));
    expect(resendService.sendLodgingSubmittedEmail).toHaveBeenCalledWith(mockUser.email, lodging.name);
    expect(resendService.sendAdminLodgingPendingNotification).toHaveBeenCalledWith(lodging.name, mockUser.email);
  });

  // -------------------------------------------------------------------------
  // Test 1b: Email send failure does NOT fail submitForReview (fire-and-forget resilience)
  // -------------------------------------------------------------------------
  it('email send failure does not affect submitForReview response', async () => {
    const lodging = buildFullLodging({ status: 'draft' });
    const updatedLodging = buildFullLodging({ status: 'pending_review', submittedAt: new Date() });

    lodgingRepo.findOne.mockResolvedValueOnce(lodging).mockResolvedValueOnce(updatedLodging);
    lodgingRepo.save.mockResolvedValueOnce(updatedLodging);

    (termsService.getStatusForUser as jest.Mock).mockResolvedValueOnce({
      hasAcceptedLodgingTerms: true,
      activeDocumentIds: { lodging: TERMS_DOC_ID },
    });

    // Simulate dispatcher returning false (internal error caught by ResendService)
    (resendService.sendLodgingSubmittedEmail as jest.Mock).mockResolvedValueOnce(false);
    (resendService.sendAdminLodgingPendingNotification as jest.Mock).mockResolvedValueOnce(false);

    const result = await service.submitForReview({ identifier: LODGING_ID, user: mockUser });

    // Service must still succeed despite email failures
    expect(result.status).toBe('pending_review');
  });

  // -------------------------------------------------------------------------
  // Test 2: Non-owner → ForbiddenException
  // -------------------------------------------------------------------------
  it('non-owner throws ForbiddenException', async () => {
    const lodging = buildFullLodging({ user: { id: 'other-user-id' } as User });
    lodgingRepo.findOne.mockResolvedValueOnce(lodging);

    await expect(service.submitForReview({ identifier: LODGING_ID, user: mockUser })).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(lodgingRepo.save).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 3: status='published' → BadRequestException with INVALID_STATUS
  // -------------------------------------------------------------------------
  it("status='published' → BadRequestException with INVALID_STATUS", async () => {
    const lodging = buildFullLodging({ status: 'published' });
    lodgingRepo.findOne.mockResolvedValueOnce(lodging);

    await expect(service.submitForReview({ identifier: LODGING_ID, user: mockUser })).rejects.toMatchObject(
      expect.objectContaining({
        response: expect.objectContaining({ message: 'INVALID_STATUS' }),
      }),
    );

    expect(lodgingRepo.save).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 4: completionPercentage < 80 → BadRequestException with INCOMPLETE payload
  // -------------------------------------------------------------------------
  it('incomplete lodging → BadRequestException with INCOMPLETE errorCode and missingFields', async () => {
    // Strip images so completion drops below 80%
    const lodging = buildFullLodging({
      status: 'draft',
      images: [], // missing images = 0 (critical)
      lowestPrice: null, // also missing price (critical)
      whatsappNumbers: [], // also missing whatsapp (critical)
      lodgingRoomTypes: [], // also missing room types (critical)
      amenities: [],
      facilities: [],
      paymentMethods: [],
      location: null as any,
    });
    lodgingRepo.findOne.mockResolvedValueOnce(lodging);

    await expect(service.submitForReview({ identifier: LODGING_ID, user: mockUser })).rejects.toMatchObject(
      expect.objectContaining({
        response: expect.objectContaining({
          errorCode: 'INCOMPLETE',
          missingFields: expect.arrayContaining(['images', 'lowestPrice', 'whatsappNumbers']),
        }),
      }),
    );

    expect(lodgingRepo.save).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 5: T&C not accepted (enforcement on) → ForbiddenException with TERMS_NOT_ACCEPTED
  // -------------------------------------------------------------------------
  it('T&C not accepted (enforcement on) → ForbiddenException with exact TERMS_NOT_ACCEPTED payload', async () => {
    // Set enforcement ON
    const originalEnv = process.env.TERMS_ENFORCEMENT_ENABLED;
    process.env.TERMS_ENFORCEMENT_ENABLED = 'true';

    const lodging = buildFullLodging({ status: 'draft' });
    lodgingRepo.findOne.mockResolvedValueOnce(lodging);

    (termsService.getStatusForUser as jest.Mock).mockResolvedValueOnce({
      hasAcceptedLodgingTerms: false,
      activeDocumentIds: { lodging: TERMS_DOC_ID },
    });

    let caughtError: any;
    try {
      await service.submitForReview({ identifier: LODGING_ID, user: mockUser });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ForbiddenException);
    expect(caughtError.response).toMatchObject({
      errorCode: 'TERMS_NOT_ACCEPTED',
      termsType: 'lodging',
      activeTermsId: TERMS_DOC_ID,
    });
    expect(lodgingRepo.save).not.toHaveBeenCalled();

    process.env.TERMS_ENFORCEMENT_ENABLED = originalEnv;
  });

  // -------------------------------------------------------------------------
  // Test 6: T&C not accepted but TERMS_ENFORCEMENT_ENABLED=false → success
  //   3-indicator model note: T&C status is ALWAYS fetched to populate the DTO
  //   for display, but only blocks submit when enforcement is enabled. The old
  //   assertion (`getStatusForUser not called`) is no longer valid — the new
  //   contract is "fetched for display, gate respects the flag".
  // -------------------------------------------------------------------------
  it('T&C not accepted but TERMS_ENFORCEMENT_ENABLED=false → skips T&C gate, succeeds', async () => {
    const originalEnv = process.env.TERMS_ENFORCEMENT_ENABLED;
    process.env.TERMS_ENFORCEMENT_ENABLED = 'false';

    const lodging = buildFullLodging({ status: 'draft' });
    const updatedLodging = buildFullLodging({ status: 'pending_review', submittedAt: new Date() });

    lodgingRepo.findOne.mockResolvedValueOnce(lodging).mockResolvedValueOnce(updatedLodging);
    lodgingRepo.save.mockResolvedValueOnce(updatedLodging);

    // Mock terms as "pendientes" — would block under enforcement, but enforcement is off here.
    (termsService.getStatusForUser as jest.Mock).mockResolvedValue({
      hasAcceptedLodgingTerms: false,
      activeDocumentIds: { lodging: TERMS_DOC_ID },
    });

    const result = await service.submitForReview({ identifier: LODGING_ID, user: mockUser });

    // Submit succeeds despite terms being pendientes — the gate was skipped.
    expect(result.status).toBe('pending_review');

    process.env.TERMS_ENFORCEMENT_ENABLED = originalEnv;
  });
});

// ---------------------------------------------------------------------------
// LodgingsService.findPublicLodgings — translation overlay tests (Plan 27-03)
// ---------------------------------------------------------------------------
describe('LodgingsService — findPublicLodgings (locale overlay)', () => {
  let service: LodgingsService;
  let lodgingRepo: ReturnType<typeof makeRepo>;
  let translationResolver: jest.Mocked<Pick<TranslationResolverService, 'batchLoad' | 'load' | 'overlay'>>;
  let subscriptionsService: jest.Mocked<Pick<SubscriptionsService, 'getActiveSubscribedEntityIds'>>;
  let promotionsService: jest.Mocked<Pick<PromotionsService, 'hasActivePromotions' | 'getLatestActivePromotion'>>;

  const LODGING_ID_A = '00000000-0000-0000-0000-000000000011';
  const LODGING_ID_B = '00000000-0000-0000-0000-000000000012';

  function makeLodgingWithId(id: string): Lodging {
    return buildFullLodging({
      id,
      status: 'published',
      isPublic: true,
      description: 'Descripción en español',
      howToGetThere: 'Cómo llegar en español',
    });
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    lodgingRepo = makeRepo();
    translationResolver = {
      batchLoad: jest.fn(),
      load: jest.fn(),
      overlay: jest.fn().mockImplementation((entity, translations) => ({ ...entity, ...translations })),
    };
    subscriptionsService = {
      getActiveSubscribedEntityIds: jest.fn().mockResolvedValue([LODGING_ID_A, LODGING_ID_B]),
    };
    promotionsService = {
      hasActivePromotions: jest.fn().mockResolvedValue(false),
      getLatestActivePromotion: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LodgingsService,
        { provide: getRepositoryToken(Lodging), useValue: lodgingRepo },
        { provide: getRepositoryToken(LodgingImage), useValue: makeRepo() },
        { provide: getRepositoryToken(Category), useValue: makeRepo() },
        { provide: getRepositoryToken(User), useValue: makeRepo() },
        { provide: getRepositoryToken(Town), useValue: makeRepo() },
        { provide: getRepositoryToken(Facility), useValue: makeRepo() },
        { provide: getRepositoryToken(Place), useValue: makeRepo() },
        { provide: getRepositoryToken(LodgingPlace), useValue: makeRepo() },
        { provide: getRepositoryToken(LodgingRoomType), useValue: makeRepo() },
        {
          provide: CloudinaryService,
          useValue: { uploadImage: jest.fn(), destroyFile: jest.fn(), destroyFolder: jest.fn() },
        },
        { provide: GooglePlacesService, useValue: { getPlaceDetails: jest.fn() } },
        { provide: PromotionsService, useValue: promotionsService },
        { provide: EntityReviewsService, useValue: { getUserReviews: jest.fn().mockResolvedValue([]) } },
        { provide: TermsService, useValue: { getStatusForUser: jest.fn(), getOwnersWithAcceptance: jest.fn() } },
        { provide: DocumentService, useValue: { getEntityDocumentStatus: jest.fn().mockResolvedValue([]) } },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
        { provide: ResendService, useValue: { sendLodgingSubmittedEmail: jest.fn(), sendAdminLodgingPendingNotification: jest.fn() } },
        { provide: SubscriptionsService, useValue: subscriptionsService },
        { provide: TranslationResolverService, useValue: translationResolver },
      ],
    }).compile();

    service = module.get<LodgingsService>(LodgingsService);
  });

  it('locale=en calls batchLoad EXACTLY ONCE for a multi-lodging list (N+1 guard)', async () => {
    const lodgingA = makeLodgingWithId(LODGING_ID_A);
    const lodgingB = makeLodgingWithId(LODGING_ID_B);

    lodgingRepo.find.mockResolvedValueOnce([lodgingA, lodgingB]);

    const translationsMap: Map<string, Record<string, string>> = new Map<string, Record<string, string>>([
      [LODGING_ID_A, { description: 'Description EN A', howToGetThere: 'How to get there EN A' }],
      [LODGING_ID_B, { description: 'Description EN B' }],
    ]);
    translationResolver.batchLoad.mockResolvedValueOnce(translationsMap);

    await service.findPublicLodgings({ filters: {} as any, locale: 'en' });

    // N+1 guard: exactly ONE batchLoad call regardless of number of lodgings
    expect(translationResolver.batchLoad).toHaveBeenCalledTimes(1);
    expect(translationResolver.batchLoad).toHaveBeenCalledWith('lodging', expect.arrayContaining([LODGING_ID_A, LODGING_ID_B]), 'en');
  });

  it('locale=es does NOT call batchLoad (es is canonical, short-circuit)', async () => {
    const lodgingA = makeLodgingWithId(LODGING_ID_A);
    const lodgingB = makeLodgingWithId(LODGING_ID_B);

    lodgingRepo.find.mockResolvedValueOnce([lodgingA, lodgingB]);

    await service.findPublicLodgings({ filters: {} as any, locale: 'es' });

    expect(translationResolver.batchLoad).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// LodgingsService.create — transaction tests
// ---------------------------------------------------------------------------
describe('LodgingsService — create', () => {
  let service: LodgingsService;
  let lodgingRepo: ReturnType<typeof makeRepo>;
  let townRepo: ReturnType<typeof makeRepo>;
  let userRepo: ReturnType<typeof makeRepo>;
  let categoryRepo: ReturnType<typeof makeRepo>;
  let facilityRepo: ReturnType<typeof makeRepo>;
  let placeRepo: ReturnType<typeof makeRepo>;
  let dataSource: { transaction: jest.Mock };
  let termsService: jest.Mocked<Partial<TermsService>>;

  const town = { id: 'town-1' } as Town;
  const user = mockUser;

  beforeEach(async () => {
    jest.clearAllMocks();

    lodgingRepo = makeRepo();
    townRepo = makeRepo();
    userRepo = makeRepo();
    categoryRepo = makeRepo();
    facilityRepo = makeRepo();
    placeRepo = makeRepo();
    dataSource = { transaction: jest.fn() };
    termsService = { getStatusForUser: jest.fn(), getOwnersWithAcceptance: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LodgingsService,
        { provide: getRepositoryToken(Lodging), useValue: lodgingRepo },
        { provide: getRepositoryToken(LodgingImage), useValue: makeRepo() },
        { provide: getRepositoryToken(Category), useValue: categoryRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Town), useValue: townRepo },
        { provide: getRepositoryToken(Facility), useValue: facilityRepo },
        { provide: getRepositoryToken(Place), useValue: placeRepo },
        { provide: getRepositoryToken(LodgingPlace), useValue: makeRepo() },
        { provide: getRepositoryToken(LodgingRoomType), useValue: makeRepo() },
        {
          provide: CloudinaryService,
          useValue: { uploadImage: jest.fn(), destroyFile: jest.fn(), destroyFolder: jest.fn() },
        },
        { provide: GooglePlacesService, useValue: { getPlaceDetails: jest.fn() } },
        {
          provide: PromotionsService,
          useValue: { hasActivePromotions: jest.fn(), getLatestActivePromotion: jest.fn() },
        },
        { provide: EntityReviewsService, useValue: { getUserReviews: jest.fn() } },
        { provide: TermsService, useValue: termsService },
        { provide: DocumentService, useValue: { getEntityDocumentStatus: jest.fn().mockResolvedValue([]) } },
        { provide: DataSource, useValue: dataSource },
        {
          provide: ResendService,
          useValue: { sendBusinessWelcomeEmail: jest.fn().mockResolvedValue(true) },
        },
        { provide: SubscriptionsService, useValue: { getActiveSubscribedEntityIds: jest.fn().mockResolvedValue([]) } },
        { provide: TranslationResolverService, useValue: { batchLoad: jest.fn(), load: jest.fn(), overlay: jest.fn((e: any, t: any) => ({ ...e, ...t })) } },
      ],
    }).compile();

    service = module.get<LodgingsService>(LodgingsService);
  });

  // -------------------------------------------------------------------------
  // happy path — transaction called, lodging persisted (no auto subscription)
  // -------------------------------------------------------------------------
  it('happy path: calls dataSource.transaction and resolves with lodging name message', async () => {
    townRepo.findOne.mockResolvedValueOnce(town);
    userRepo.findOne.mockResolvedValueOnce(user);
    categoryRepo.findBy.mockResolvedValueOnce([]);
    facilityRepo.findBy.mockResolvedValueOnce([]);
    placeRepo.findBy.mockResolvedValueOnce([]);

    const newLodging = { id: LODGING_ID, name: 'My Lodge' } as Lodging;
    dataSource.transaction.mockImplementationOnce(async (cb: (manager: any) => Promise<any>) => {
      const manager = {
        save: jest.fn().mockResolvedValueOnce(newLodging).mockResolvedValue({ id: 'lodging-id' }),
        create: jest.fn().mockReturnValue({}),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      return cb(manager);
    });

    const dto: any = {
      name: 'My Lodge',
      townId: 'town-1',
      latitude: null,
      longitude: null,
      categoryIds: [],
      facilityIds: [],
      placeIds: [],
      lodgingRoomTypes: [],
    };

    const result = await service.create(dto, USER_ID);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ message: 'My Lodge' });
  });
});
