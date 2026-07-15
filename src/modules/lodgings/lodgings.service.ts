import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsRelations, In, Point, Repository } from 'typeorm';

import { Lodging, LodgingImage, LodgingPlace, LodgingRoomType } from './entities';
import {
  AdminLodgingsFiltersDto,
  AdminLodgingsListDto,
  CreateLodgingDto,
  LodgingFullDto,
  LodgingIndexDto,
  UpdateLodgingDto,
} from './dto';
import { LodgingFindAllParams } from './interfaces';
import {
  computeLodgingCompletion,
  computeLodgingTermsStatus,
  computeLodgingDocsStatus,
  generateLodgingQueryFilters,
  LodgingTermsStatus,
  LodgingDocsStatus,
} from './utils';
import { DocumentService } from '../documents/services';
import { DocumentEntityType } from '../documents/enums';
import { Category, Facility, ImageResource } from '../core/entities';
import { CloudinaryPresets, ResourceProvider } from 'src/config';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { ReorderImagesDto } from '../common/dto/reoder-images.dto';
import { CLOUDINARY_FOLDERS } from 'src/config/cloudinary-folders';
import { User } from '../users/entities';
import { Town } from '../towns/entities';
import { LodgingVectorDto } from './dto/lodging-vector.dto';
import { GooglePlacesService } from '../google-places/google-places.service';
import { Place } from '../places/entities';
import { PromotionsService } from '../promotions/promotions.service';
import { EntityReviewsService } from '../reviews/services/entity-reviews.service';
import { ReviewDomainsEnum } from '../reviews/enums';
import { Review } from '../reviews/entities';
import { TermsService } from '../terms/services';
import { TermsTypeEnum } from '../terms/interfaces';
import { isTermsEnforcementEnabled } from '../terms/utils';
import { ResendService } from '../email/services/resend.service';
import { SubscriptionsService } from '../subscriptions/services';
import { TranslationResolverService } from '../translations/translation-resolver.service';

@Injectable()
export class LodgingsService {
  private readonly logger = new Logger(LodgingsService.name);

