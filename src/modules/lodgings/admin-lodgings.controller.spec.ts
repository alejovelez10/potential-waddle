import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { LodgingsService } from './lodgings.service';
import { Lodging, LodgingImage, LodgingPlace, LodgingRoomType } from './entities';
import { Category, Facility } from '../core/entities';
import { User } from '../users/entities';
import { Town } from '../towns/entities';
import { Place } from '../places/entities';
import { Plan, Subscription } from '../subscriptions/entities';
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

const NOW = new Date('2026-05-13T00:00:00Z');

const mockUser = {
  id: USER_ID,
  email: 'owner@test.com',
  createdAt: NOW,
  updatedAt: NOW,
  name: 'Test Owner',
} as unknown as User;

function buildLodging(overrides: Partial<Lodging> = {}): Lodging {
  return {
    id: LODGING_ID,
    name: 'Test Lodging',
    slug: 'test-lodging',
    status: 'pending_review',
    submittedAt: NOW,
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
    createdAt: NOW,
    updatedAt: NOW,
    user: mockUser,
    town: { id: 'town-1', department: { id: 'dept-1' } } as any,
    categories: [{ id: 'cat-1', name: 'Hostal', icon: null } as any],
    images: [
      { id: 'img-1', imageResource: { id: 'res-1', url: 'https://x.com/1.jpg' } as any, order: 1 } as any,
      { id: 'img-2', imageResource: { id: 'res-2', url: 'https://x.com/2.jpg' } as any, order: 2 } as any,
      { id: 'img-3', imageResource: { id: 'res-3', url: 'https://x.com/3.jpg' } as any, order: 3 } as any,
    ],
    facilities: [],
    reviews: [],
    places: [],
    lodgingRoomTypes: [{ id: 'rt-1', name: 'Standard', price: 50000 as any, maxCapacity: 2, images: [] } as any],
    ...overrides,
  } as Lodging;
}

// ---------------------------------------------------------------------------
// Test module factory
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

async function buildModule() {
  const lodgingRepo = makeRepo();
  const termsService: jest.Mocked<Partial<TermsService>> = {
    getStatusForUser: jest.fn(),
    getOwnersWithAcceptance: jest.fn().mockResolvedValue(new Set()),
  };
  const dataSource: jest.Mocked<Partial<DataSource>> = { transaction: jest.fn() };
  const resendService: jest.Mocked<Partial<ResendService>> = {
    sendLodgingApprovedEmail: jest.fn().mockResolvedValue(true),
    sendLodgingRejectedEmail: jest.fn().mockResolvedValue(true),
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
      { provide: getRepositoryToken(Plan), useValue: makeRepo() },
      { provide: getRepositoryToken(Subscription), useValue: makeRepo() },
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

  return {
    service: module.get<LodgingsService>(LodgingsService),
    lodgingRepo,
    termsService,
    dataSource,
    resendService,
  };
}

// ===========================================================================
// APPROVE
// ===========================================================================

describe('LodgingsService — approve', () => {
  let service: LodgingsService;
  let lodgingRepo: ReturnType<typeof makeRepo>;
  let resendService: jest.Mocked<Partial<ResendService>>;

  beforeEach(async () => {
    jest.clearAllMocks();
    const ctx = await buildModule();
    service = ctx.service;
    lodgingRepo = ctx.lodgingRepo;
    resendService = ctx.resendService;
  });

  // -------------------------------------------------------------------------
  // Test 1: Happy path — pending_review → published, rejectionReason cleared
  // -------------------------------------------------------------------------
  it('happy path: pending_review → published, rejectionReason cleared, returns enriched DTO', async () => {
    const lodging = buildLodging({ status: 'pending_review', rejectionReason: 'old reason' });
    const afterSave = buildLodging({ status: 'published', rejectionReason: null });

    lodgingRepo.findOne
      .mockResolvedValueOnce(lodging) // initial load
      .mockResolvedValueOnce(afterSave); // reload after save
    lodgingRepo.save.mockResolvedValueOnce(afterSave);

    const result = await service.approve({ identifier: LODGING_ID });

    expect(lodgingRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'published', rejectionReason: null }),
    );
    expect(result.status).toBe('published');
    expect(result.rejectionReason).toBeNull();

    // Email dispatcher called fire-and-forget
    await new Promise(r => setImmediate(r));
    expect(resendService.sendLodgingApprovedEmail).toHaveBeenCalledWith(lodging.user.email, lodging.name, lodging.slug);
  });

  // -------------------------------------------------------------------------
  // Test 1b: Email failure does NOT affect approve response (resilience)
  // -------------------------------------------------------------------------
  it('email failure does not affect approve response', async () => {
    const lodging = buildLodging({ status: 'pending_review' });
    const afterSave = buildLodging({ status: 'published', rejectionReason: null });

    lodgingRepo.findOne.mockResolvedValueOnce(lodging).mockResolvedValueOnce(afterSave);
    lodgingRepo.save.mockResolvedValueOnce(afterSave);
    (resendService.sendLodgingApprovedEmail as jest.Mock).mockResolvedValueOnce(false);

    const result = await service.approve({ identifier: LODGING_ID });

    expect(result.status).toBe('published');
  });

  // -------------------------------------------------------------------------
  // Test 2: Lodging not found → NotFoundException
  // -------------------------------------------------------------------------
  it('lodging not found → NotFoundException', async () => {
    lodgingRepo.findOne.mockResolvedValueOnce(null);

    await expect(service.approve({ identifier: LODGING_ID })).rejects.toBeInstanceOf(NotFoundException);
    expect(lodgingRepo.save).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 3: Status != pending_review → BadRequestException with currentStatus
  // -------------------------------------------------------------------------
  it('status=draft → BadRequestException mentioning current status', async () => {
    const lodging = buildLodging({ status: 'draft' });
    lodgingRepo.findOne.mockResolvedValueOnce(lodging);

    let caughtError: any;
    try {
      await service.approve({ identifier: LODGING_ID });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(BadRequestException);
    expect(caughtError.response).toMatchObject({
      message: 'Only pending_review lodgings can be approved',
      currentStatus: 'draft',
    });
    expect(lodgingRepo.save).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// REJECT
// ===========================================================================

describe('LodgingsService — reject', () => {
  let service: LodgingsService;
  let lodgingRepo: ReturnType<typeof makeRepo>;
  let resendService: jest.Mocked<Partial<ResendService>>;

  beforeEach(async () => {
    jest.clearAllMocks();
    const ctx = await buildModule();
    service = ctx.service;
    lodgingRepo = ctx.lodgingRepo;
    resendService = ctx.resendService;
  });

  // -------------------------------------------------------------------------
  // Test 4: Happy path — pending_review → rejected, reason persisted
  // -------------------------------------------------------------------------
  it('happy path: pending_review → rejected, rejectionReason persisted, submittedAt preserved', async () => {
    const lodging = buildLodging({ status: 'pending_review', submittedAt: NOW, rejectionReason: null });
    const afterSave = buildLodging({ status: 'rejected', rejectionReason: 'Missing price info', submittedAt: NOW });

    lodgingRepo.findOne.mockResolvedValueOnce(lodging).mockResolvedValueOnce(afterSave);
    lodgingRepo.save.mockResolvedValueOnce(afterSave);

    const result = await service.reject({ identifier: LODGING_ID, reason: 'Missing price info' });

    expect(lodgingRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rejected', rejectionReason: 'Missing price info' }),
    );
    expect(result.status).toBe('rejected');
    expect(result.rejectionReason).toBe('Missing price info');

    // Email dispatcher called fire-and-forget
    await new Promise(r => setImmediate(r));
    expect(resendService.sendLodgingRejectedEmail).toHaveBeenCalledWith(
      lodging.user.email,
      lodging.name,
      'Missing price info',
    );
  });

  // -------------------------------------------------------------------------
  // Test 4b: Email failure does NOT affect reject response (resilience)
  // -------------------------------------------------------------------------
  it('email failure does not affect reject response', async () => {
    const lodging = buildLodging({ status: 'pending_review' });
    const afterSave = buildLodging({ status: 'rejected', rejectionReason: 'some reason here' });

    lodgingRepo.findOne.mockResolvedValueOnce(lodging).mockResolvedValueOnce(afterSave);
    lodgingRepo.save.mockResolvedValueOnce(afterSave);
    (resendService.sendLodgingRejectedEmail as jest.Mock).mockResolvedValueOnce(false);

    const result = await service.reject({ identifier: LODGING_ID, reason: 'some reason here' });

    expect(result.status).toBe('rejected');
  });

  // -------------------------------------------------------------------------
  // Test 5: Lodging not found → NotFoundException
  // -------------------------------------------------------------------------
  it('lodging not found → NotFoundException', async () => {
    lodgingRepo.findOne.mockResolvedValueOnce(null);

    await expect(service.reject({ identifier: LODGING_ID, reason: 'some reason' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(lodgingRepo.save).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 6: Status != pending_review → BadRequestException with currentStatus
  // -------------------------------------------------------------------------
  it('status=published → BadRequestException mentioning current status', async () => {
    const lodging = buildLodging({ status: 'published' });
    lodgingRepo.findOne.mockResolvedValueOnce(lodging);

    let caughtError: any;
    try {
      await service.reject({ identifier: LODGING_ID, reason: 'some reason here' });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(BadRequestException);
    expect(caughtError.response).toMatchObject({
      message: 'Only pending_review lodgings can be rejected',
      currentStatus: 'published',
    });
    expect(lodgingRepo.save).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// FIND ALL PAGINATED (status filter + submittedAt)
// ===========================================================================

describe('LodgingsService — findAllPaginated with status filter', () => {
  let service: LodgingsService;
  let lodgingRepo: ReturnType<typeof makeRepo>;
  let termsService: jest.Mocked<Partial<TermsService>>;

  beforeEach(async () => {
    jest.clearAllMocks();
    const ctx = await buildModule();
    service = ctx.service;
    lodgingRepo = ctx.lodgingRepo;
    termsService = ctx.termsService;
  });

  // -------------------------------------------------------------------------
  // Test 7: ?status=pending_review → only pending_review rows in result
  // -------------------------------------------------------------------------
  it('filters by status=pending_review — only matching rows returned', async () => {
    const pendingLodging = buildLodging({ status: 'pending_review', submittedAt: NOW });

    // Mock the QueryBuilder chain
    const qb: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[pendingLodging], 1]),
    };
    lodgingRepo.createQueryBuilder.mockReturnValue(qb);
    (termsService.getOwnersWithAcceptance as jest.Mock).mockResolvedValue(new Set([USER_ID]));

    const result = await service.findAllPaginated({ page: 1, limit: 10, status: 'pending_review' } as any);

    // Verify andWhere was called with the status filter
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('status'),
      expect.objectContaining({ status: 'pending_review' }),
    );
    expect(result.count).toBe(1);
    expect(result.data).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Test 8: Each row includes submittedAt in the DTO
  // -------------------------------------------------------------------------
  it('admin list row DTO includes submittedAt', async () => {
    const pendingLodging = buildLodging({ status: 'pending_review', submittedAt: NOW });

    const qb: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[pendingLodging], 1]),
    };
    lodgingRepo.createQueryBuilder.mockReturnValue(qb);
    (termsService.getOwnersWithAcceptance as jest.Mock).mockResolvedValue(new Set());

    const result = await service.findAllPaginated({ page: 1, limit: 10, status: 'pending_review' } as any);

    expect(result.data[0]).toHaveProperty('submittedAt');
    expect(result.data[0].submittedAt).toEqual(NOW);
  });

  // -------------------------------------------------------------------------
  // Test 9: Without ?status= — no status filter applied (no regression)
  // -------------------------------------------------------------------------
  it('without status filter — andWhere is NOT called with status condition', async () => {
    const draftLodging = buildLodging({ status: 'draft' });

    const qb: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[draftLodging], 1]),
    };
    lodgingRepo.createQueryBuilder.mockReturnValue(qb);
    (termsService.getOwnersWithAcceptance as jest.Mock).mockResolvedValue(new Set());

    await service.findAllPaginated({ page: 1, limit: 10 });

    const statusCallArgs = (qb.andWhere as jest.Mock).mock.calls.find(
      (args: any[]) => typeof args[0] === 'string' && args[0].includes('status'),
    );
    expect(statusCallArgs).toBeUndefined();
  });
});