  constructor(
    @InjectRepository(Lodging)
    private readonly lodgingRespository: Repository<Lodging>,

    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
    private readonly cloudinaryService: CloudinaryService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Town)
    private readonly townRepository: Repository<Town>,
    @InjectRepository(Facility)
    private readonly facilityRepository: Repository<Facility>,
    @InjectRepository(Place)
    private readonly placeRepository: Repository<Place>,
    private readonly googlePlacesService: GooglePlacesService,
    @InjectRepository(LodgingPlace)
    private readonly lodgingPlaceRepository: Repository<LodgingPlace>,
    @InjectRepository(LodgingRoomType)
    private readonly lodgingRoomTypeRepository: Repository<LodgingRoomType>,
    private readonly promotionsService: PromotionsService,
    private readonly entityReviewsService: EntityReviewsService,
    private readonly termsService: TermsService,
    private readonly documentService: DocumentService,
    private readonly dataSource: DataSource,
    private readonly resendService: ResendService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly translationResolver: TranslationResolverService,
  ) {}

  // ------------------------------------------------------------------------------------------------
  // Find all lodgings
  // ------------------------------------------------------------------------------------------------
  async findAll({ filters }: LodgingFindAllParams = {}) {
    const { where, order } = generateLodgingQueryFilters(filters);

    // Public lists are gated by THREE invariants:
    //   1. status = 'published' (admin-approved)
    //   2. isPublic = true       (owner-toggled visibility)
    //   3. active subscription   (paid or admin-granted)
    const subscribedIds = await this.subscriptionsService.getActiveSubscribedEntityIds('lodging');
    if (subscribedIds.length === 0) return [];
    where.id = In(subscribedIds);
    where.status = 'published';
    where.isPublic = true;

    const relations: FindOptionsRelations<Lodging> = {
      town: { department: true },
      reviews: true,
      categories: { icon: true },
      images: { imageResource: true },
      user: true,
    };

    const lodgings = await this.lodgingRespository.find({ relations, order, where });

    return lodgings.map(lodgings => new LodgingIndexDto(lodgings));
  }

  // ------------------------------------------------------------------------------------------------
  // Find all lodgings paginated (Admin)
  // ------------------------------------------------------------------------------------------------
  async findAllPaginated(filters: AdminLodgingsFiltersDto): Promise<AdminLodgingsListDto> {
    const {
      page = 1,
      limit = 10,
      search,
      categoryId,
      townId,
      isPublic,
      status,
      sortBy = 'name',
      sortOrder = 'ASC',
    } = filters;

    const queryBuilder = this.lodgingRespository
      .createQueryBuilder('lodging')
      .leftJoinAndSelect('lodging.town', 'town')
      .leftJoinAndSelect('town.department', 'department')
      .leftJoinAndSelect('lodging.categories', 'categories')
      .leftJoinAndSelect('categories.icon', 'categoryIcon')
      .leftJoinAndSelect('lodging.images', 'images')
      .leftJoinAndSelect('images.imageResource', 'imageResource')
      .leftJoinAndSelect('lodging.facilities', 'facilities')
      .leftJoinAndSelect('lodging.lodgingRoomTypes', 'lodgingRoomTypes')
      .leftJoinAndSelect('lodging.user', 'user');

    if (search) {
      queryBuilder.andWhere('lodging.name ILIKE :search', { search: `%${search}%` });
    }

    if (categoryId) {
      queryBuilder.andWhere('categories.id = :categoryId', { categoryId });
    }

    if (townId) {
      queryBuilder.andWhere('town.id = :townId', { townId });
    }

    if (isPublic !== undefined) {
      queryBuilder.andWhere('lodging.isPublic = :isPublic', { isPublic });
    }

    if (status !== undefined) {
      queryBuilder.andWhere('lodging.status = :status', { status });
    }

    // Sorting
    const validSortFields = ['name', 'points', 'rating', 'createdAt', 'updatedAt', 'lowestPrice'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'name';
    queryBuilder.orderBy(`lodging.${sortField}`, sortOrder);

    // Pagination
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    const [lodgings, count] = await queryBuilder.getManyAndCount();
    const pages = Math.ceil(count / limit);

    const result = new AdminLodgingsListDto({ currentPage: page, pages, count }, lodgings);

    // Admin-only enrichment: per-row T&C acceptance flag for the owner
    const ownerIds = Array.from(new Set(lodgings.map(l => l.user?.id).filter((id): id is string => !!id)));
    const ownersWithAcceptance = await this.termsService.getOwnersWithAcceptance(TermsTypeEnum.Lodging, ownerIds);
    result.data.forEach((dto, i) => {
      const ownerId = lodgings[i].user?.id;
      dto.ownerHasAcceptedTerms = ownerId ? ownersWithAcceptance.has(ownerId) : false;
    });

    // Per-row completion enrichment so the admin list reflects the same
    // percentage the owner sees in the wizard (otherwise the list would show 0%
    // because completion is computed at runtime, never persisted on the entity).
    await Promise.all(
      result.data.map(async (dto, i) => {
        const lodging = lodgings[i];
        const context = await this.resolveOwnerCompletionContext(lodging);
        const completion = computeLodgingCompletion(lodging, context);
        dto.completionPercentage = completion.completionPercentage;
        dto.infoPercentage = completion.infoPercentage;
      }),
    );

    return result;
  }

  // ------------------------------------------------------------------------------------------------
  // Find all public lodgings
  // ------------------------------------------------------------------------------------------------
  async findPublicLodgings({ filters, user, locale = 'es' }: LodgingFindAllParams = {}) {
    const shouldRandomize = filters?.sortBy === 'random';
    const { where, order } = generateLodgingQueryFilters(filters);

    // Active-subscription gate. forced_public (super admin) la salta.
    const subscribedIds = await this.subscriptionsService.getActiveSubscribedEntityIds('lodging');
    // Sin early-return: aunque no haya suscripciones, los forced_public deben mostrarse.

    // Obtener lodgings y reviews del usuario en paralelo
    const [lodgings, userReviews] = await Promise.all([
      this.lodgingRespository.find({
        relations: {
          town: { department: true },
          categories: { icon: true },
          images: { imageResource: true },
        },
        order,
        where:
          subscribedIds.length > 0
            ? [
                { ...where, status: 'published' as const, isPublic: true, id: In(subscribedIds) },
                { ...where, forcedPublic: true },
              ]
            : [{ ...where, forcedPublic: true }],
      }),
      user
        ? this.entityReviewsService.getUserReviews({
            entityType: ReviewDomainsEnum.LODGINGS,
            userId: user.id,
          })
        : Promise.resolve<Review[]>([]),
    ]);

    // Only randomize if no specific order was requested
    let sortedLodgings = lodgings;
    if (shouldRandomize) {
      sortedLodgings = lodgings.sort(() => Math.random() - 0.5);
    }

    // Check for active promotions for each lodging
    const lodgingsWithPromotions = await Promise.all(
      sortedLodgings.map(async lodging => {
        const hasPromotions = await this.promotionsService.hasActivePromotions(lodging.id, 'lodging');
        const latestPromotion = await this.promotionsService.getLatestActivePromotion(lodging.id, 'lodging');
        const userReview = userReviews.find(r => r.lodging?.id === lodging.id);
        return { lodging, hasPromotions, latestPromotion, userReview };
      }),
    );

    // Batch-load translations once for all lodgings (N+1 guard — D-11 zero AI at request time)
    let translationsMap: Map<string, Record<string, string>> = new Map();
    if (locale !== 'es' && sortedLodgings.length) {
      translationsMap = await this.translationResolver.batchLoad(
        'lodging',
        sortedLodgings.map(l => l.id),
        locale,
      );
    }

    return lodgingsWithPromotions.map(({ lodging, hasPromotions, latestPromotion, userReview }) => {
      const base = locale !== 'es' ? this.translationResolver.overlay({ ...lodging }, translationsMap.get(lodging.id) ?? {}) : lodging;
      const dto = new LodgingIndexDto(base as Lodging, userReview?.id);
      dto.hasPromotions = hasPromotions;
      dto.latestPromotionValue = latestPromotion?.value;
      return dto;
    });
  }

  // ------------------------------------------------------------------------------------------------
  // Find all public lodgings with full info
  // ------------------------------------------------------------------------------------------------
  async findPublicFullInfoLodgings({ filters }: LodgingFindAllParams = {}) {
    const shouldRandomize = filters?.sortBy === 'random';
    const { where, order } = generateLodgingQueryFilters(filters);

    const subscribedIds = await this.subscriptionsService.getActiveSubscribedEntityIds('lodging');
    if (subscribedIds.length === 0) return [];

    let lodgings = await this.lodgingRespository.find({
      relations: {
        town: { department: true },
        categories: { icon: true },
        images: { imageResource: true },
        facilities: { icon: true },
        lodgingRoomTypes: { images: { imageResource: true } },
        places: { place: true },
        // reviewer `user` is loaded ONLY to derive a safe display name in the DTO; never serialized.
        reviews: { user: true },
      },
      order,
      where: {
        ...where,
        status: 'published' as const,
        isPublic: true,
        id: In(subscribedIds),
      },
    });

    // Only randomize if no specific order was requested
    if (shouldRandomize) {
      lodgings = lodgings.sort(() => Math.random() - 0.5);
    }
    return lodgings.map(lodging => new LodgingVectorDto(lodging));
  }
  // ------------------------------------------------------------------------------------------------
  // Find one lodging
  // When ownerId matches the lodging's owner, the response is enriched with completion fields.
  // ------------------------------------------------------------------------------------------------
  async findOne({ identifier, user }: { identifier: string; user?: User }) {
    const relations: FindOptionsRelations<Lodging> = {
      categories: { icon: true },
      facilities: { icon: true },
      town: { department: true },
      images: { imageResource: true },
      places: { place: true },
      lodgingRoomTypes: {
        images: { imageResource: true },
      },
      user: true,
    };

    let lodging = await this.lodgingRespository.findOne({
      where: { id: identifier },
      relations,
      order: { images: { order: 'ASC' } },
    });

    if (!lodging) lodging = await this.lodgingRespository.findOne({ where: { id: identifier }, relations });
    if (!lodging) throw new NotFoundException('Lodging not found');

    const dto = new LodgingFullDto(lodging);

    // Enrich with completion fields for the owner (their wizard) and for super admins
    // (so the admin review screens see the same percentages the owner sees).
    const isOwner = !!user && lodging.user?.id === user.id;
    if (isOwner || user?.isSuperUser) {
      await this.applyOwnerEnrichment(dto, lodging);
    }

    return dto;
  }

  // ------------------------------------------------------------------------------------------------
  // Apply owner-scoped enrichment to an already-built LodgingFullDto. Resolves the 3-indicator
  // context (T&C + docs), runs the compute, and writes both new + legacy fields onto the DTO.
  // Used by findOne, submitForReview, approve, reject — anywhere we return an owner-scoped DTO.
  // ------------------------------------------------------------------------------------------------
  private async applyOwnerEnrichment(dto: LodgingFullDto, lodging: Lodging): Promise<void> {
    const context = await this.resolveOwnerCompletionContext(lodging);
    const result = computeLodgingCompletion(lodging, context);
    dto.status = lodging.status;
    dto.completionPercentage = result.completionPercentage;
    dto.missingFields = result.missingFields;
    dto.infoPercentage = result.infoPercentage;
    dto.infoMissingFields = result.infoMissingFields;
    dto.infoCriticalSatisfied = result.infoCriticalSatisfied;
    dto.termsStatus = result.termsStatus;
    dto.docsStatus = result.docsStatus;
    dto.readyToSubmit = result.readyToSubmit;
    dto.submittedAt = lodging.submittedAt;
    dto.rejectionReason = lodging.rejectionReason;
  }

  // ------------------------------------------------------------------------------------------------
  // Resolve the per-owner completion context (T&C acceptance + docs requirements).
  // Exposed as a single helper so findOne, getUserLodgings, and submitForReview share the same
  // resolution path. Returns "no gate" defaults (no_aplica / no_requeridos) when prerequisite
  // relations are missing — the compute functions are pure so the caller can still get a result.
  // ------------------------------------------------------------------------------------------------
  async resolveOwnerCompletionContext(
    lodging: Lodging,
  ): Promise<{ termsStatus: LodgingTermsStatus; docsStatus: LodgingDocsStatus }> {
    const userId = lodging.user?.id;
    const townId = lodging.town?.id;
    const categoryIds = lodging.categories?.map(c => c.id) ?? [];

    const [termsDto, docsList] = await Promise.all([
      userId ? this.termsService.getStatusForUser(userId) : Promise.resolve(null),
      townId
        ? this.documentService.getEntityDocumentStatus(townId, DocumentEntityType.LODGING, lodging.id, categoryIds)
        : Promise.resolve([]),
    ]);

    // When TERMS_ENFORCEMENT_ENABLED is off, getStatusForUser short-circuits to all-true
    // for legacy gate compat. For the indicator strip we want the truth: gate is off →
    // state='no_aplica'. Otherwise the strip would lie "Aceptados" on every new lodging.
    const activeTermsId = termsDto?.activeDocumentIds?.lodging ?? null;
    const termsStatus = isTermsEnforcementEnabled()
      ? computeLodgingTermsStatus({
          hasActiveLodgingTerms: activeTermsId !== null,
          hasAcceptedLodgingTerms: termsDto?.hasAcceptedLodgingTerms ?? false,
          activeTermsId,
        })
      : { state: 'no_aplica' as const, activeTermsId: null };
    const docsStatus = computeLodgingDocsStatus(
      docsList.map(d => ({
        documentTypeName: d.documentType.name,
        isRequired: d.isRequired,
        isUploaded: d.isUploaded,
        isExpired: d.isExpired,
      })),
    );

    return { termsStatus, docsStatus };
  }

  // ------------------------------------------------------------------------------------------------
  // Find one lodging by slug
  // ------------------------------------------------------------------------------------------------
  async findOneBySlug({ slug, user, locale = 'es' }: { slug: string; user?: User; locale?: string }) {
    const relations: FindOptionsRelations<Lodging> = {
      categories: { icon: true },
      facilities: { icon: true },
      town: { department: true },
      images: { imageResource: true },
      places: {
        place: {
          images: { imageResource: true },
          town: { department: true },
        },
      },
      lodgingRoomTypes: {
        images: { imageResource: true },
      },
    };

    let lodging = await this.lodgingRespository.findOne({
      where: [
        { slug, status: 'published' },
        { slug, forcedPublic: true },
      ],
      relations,
      order: {
        images: { order: 'ASC' },
        places: { order: 'ASC' },
      },
    });

    if (!lodging) lodging = await this.lodgingRespository.findOne({ where: { slug, status: 'published' }, relations });
    if (!lodging) throw new NotFoundException('Lodging not found');

    // Check for active promotions and user review
    const [hasPromotions, latestPromotion, activePromotions, userReview] = await Promise.all([
      this.promotionsService.hasActivePromotions(lodging.id, 'lodging'),
      this.promotionsService.getLatestActivePromotion(lodging.id, 'lodging'),
      this.promotionsService.getActivePromotions(lodging.id, 'lodging'),
      user
        ? this.entityReviewsService.findUserReview({
            entityType: ReviewDomainsEnum.LODGINGS,
            entityId: lodging.id,
            userId: user.id,
          })
        : Promise.resolve(null),
    ]);

    // Load and overlay translations for the requested locale (D-10, D-11 zero AI at request time)
    const base =
      locale !== 'es'
        ? this.translationResolver.overlay(
            { ...lodging },
            await this.translationResolver.load('lodging', lodging.id, locale),
          )
        : lodging;

    const dto = new LodgingFullDto(base as Lodging, userReview?.id);
    (dto as any).hasPromotions = hasPromotions;
    (dto as any).latestPromotionValue = latestPromotion?.value;
    (dto as any).activePromotions = activePromotions;

    return dto;
  }

  // ------------------------------------------------------------------------------------------------
  // Create lodging (transactional: lodging only — subscription is no longer auto-assigned)
  // ------------------------------------------------------------------------------------------------
  async create(createLodgingDto: CreateLodgingDto, userId: string) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { latitude, longitude, lodgingRoomTypes, ...restCreateDto } = createLodgingDto;

    const location: Point | null =
      latitude && longitude
        ? {
            type: 'Point',
            coordinates: [longitude, latitude],
          }
        : null;

    // Pre-load related entities outside the transaction (read-only, safe)
    const [categories, facilities, town, user, places] = await Promise.all([
      createLodgingDto.categoryIds ? this.categoryRepo.findBy({ id: In(createLodgingDto.categoryIds) }) : [],
      createLodgingDto.facilityIds ? this.facilityRepository.findBy({ id: In(createLodgingDto.facilityIds) }) : [],
      this.townRepository.findOne({ where: { id: createLodgingDto.townId } }),
      // Usar userId del JWT, no del DTO (seguridad)
      this.userRepository.findOne({ where: { id: userId } }),
      createLodgingDto.placeIds ? this.placeRepository.findBy({ id: In(createLodgingDto.placeIds) }) : [],
    ]);

    if (!town) throw new NotFoundException('Town not found');
    if (!user) throw new NotFoundException('User not found');

    try {
      const newLodgingId = await this.dataSource.transaction(async manager => {
        // 1. Save the new lodging (status defaults to 'draft' from DB column default)
        const newLodging = await manager.save(Lodging, {
          ...restCreateDto,
          location: location as any,
          categories,
          facilities,
          town,
          user,
        });

        // 2. Create LodgingPlace relations
        if (places.length > 0) {
          for (const [index, place] of places.entries()) {
            const lodgingPlace = manager.create(LodgingPlace, {
              lodging: newLodging,
              place,
              order: index + 1,
              distance: 0,
            });
            await manager.save(LodgingPlace, lodgingPlace);
          }
        }

        // 3. Create lodging room types if provided
        if (lodgingRoomTypes && lodgingRoomTypes.length > 0) {
          for (const roomTypeData of lodgingRoomTypes) {
            const lodgingRoomType = manager.create(LodgingRoomType, {
              ...roomTypeData,
              lodging: newLodging,
            });
            await manager.save(LodgingRoomType, lodgingRoomType);
          }
        }

        // 4. Clear the business-interest follow-up flag — the user has now created
        // their first business, so they no longer need the abandoned-intent nudge.
        await manager.update(User, user.id, { interestedInBusiness: false });

        return newLodging.id;
      });

      // Re-fetch the lodging with the owner-view shape so the wizard can:
      //   - redirect to /profile/negocios/lodgings/:id/onboarding using the new id
      //   - render the header progress radial from completionPercentage + missingFields
      //   - apply the typed adapter (createLodgingDetailAdapter) without crashing on undefined town
      return await this.findOne({ identifier: newLodgingId, user });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new BadRequestException(`Error creating lodging: ${error.message}`);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Update lodging
  // ------------------------------------------------------------------------------------------------
  async update(id: string, updateLodgingDto: UpdateLodgingDto) {
    const lodging = await this.lodgingRespository.findOne({
      where: { id },
      relations: ['town'], // Load town relation to preserve it if not updated
    });
    if (!lodging) throw new NotFoundException('Lodging not found');

    // PATCH semantics: when a relation array is omitted from the body, leave the
    // existing relation untouched. Use `undefined` as the sentinel — the `categories`
    // / `facilities` keys are spread conditionally into the save call below.
    const categories =
      updateLodgingDto.categoryIds !== undefined
        ? await this.categoryRepo.findBy({ id: In(updateLodgingDto.categoryIds) })
        : undefined;
    const facilities =
      updateLodgingDto.facilityIds !== undefined
        ? await this.facilityRepository.findBy({ id: In(updateLodgingDto.facilityIds) })
        : undefined;

    // Cargar town si townId está presente
    let town = lodging.town; // Preservar el town actual por defecto
    if (updateLodgingDto.townId) {
      const foundTown = await this.townRepository.findOne({
        where: { id: updateLodgingDto.townId },
      });
      if (!foundTown) {
        throw new NotFoundException(`Town with ID ${updateLodgingDto.townId} not found`);
      }
      town = foundTown;
    }

    // Extraer lat y lng del DTO y crear el Point
    const { latitude, longitude, lodgingRoomTypes, ...restUpdateDto } = updateLodgingDto;
    // PATCH semantics: only build a new Point when BOTH coords were provided.
    // Otherwise leave the location relation untouched (undefined → omitted in save).
    const location =
      latitude !== undefined && longitude !== undefined && latitude !== null && longitude !== null
        ? {
            type: 'Point',
            coordinates: [longitude, latitude], // GeoJSON usa [longitude, latitude]
          }
        : undefined;

    // Only touch the lodging↔place join table when the request explicitly sent
    // placeIds. An omitted field is a no-op, NOT a "clear all places" signal.
    if (updateLodgingDto.placeIds !== undefined) {
      const placeIds = updateLodgingDto.placeIds;
      const places = placeIds.length > 0 ? await this.placeRepository.findBy({ id: In(placeIds) }) : [];

      try {
        await this.lodgingPlaceRepository.delete({ lodging: { id: lodging.id } });
        if (places.length > 0) {
          for (const [index, place] of places.entries()) {
            const lodgingPlace = this.lodgingPlaceRepository.create({
              lodging: lodging,
              place: place,
              order: index + 1,
              distance: 0,
            });
            await this.lodgingPlaceRepository.save(lodgingPlace);
          }
        }
      } catch (error) {
        this.logger.error(`Error updating lodging places for ID ${id}: ${error.message}`, error.stack);
        throw new InternalServerErrorException(`Error updating lodging places: ${error.message}`);
      }
    }

    // Manejar lodgingRoomTypes si se proporcionan
    if (lodgingRoomTypes !== undefined) {
      try {
        // Obtener los IDs de los room types que vienen en la request
        const incomingRoomTypeIds = lodgingRoomTypes.filter(rt => rt.id).map(rt => rt.id as string);

        // Eliminar los room types que ya no están en la lista (fueron eliminados por el usuario)
        if (incomingRoomTypeIds.length > 0) {
          await this.lodgingRoomTypeRepository
            .createQueryBuilder()
            .delete()
            .from(LodgingRoomType)
            .where('lodging_id = :lodgingId', { lodgingId: lodging.id })
            .andWhere('id NOT IN (:...ids)', { ids: incomingRoomTypeIds })
            .execute();
        } else {
          // Si no hay IDs entrantes, eliminar todos los room types existentes
          await this.lodgingRoomTypeRepository.delete({ lodging: { id: lodging.id } });
        }

        // Procesar cada room type: actualizar existentes o crear nuevos
        if (lodgingRoomTypes && lodgingRoomTypes.length > 0) {
          for (const roomTypeData of lodgingRoomTypes) {
            if (roomTypeData.id) {
              // Actualizar room type existente
              const { id: roomTypeId, ...updateData } = roomTypeData;
              await this.lodgingRoomTypeRepository.update(roomTypeId, updateData);
            } else {
              // Crear nuevo room type
              const lodgingRoomType = this.lodgingRoomTypeRepository.create({
                ...roomTypeData,
                lodging: lodging,
              });
              await this.lodgingRoomTypeRepository.save(lodgingRoomType);
            }
          }
        }
      } catch (error) {
        this.logger.error(`Error updating lodging room types for ID ${id}: ${error.message}`, error.stack);
        throw new InternalServerErrorException(`Error updating lodging room types: ${error.message}`);
      }
    }

    try {
      // Conditional spread: only include `categories` / `facilities` when the
      // caller actually sent them. Otherwise TypeORM's save would persist the
      // resolved value (was wiping the existing relation to []).
      await this.lodgingRespository.save({
        id: lodging.id,
        ...restUpdateDto,
        ...(location !== undefined && { location: location as any }),
        ...(categories !== undefined && { categories }),
        ...(facilities !== undefined && { facilities }),
        user: lodging.user, // Ensure user is preserved if not updated
        town, // Update town when townId is provided
      });
    } catch (error) {
      this.logger.error(`Error saving lodging update for ID ${id}: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Error updating lodging: ${error.message}`);
    }

    const relations: FindOptionsRelations<Lodging> = {
      categories: { icon: true },
      facilities: { icon: true },
      town: { department: true },
      images: { imageResource: true },
      user: true,
    };

    const updatedLodging = await this.lodgingRespository.findOne({
      where: { id },
      relations,
      order: { images: { order: 'ASC' } },
    });

    if (!updatedLodging) throw new NotFoundException('Lodging not found');

    return new LodgingFullDto(updatedLodging);
  }

  // ------------------------------------------------------------------------------------------------
  // Delete lodging
  // ------------------------------------------------------------------------------------------------
  async delete(id: string) {
    const lodging = await this.lodgingRespository.findOne({
      where: { id },
      relations: {
        images: {
          imageResource: true,
        },
        lodgingRoomTypes: true,
      },
    });

    if (!lodging) throw new NotFoundException('Lodging not found');

    try {
      // Delete everything in a single transaction
      await this.lodgingRespository.manager.transaction(async manager => {
        // 1. Delete lodgingRoomTypes first
        if (lodging.lodgingRoomTypes && lodging.lodgingRoomTypes.length > 0) {
          await manager.delete(
            LodgingRoomType,
            lodging.lodgingRoomTypes.map(roomType => roomType.id),
          );
        }

        if (lodging.images && lodging.images.length > 0) {
          // 2. Delete images from Cloudinary
          await Promise.all(
            lodging.images.map(image =>
              image.imageResource.publicId
                ? this.cloudinaryService.destroyFile(image.imageResource.publicId)
                : Promise.resolve(),
            ),
          );

          // 3. Delete LodgingImage entries
          await manager.delete(
            LodgingImage,
            lodging.images.map(image => image.id),
          );

          // 4. Delete ImageResource entries
          await manager.delete(
            ImageResource,
            lodging.images.map(image => image.imageResource.id),
          );
        }

        // 5. Finally delete the lodging
        await manager.delete(Lodging, { id: lodging.id });
      });

      // After all database operations are complete, delete the folder
      try {
        await this.cloudinaryService.destroyFolder(`${CLOUDINARY_FOLDERS.LODGING_GALLERY}/${lodging.slug}`);
      } catch (folderError) {
        console.warn(`Could not delete Cloudinary folder for lodging ${lodging.slug}:`, folderError);
        // Continue with the process, as the main deletion was successful
      }

      return { message: 'Lodging deleted successfully' };
    } catch (error) {
      throw new BadRequestException(`Error deleting lodging: ${JSON.stringify(error)}`);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Bulk delete lodgings (admin)
  // Runs `delete(id)` sequentially per id so each lodging's room types, images,
  // ImageResource entries and Cloudinary assets are cleaned up by the existing
  // transactional path. Errors are caught per id so one failure doesn't cancel
  // the batch — caller gets back the count actually removed.
  // ------------------------------------------------------------------------------------------------
  async bulkDelete(ids: string[]): Promise<{ deleted: number }> {
    if (!ids?.length) return { deleted: 0 };

    let deleted = 0;
    for (const id of ids) {
      try {
        await this.delete(id);
        deleted += 1;
      } catch (err) {
        console.error(`(LodgingsService.bulkDelete): failed to delete ${id}`, err);
      }
    }
    return { deleted };
  }

  // ------------------------------------------------------------------------------------------------
  // Upload image
  // ------------------------------------------------------------------------------------------------
  async uploadImages(id: string, files: Express.Multer.File[], mediaFormat?: string, videoUrl?: string) {
    const lodging = await this.lodgingRespository.findOne({
      where: { id },
      relations: { images: { imageResource: true } },
    });

    if (!lodging) throw new NotFoundException('Lodging not found');

    try {
      // Process each file in the array
      const uploadPromises = files.map(async (file, index) => {
        // Upload the image to Cloudinary
        const cloudinaryRes = await this.cloudinaryService.uploadImage({
          file,
          fileName: lodging.name,
          preset: CloudinaryPresets.LODGING_IMAGE,
          folder: `${CLOUDINARY_FOLDERS.LODGING_GALLERY}/${lodging.slug}`,
        });

        if (!cloudinaryRes) throw new BadRequestException('Error uploading image');

        // Create and save the image resource
        const imageResource = await this.lodgingRespository.manager.create(ImageResource, {
          publicId: cloudinaryRes.publicId,
          url: cloudinaryRes.url,
          fileName: lodging.name,
          width: cloudinaryRes.width,
          height: cloudinaryRes.height,
          format: cloudinaryRes.format,
          resourceType: cloudinaryRes.type,
          provider: ResourceProvider.Cloudinary,
        });

        await this.lodgingRespository.manager.save(ImageResource, imageResource);

        // Create and save the lodging image association
        const lodgingImage = await this.lodgingRespository.manager.create(LodgingImage, {
          imageResource,
          order: lodging.images.length + index + 1,
          lodging: { id: lodging.id },
          mediaFormat: mediaFormat || 'image',
          videoUrl: videoUrl || undefined,
        });

        await this.lodgingRespository.manager.save(LodgingImage, lodgingImage);
      });

      // Wait for all uploads to complete
      await Promise.all(uploadPromises);

      return this.findOne({ identifier: lodging.id });
    } catch (error) {
      throw error;
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Get images
  // ------------------------------------------------------------------------------------------------
  async getImages(id: string) {
    const lodging = await this.lodgingRespository.findOne({
      where: [{ id }],
      relations: {
        images: {
          imageResource: true,
        },
      },
    });
    console.log('images', lodging?.images.length);

    if (!lodging) throw new NotFoundException('Lodging not found');

    return lodging.images.sort((a, b) => a.order - b.order);
  }

  // ------------------------------------------------------------------------------------------------
  // Delete image
  // ------------------------------------------------------------------------------------------------
  async deleteImage(id: string, imageId: string) {
    const lodging = await this.lodgingRespository.findOne({
      where: [{ id }],
      relations: {
        images: {
          imageResource: true,
        },
      },
    });

    if (!lodging) throw new NotFoundException('Lodging not found');

    const image = lodging.images.find(img => img.id === imageId);
    if (!image) throw new NotFoundException('Image not found');

    try {
      // Delete from Cloudinary
      if (image.imageResource.publicId) {
        await this.cloudinaryService.destroyFile(image.imageResource.publicId);
      }

      // Delete from database
      await this.lodgingRespository.manager.remove(image);

      // Reorder remaining images
      const remainingImages = lodging.images
        .filter(img => img.id !== imageId && img.id != undefined)
        .sort((a, b) => a.order - b.order);

      await Promise.all(
        remainingImages.map((img, index) =>
          this.lodgingRespository.manager.update(LodgingImage, img.id, {
            order: index + 1,
          }),
        ),
      );

      return { message: 'Image deleted successfully' };
    } catch (error) {
      throw new BadRequestException('Error deleting image ' + error);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Reorder images
  // ------------------------------------------------------------------------------------------------
  async reorderImages(identifier: string, reorderImagesDto: ReorderImagesDto) {
    const lodging = await this.lodgingRespository.findOne({ where: { id: identifier } });
    if (!lodging) throw new NotFoundException('Lodging not found');

    const { newOrder } = reorderImagesDto;
    console.log(newOrder);
    await Promise.all(
      newOrder.map(({ id, order }) => this.lodgingRespository.manager.update(LodgingImage, id, { order })),
    );

    return { message: 'Images reordered successfully' };
  }

  // ------------------------------------------------------------------------------------------------
  // Update user in lodging
  // ------------------------------------------------------------------------------------------------
  async updateUser(identifier: string, userId: string) {
    const lodging = await this.lodgingRespository.findOne({ where: { id: identifier } });
    if (!lodging) throw new NotFoundException('Lodging not found');

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    lodging.user = user;
    await this.lodgingRespository.save(lodging);

    return user;
  }

  async updateVisibility(identifier: string, isPublic: boolean) {
    const lodging = await this.lodgingRespository.findOne({ where: { id: identifier } });

    if (!lodging) {
      throw new NotFoundException('Lodging not found');
    }
    lodging.isPublic = isPublic;
    await this.lodgingRespository.save(lodging);
    return { message: 'Lodging visibility updated', data: isPublic };
  }

  async updateShowGoogleMapsReviews(identifier: string, showGoogleMapsReviews: boolean) {
    const lodging = await this.lodgingRespository.findOne({ where: { id: identifier } });
    if (!lodging) throw new NotFoundException('Lodging not found');
    lodging.showGoogleMapsReviews = showGoogleMapsReviews;
    await this.lodgingRespository.save(lodging);
    return { message: 'Lodging Google Maps Reviews visibility updated', data: showGoogleMapsReviews };
  }

  // ------------------------------------------------------------------------------------------------
  // Submit lodging for review
  // ------------------------------------------------------------------------------------------------
  async submitForReview({ identifier, user }: { identifier: string; user: User }) {
    const relations: FindOptionsRelations<Lodging> = {
      user: true,
      categories: { icon: true },
      facilities: { icon: true },
      town: { department: true },
      images: { imageResource: true },
      places: { place: true },
      lodgingRoomTypes: { images: { imageResource: true } },
    };

    // 1. Load lodging with all relations needed for completion check
    const lodging = await this.lodgingRespository.findOne({ where: { id: identifier }, relations });
    if (!lodging) throw new NotFoundException('Lodging not found');

    // 2. Ownership check
    if (lodging.user?.id !== user.id) {
      throw new ForbiddenException('Not your lodging');
    }

    // 3. Status guard — only draft or rejected lodgings can be submitted
    if (lodging.status !== 'draft' && lodging.status !== 'rejected') {
      throw new BadRequestException({
        message: 'INVALID_STATUS',
        detail: 'Only draft or rejected lodgings can be submitted',
      });
    }

    // 4. Resolve the 3-indicator completion context (info + terms + docs) and gate per indicator.
    //    Each gate throws a distinct errorCode so the frontend can route to the right UI:
    //    - INCOMPLETE       → wizard step with infoMissingFields
    //    - TERMS_NOT_ACCEPTED → T&C acceptance screen (legacy errorCode kept for FE compat)
    //    - DOCS_INCOMPLETE  → Documentos step with missing list
    const context = await this.resolveOwnerCompletionContext(lodging);
    const completion = computeLodgingCompletion(lodging, context);

    // 4a. Info gate
    if (completion.infoPercentage < 80 || !completion.infoCriticalSatisfied) {
      throw new BadRequestException({
        errorCode: 'INCOMPLETE',
        infoPercentage: completion.infoPercentage,
        infoMissingFields: completion.infoMissingFields,
        // Legacy aliases preserved for older frontend builds.
        completionPercentage: completion.completionPercentage,
        missingFields: completion.missingFields,
      });
    }

    // 4b. T&C gate — only when enforcement is enabled. Preserves the legacy TERMS_NOT_ACCEPTED shape.
    if (isTermsEnforcementEnabled() && context.termsStatus.state === 'pendientes') {
      throw new ForbiddenException({
        errorCode: 'TERMS_NOT_ACCEPTED',
        termsType: 'lodging',
        activeTermsId: context.termsStatus.activeTermsId ?? null,
      });
    }

    // 4c. Docs gate — block when required docs are missing or expired
    if (context.docsStatus.state === 'incompletos') {
      throw new BadRequestException({
        errorCode: 'DOCS_INCOMPLETE',
        docsStatus: context.docsStatus,
      });
    }

    // 6. Transition lodging to pending_review
    lodging.status = 'pending_review';
    lodging.submittedAt = new Date();
    lodging.rejectionReason = null;
    await this.lodgingRespository.save(lodging);

    // 7. Fire-and-forget email notifications — must not block the HTTP response
    void this.resendService.sendLodgingSubmittedEmail(user.email, lodging.name);
    void this.resendService.sendAdminLodgingPendingNotification(lodging.name, user.email);

    // 8. Return owner-enriched shape so frontend can update its query cache
    const updatedLodging = await this.lodgingRespository.findOne({ where: { id: lodging.id }, relations });
    if (!updatedLodging) throw new NotFoundException('Lodging not found after update');

    const dto = new LodgingFullDto(updatedLodging);
    await this.applyOwnerEnrichment(dto, updatedLodging);
    return dto;
  }

  // ------------------------------------------------------------------------------------------------
  // Approve lodging (admin action)
  // ------------------------------------------------------------------------------------------------
  async approve({ identifier }: { identifier: string }): Promise<LodgingFullDto> {
    const relations: FindOptionsRelations<Lodging> = {
      user: true,
      categories: { icon: true },
      facilities: { icon: true },
      town: { department: true },
      images: { imageResource: true },
      places: { place: true },
      lodgingRoomTypes: { images: { imageResource: true } },
    };

    const lodging = await this.lodgingRespository.findOne({ where: { id: identifier }, relations });
    if (!lodging) throw new NotFoundException('Lodging not found');

    if (lodging.status !== 'pending_review') {
      throw new BadRequestException({
        message: 'Only pending_review lodgings can be approved',
        currentStatus: lodging.status,
      });
    }

    lodging.status = 'published';
    lodging.rejectionReason = null; // clear any stale rejection reason
    await this.lodgingRespository.save(lodging);

    // Fire-and-forget email notification — must not block the HTTP response
    void this.resendService.sendLodgingApprovedEmail(lodging.user.email, lodging.name, lodging.slug);

    const updatedLodging = await this.lodgingRespository.findOne({ where: { id: lodging.id }, relations });
    if (!updatedLodging) throw new NotFoundException('Lodging not found after update');

    const dto = new LodgingFullDto(updatedLodging);
    await this.applyOwnerEnrichment(dto, updatedLodging);
    return dto;
  }

  // ------------------------------------------------------------------------------------------------
  // Reject lodging (admin action)
  // ------------------------------------------------------------------------------------------------
  async reject({ identifier, reason }: { identifier: string; reason: string }): Promise<LodgingFullDto> {
    const relations: FindOptionsRelations<Lodging> = {
      user: true,
      categories: { icon: true },
      facilities: { icon: true },
      town: { department: true },
      images: { imageResource: true },
      places: { place: true },
      lodgingRoomTypes: { images: { imageResource: true } },
    };

    const lodging = await this.lodgingRespository.findOne({ where: { id: identifier }, relations });
    if (!lodging) throw new NotFoundException('Lodging not found');

    if (lodging.status !== 'pending_review') {
      throw new BadRequestException({
        message: 'Only pending_review lodgings can be rejected',
        currentStatus: lodging.status,
      });
    }

    lodging.status = 'rejected';
    lodging.rejectionReason = reason;
    // submittedAt is preserved so the owner can see when they last submitted
    await this.lodgingRespository.save(lodging);

    // Fire-and-forget email notification — must not block the HTTP response
    void this.resendService.sendLodgingRejectedEmail(lodging.user.email, lodging.name, reason);

    const updatedLodging = await this.lodgingRespository.findOne({ where: { id: lodging.id }, relations });
    if (!updatedLodging) throw new NotFoundException('Lodging not found after update');

    const dto = new LodgingFullDto(updatedLodging);
    await this.applyOwnerEnrichment(dto, updatedLodging);
    return dto;
  }
}
