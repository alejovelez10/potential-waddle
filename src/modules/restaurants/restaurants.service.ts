import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { FindOptionsRelations, In, Point } from 'typeorm';

import {
  RestaurantDto,
  CreateRestaurantDto,
  UpdateRestaurantDto,
  AdminRestaurantsFiltersDto,
  AdminRestaurantsListDto,
} from './dto';
import { Restaurant, RestaurantImage } from './entities';
import { RestaurantFindAllParams } from './interfaces';
import { generateRestaurantQueryFiltersAndSort } from './logic';
import { Facility, ImageResource } from '../core/entities';
import { Category } from '../core/entities';
import { Town } from '../towns/entities';
import { CLOUDINARY_FOLDERS } from 'src/config/cloudinary-folders';
import { ReorderImagesDto } from '../common/dto/reoder-images.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CloudinaryPresets } from 'src/config/cloudinary-presets.enum';
import { ResourceProvider } from 'src/config/resource-provider.enum';
import { User } from '../users/entities';
import { RestaurantIndexDto } from './dto/restaurant-index.dto';
import { RestaurantVectorDto } from './dto/restaurant-vector.dto';
import { PromotionsService } from '../promotions/promotions.service';
import { EntityReviewsService } from '../reviews/services';
import { ReviewDomainsEnum } from '../reviews/enums';
import { Review } from '../reviews/entities';
import { TermsService } from '../terms/services';
import { TermsTypeEnum } from '../terms/interfaces';
import { isTermsEnforcementEnabled } from '../terms/utils';
import { DocumentService } from '../documents/services';
import { SubscriptionsService } from '../subscriptions/services';
import { DocumentEntityType } from '../documents/enums';
import {
  computeRestaurantCompletion,
  computeRestaurantTermsStatus,
  computeRestaurantDocsStatus,
  RestaurantTermsStatus,
  RestaurantDocsStatus,
} from './utils/compute-restaurant-completion';
import { deriveLowestHighest } from './utils/derive-price-ranges';
import { TranslationResolverService } from '../translations/translation-resolver.service';

@Injectable()
export class RestaurantsService {
  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,

    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,

    @InjectRepository(Facility)
    private readonly facilityRepository: Repository<Facility>,

    @InjectRepository(Town)
    private readonly townRepository: Repository<Town>,

    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    private readonly cloudinaryService: CloudinaryService,
    private readonly promotionsService: PromotionsService,
    private readonly entityReviewsService: EntityReviewsService,
    private readonly termsService: TermsService,
    private readonly documentService: DocumentService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly translationResolver: TranslationResolverService,
  ) {}

  async findAll({ filters }: RestaurantFindAllParams = {}) {
    const { where, order } = generateRestaurantQueryFiltersAndSort(filters);

    // 3-state gating: status='published' + isPublic=true + active subscription.
    const subscribedIds = await this.subscriptionsService.getActiveSubscribedEntityIds('restaurant');
    if (subscribedIds.length === 0) return [];

    const restaurants = await this.restaurantRepository.find({
      relations: { town: { department: true }, categories: { icon: true }, images: { imageResource: true } },
      where: { ...where, id: In(subscribedIds), status: 'published', isPublic: true },
      order,
    });

    return restaurants.map(restaurant => new RestaurantIndexDto({ data: restaurant }));
  }

  // ------------------------------------------------------------------------------------------------
  // Find all restaurants paginated (Admin)
  // ------------------------------------------------------------------------------------------------
  async findAllPaginated(filters: AdminRestaurantsFiltersDto): Promise<AdminRestaurantsListDto> {
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

    const queryBuilder = this.restaurantRepository
      .createQueryBuilder('restaurant')
      .leftJoinAndSelect('restaurant.town', 'town')
      .leftJoinAndSelect('town.department', 'department')
      .leftJoinAndSelect('restaurant.categories', 'categories')
      .leftJoinAndSelect('categories.icon', 'categoryIcon')
      .leftJoinAndSelect('restaurant.images', 'images')
      .leftJoinAndSelect('images.imageResource', 'imageResource')
      .leftJoinAndSelect('restaurant.facilities', 'facilities')
      .leftJoinAndSelect('restaurant.menus', 'menus')
      .leftJoinAndSelect('restaurant.user', 'user');

    if (search) {
      queryBuilder.andWhere('restaurant.name ILIKE :search', { search: `%${search}%` });
    }

    if (categoryId) {
      queryBuilder.andWhere('categories.id = :categoryId', { categoryId });
    }

    if (townId) {
      queryBuilder.andWhere('town.id = :townId', { townId });
    }

    if (isPublic !== undefined) {
      queryBuilder.andWhere('restaurant.isPublic = :isPublic', { isPublic });
    }

    if (status) {
      queryBuilder.andWhere('restaurant.status = :status', { status });
    }

    // Sorting
    const validSortFields = ['name', 'points', 'rating', 'createdAt', 'updatedAt', 'lowestPrice'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'name';
    queryBuilder.orderBy(`restaurant.${sortField}`, sortOrder);

    // Pagination
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    const [restaurants, count] = await queryBuilder.getManyAndCount();
    const pages = Math.ceil(count / limit);

    const result = new AdminRestaurantsListDto({ currentPage: page, pages, count }, restaurants);

    // Admin-only enrichment: per-row T&C acceptance flag for the owner
    const ownerIds = Array.from(new Set(restaurants.map(r => r.user?.id).filter((id): id is string => !!id)));
    const ownersWithAcceptance = await this.termsService.getOwnersWithAcceptance(TermsTypeEnum.Restaurant, ownerIds);
    result.data.forEach((dto, i) => {
      const ownerId = restaurants[i].user?.id;
      dto.ownerHasAcceptedTerms = ownerId ? ownersWithAcceptance.has(ownerId) : false;
    });

    // Per-row completion enrichment so the admin list mirrors the owner-side wizard.
    await Promise.all(
      result.data.map(async (dto, i) => {
        const restaurant = restaurants[i];
        const context = await this.resolveOwnerCompletionContext(restaurant);
        const completion = computeRestaurantCompletion(restaurant, context);
        dto.completionPercentage = completion.completionPercentage;
        dto.infoPercentage = completion.infoPercentage;
      }),
    );

    return result;
  }

  // ------------------------------------------------------------------------------------------------
  // Find all public restaurants
  // ------------------------------------------------------------------------------------------------
  async findPublicRestaurants({ filters, user, locale = 'es' }: RestaurantFindAllParams = {}) {
    const shouldRandomize = filters?.sortBy === 'random';
    const { where, order } = generateRestaurantQueryFiltersAndSort(filters);

    const subscribedIds = await this.subscriptionsService.getActiveSubscribedEntityIds('restaurant');
    // Sin early-return: aunque no haya suscripciones, los forced_public deben mostrarse.

    // Obtener restaurants y reviews del usuario en paralelo
    const [restaurants, userReviews] = await Promise.all([
      this.restaurantRepository.find({
        relations: { town: { department: true }, categories: { icon: true }, images: { imageResource: true } },
        order,
        where:
          subscribedIds.length > 0
            ? [
                { ...where, isPublic: true, status: 'published', id: In(subscribedIds) },
                { ...where, forcedPublic: true },
              ]
            : [{ ...where, forcedPublic: true }],
      }),
      user
        ? this.entityReviewsService.getUserReviews({
            entityType: ReviewDomainsEnum.RESTAURANTS,
            userId: user.id,
          })
        : Promise.resolve<Review[]>([]),
    ]);

    let sortedRestaurants = restaurants;
    if (shouldRandomize) {
      sortedRestaurants = restaurants.sort(() => Math.random() - 0.5);
    }

    // Check for active promotions for each restaurant
    const restaurantsWithPromotions = await Promise.all(
      sortedRestaurants.map(async restaurant => {
        const hasPromotions = await this.promotionsService.hasActivePromotions(restaurant.id, 'restaurant');
        const latestPromotion = await this.promotionsService.getLatestActivePromotion(restaurant.id, 'restaurant');
        const userReview = userReviews.find(r => r.restaurant?.id === restaurant.id);
        return { restaurant, hasPromotions, latestPromotion, userReview };
      }),
    );

    // Batch-load translations once for all restaurants (N+1 guard — zero AI at request time)
    let translationsMap: Map<string, Record<string, string>> = new Map();
    if (locale !== 'es' && sortedRestaurants.length) {
      translationsMap = await this.translationResolver.batchLoad('restaurant', sortedRestaurants.map(r => r.id), locale);
    }

    return restaurantsWithPromotions.map(({ restaurant, hasPromotions, latestPromotion, userReview }) => {
      const base =
        locale !== 'es'
          ? this.translationResolver.overlay({ ...restaurant }, translationsMap.get(restaurant.id) ?? {})
          : restaurant;
      const dto = new RestaurantIndexDto({ data: base as Restaurant, userReview: userReview?.id });
      (dto as any).hasPromotions = hasPromotions;
      (dto as any).latestPromotionValue = latestPromotion?.value;
      return dto;
    });
  }

  // ------------------------------------------------------------------------------------------------
  // Find all public restaurants with full info
  // ------------------------------------------------------------------------------------------------
  async findPublicFullInfoRestaurants({ filters }: RestaurantFindAllParams = {}) {
    const shouldRandomize = filters?.sortBy === 'random';
    const { where, order } = generateRestaurantQueryFiltersAndSort(filters);

    const subscribedIds = await this.subscriptionsService.getActiveSubscribedEntityIds('restaurant');
    if (subscribedIds.length === 0) return [];

    let restaurants = await this.restaurantRepository.find({
      relations: {
        town: { department: true },
        categories: { icon: true },
        images: { imageResource: true },
        facilities: { icon: true },
        menus: true,
        // reviewer `user` is loaded ONLY to derive a safe display name in the DTO; never serialized.
        reviews: { user: true },
      },
      order,
      where: {
        ...where,
        isPublic: true,
        status: 'published',
        id: In(subscribedIds),
      },
    });

    if (shouldRandomize) {
      restaurants = restaurants.sort(() => Math.random() - 0.5);
    }
    return restaurants.map(restaurant => new RestaurantVectorDto({ data: restaurant }));
  }

  // ------------------------------------------------------------------------------------------------
  // Find one restaurant
  // ------------------------------------------------------------------------------------------------
  async findOne(id: string, user?: User) {
    const restaurant = await this.restaurantRepository.findOne({
      where: { id },
      relations: {
        town: { department: true },
        categories: { icon: true },
        images: { imageResource: true },
        facilities: { icon: true },
        menus: true,
        user: true,
      },
    });

    if (!restaurant) throw new NotFoundException(`Restaurant with id ${id} not found`);

    const dto = new RestaurantDto({ data: restaurant });

    // Enrich for owner OR super admin so admin review screens see the same percentages.
    const isOwner = !!user && restaurant.user?.id === user.id;
    if (isOwner || user?.isSuperUser) {
      await this.applyOwnerEnrichment(dto, restaurant);
    }

    return dto;
  }

  // ------------------------------------------------------------------------------------------------
  // Resolve the 3-indicator context (T&C + docs). Mirror of LodgingsService.resolveOwnerCompletionContext.
  // ------------------------------------------------------------------------------------------------
  async resolveOwnerCompletionContext(
    restaurant: Restaurant,
  ): Promise<{ termsStatus: RestaurantTermsStatus; docsStatus: RestaurantDocsStatus }> {
    const userId = restaurant.user?.id;
    const townId = restaurant.town?.id;
    const categoryIds = restaurant.categories?.map(c => c.id) ?? [];

    const [termsDto, docsList] = await Promise.all([
      userId ? this.termsService.getStatusForUser(userId) : Promise.resolve(null),
      townId
        ? this.documentService.getEntityDocumentStatus(
            townId,
            DocumentEntityType.RESTAURANT,
            restaurant.id,
            categoryIds,
          )
        : Promise.resolve([]),
    ]);

    // See LodgingsService.resolveOwnerCompletionContext — same enforcement-flag honesty.
    const activeTermsId = termsDto?.activeDocumentIds?.restaurant ?? null;
    const termsStatus = isTermsEnforcementEnabled()
      ? computeRestaurantTermsStatus({
          hasActiveRestaurantTerms: activeTermsId !== null,
          hasAcceptedRestaurantTerms: termsDto?.hasAcceptedRestaurantTerms ?? false,
          activeTermsId,
        })
      : { state: 'no_aplica' as const, activeTermsId: null };
    const docsStatus = computeRestaurantDocsStatus(
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
  // Populate owner-scoped fields on a RestaurantDto. Mirror of LodgingsService.applyOwnerEnrichment.
  // ------------------------------------------------------------------------------------------------
  private async applyOwnerEnrichment(dto: RestaurantDto, restaurant: Restaurant): Promise<void> {
    const context = await this.resolveOwnerCompletionContext(restaurant);
    const result = computeRestaurantCompletion(restaurant, context);
    dto.status = restaurant.status;
    dto.completionPercentage = result.completionPercentage;
    dto.missingFields = result.missingFields;
    dto.infoPercentage = result.infoPercentage;
    dto.infoMissingFields = result.infoMissingFields;
    dto.infoCriticalSatisfied = result.infoCriticalSatisfied;
    dto.termsStatus = result.termsStatus;
    dto.docsStatus = result.docsStatus;
    dto.readyToSubmit = result.readyToSubmit;
    dto.submittedAt = restaurant.submittedAt;
    dto.rejectionReason = restaurant.rejectionReason;
    dto.menuNotApplicable = restaurant.menuNotApplicable;
  }

  // ------------------------------------------------------------------------------------------------
  // Submit restaurant for review. Mirror of LodgingsService.submitForReview with 3 gates.
  // ------------------------------------------------------------------------------------------------
  async submitForReview({ identifier, user }: { identifier: string; user: User }) {
    const relations: FindOptionsRelations<Restaurant> = {
      user: true,
      categories: { icon: true },
      facilities: { icon: true },
      town: { department: true },
      images: { imageResource: true },
      menus: true,
    };
    const restaurant = await this.restaurantRepository.findOne({ where: { id: identifier }, relations });
    if (!restaurant) throw new NotFoundException('Restaurant not found');

    if (restaurant.user?.id !== user.id) {
      throw new ForbiddenException('Not your restaurant');
    }

    if (restaurant.status !== 'draft' && restaurant.status !== 'rejected') {
      throw new BadRequestException({
        message: 'INVALID_STATUS',
        detail: 'Only draft or rejected restaurants can be submitted',
      });
    }

    const context = await this.resolveOwnerCompletionContext(restaurant);
    const completion = computeRestaurantCompletion(restaurant, context);

    if (completion.infoPercentage < 80 || !completion.infoCriticalSatisfied) {
      throw new BadRequestException({
        errorCode: 'INCOMPLETE',
        infoPercentage: completion.infoPercentage,
        infoMissingFields: completion.infoMissingFields,
        completionPercentage: completion.completionPercentage,
        missingFields: completion.missingFields,
      });
    }

    if (isTermsEnforcementEnabled() && context.termsStatus.state === 'pendientes') {
      throw new ForbiddenException({
        errorCode: 'TERMS_NOT_ACCEPTED',
        termsType: 'restaurant',
        activeTermsId: context.termsStatus.activeTermsId ?? null,
      });
    }

    if (context.docsStatus.state === 'incompletos') {
      throw new BadRequestException({
        errorCode: 'DOCS_INCOMPLETE',
        docsStatus: context.docsStatus,
      });
    }

    restaurant.status = 'pending_review';
    restaurant.submittedAt = new Date();
    restaurant.rejectionReason = null;
    await this.restaurantRepository.save(restaurant);

    const updated = await this.restaurantRepository.findOne({ where: { id: restaurant.id }, relations });
    if (!updated) throw new NotFoundException('Restaurant not found after update');
    const dto = new RestaurantDto({ data: updated });
    await this.applyOwnerEnrichment(dto, updated);
    return dto;
  }

  // ------------------------------------------------------------------------------------------------
  // Approve restaurant (admin).
  // ------------------------------------------------------------------------------------------------
  async approve({ identifier }: { identifier: string }) {
    const relations: FindOptionsRelations<Restaurant> = {
      user: true,
      categories: { icon: true },
      facilities: { icon: true },
      town: { department: true },
      images: { imageResource: true },
      menus: true,
    };
    const restaurant = await this.restaurantRepository.findOne({ where: { id: identifier }, relations });
    if (!restaurant) throw new NotFoundException('Restaurant not found');

    if (restaurant.status !== 'pending_review') {
      throw new BadRequestException({
        message: 'Only pending_review restaurants can be approved',
        currentStatus: restaurant.status,
      });
    }

    restaurant.status = 'published';
    restaurant.rejectionReason = null;
    await this.restaurantRepository.save(restaurant);

    const updated = await this.restaurantRepository.findOne({ where: { id: restaurant.id }, relations });
    if (!updated) throw new NotFoundException('Restaurant not found after update');
    const dto = new RestaurantDto({ data: updated });
    await this.applyOwnerEnrichment(dto, updated);
    return dto;
  }

  // ------------------------------------------------------------------------------------------------
  // Reject restaurant (admin).
  // ------------------------------------------------------------------------------------------------
  async reject({ identifier, reason }: { identifier: string; reason: string }) {
    const relations: FindOptionsRelations<Restaurant> = {
      user: true,
      categories: { icon: true },
      facilities: { icon: true },
      town: { department: true },
      images: { imageResource: true },
      menus: true,
    };
    const restaurant = await this.restaurantRepository.findOne({ where: { id: identifier }, relations });
    if (!restaurant) throw new NotFoundException('Restaurant not found');

    if (restaurant.status !== 'pending_review') {
      throw new BadRequestException({
        message: 'Only pending_review restaurants can be rejected',
        currentStatus: restaurant.status,
      });
    }

    restaurant.status = 'rejected';
    restaurant.rejectionReason = reason;
    await this.restaurantRepository.save(restaurant);

    const updated = await this.restaurantRepository.findOne({ where: { id: restaurant.id }, relations });
    if (!updated) throw new NotFoundException('Restaurant not found after update');
    const dto = new RestaurantDto({ data: updated });
    await this.applyOwnerEnrichment(dto, updated);
    return dto;
  }

  // ------------------------------------------------------------------------------------------------
  // Find one restaurant by slug
  // ------------------------------------------------------------------------------------------------
  async findOneBySlug({ slug, user, locale = 'es' }: { slug: string; user?: User; locale?: string }) {
    const relations: FindOptionsRelations<Restaurant> = {
      categories: { icon: true },
      facilities: { icon: true },
      town: { department: true },
      images: { imageResource: true },
    };

    // Published guard — draft/pending/rejected restaurants must not leak to public pages.
    let restaurant = await this.restaurantRepository.findOne({
      where: [
        { slug, status: 'published' },
        { slug, forcedPublic: true },
      ],
      relations,
      order: { images: { order: 'ASC' } },
    });

    if (!restaurant)
      restaurant = await this.restaurantRepository.findOne({ where: { slug, status: 'published' }, relations });
    if (!restaurant) throw new NotFoundException('Restaurant not found');

    // Check for active promotions and user review in parallel
    const [hasPromotions, latestPromotion, activePromotions, userReview] = await Promise.all([
      this.promotionsService.hasActivePromotions(restaurant.id, 'restaurant'),
      this.promotionsService.getLatestActivePromotion(restaurant.id, 'restaurant'),
      this.promotionsService.getActivePromotions(restaurant.id, 'restaurant'),
      user
        ? this.entityReviewsService.findUserReview({
            entityType: ReviewDomainsEnum.RESTAURANTS,
            entityId: restaurant.id,
            userId: user.id,
          })
        : Promise.resolve(null),
    ]);

    // Load and overlay translations for the requested locale (zero AI at request time)
    const base =
      locale !== 'es'
        ? this.translationResolver.overlay(
            { ...restaurant },
            await this.translationResolver.load('restaurant', restaurant.id, locale),
          )
        : restaurant;

    const dto = new RestaurantDto({ data: base as Restaurant, userReview: userReview?.id });
    (dto as any).hasPromotions = hasPromotions;
    (dto as any).latestPromotionValue = latestPromotion?.value;
    (dto as any).activePromotions = activePromotions;

    return dto;
  }

  // ------------------------------------------------------------------------------------------------
  // Create restaurant
  // ------------------------------------------------------------------------------------------------
  async create(createRestaurantDto: CreateRestaurantDto, userId: string) {
    const { latitude, longitude, ...restCreateDto } = createRestaurantDto;
    const restaurantLocation: Point | null =
      latitude && longitude
        ? {
            type: 'Point',
            coordinates: [Number(longitude), Number(latitude)],
          }
        : null;

    const categories = createRestaurantDto.categoryIds
      ? await this.categoryRepository.findBy({ id: In(createRestaurantDto.categoryIds) })
      : [];
    const facilities = createRestaurantDto.facilityIds
      ? await this.facilityRepository.findBy({ id: In(createRestaurantDto.facilityIds) })
      : [];
    const town = await this.townRepository.findOne({ where: { id: createRestaurantDto.townId } });

    // Usar userId del JWT, no del DTO (seguridad)
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (!town) {
      throw new NotFoundException('Town not found');
    }
    try {
      // Save, then re-hydrate via findOne so the FE adapter receives the full
      // RestaurantFullDto shape (town + categories + relations) and the
      // onboarding flow can route to /profile/restaurants/:id/edit immediately
      // — no slug fallback dance.
      const saved = await this.restaurantRepository.save({
        ...restCreateDto,
        location: restaurantLocation ?? undefined,
        categories,
        facilities,
        town: town ?? undefined,
        user,
      });

      return await this.findOne(saved.id, user);
    } catch (error) {
      throw new BadRequestException(`Error creating restaurant: ${error.message}`);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Update restaurant
  // ------------------------------------------------------------------------------------------------
  async update(id: string, updateRestaurantDto: UpdateRestaurantDto) {
    const restaurant = await this.restaurantRepository.findOne({
      where: { id },
      relations: ['town'],
    });
    if (!restaurant) throw new NotFoundException('Restaurant not found');

    // PATCH semantics: an omitted relation array is "leave alone" (use `undefined`
    // sentinel + conditional spread), not "clear". Same fix as 8266a33 lodgings + 6dbab14 commerce.
    const categories =
      updateRestaurantDto.categoryIds !== undefined
        ? await this.categoryRepository.findBy({ id: In(updateRestaurantDto.categoryIds) })
        : undefined;
    const facilities =
      updateRestaurantDto.facilityIds !== undefined
        ? await this.facilityRepository.findBy({ id: In(updateRestaurantDto.facilityIds) })
        : undefined;

    // Preserve current town by default; only override when townId is explicitly provided.
    let town = restaurant.town;
    if (updateRestaurantDto.townId) {
      const foundTown = await this.townRepository.findOne({
        where: { id: updateRestaurantDto.townId },
      });
      if (!foundTown) {
        throw new NotFoundException(`Town with ID ${updateRestaurantDto.townId} not found`);
      }
      town = foundTown;
    }

    const { latitude, longitude, ...restUpdateDto } = updateRestaurantDto;
    const restaurantLocation =
      latitude !== undefined && longitude !== undefined && latitude !== null && longitude !== null
        ? ({
            type: 'Point',
            coordinates: [Number(longitude), Number(latitude)],
          } as Point)
        : undefined;

    const derivedPrices =
      updateRestaurantDto.priceRanges !== undefined
        ? deriveLowestHighest(updateRestaurantDto.priceRanges)
        : undefined;

    await this.restaurantRepository.save({
      id: restaurant.id,
      ...restUpdateDto,
      ...(restaurantLocation !== undefined && { location: restaurantLocation }),
      ...(categories !== undefined && { categories }),
      ...(facilities !== undefined && { facilities }),
      ...(derivedPrices !== undefined && {
        lowestPrice: derivedPrices.lowestPrice,
        higherPrice: derivedPrices.higherPrice,
      }),
      town,
    });

    const relations: FindOptionsRelations<Restaurant> = {
      categories: { icon: true },
      facilities: { icon: true },
      town: { department: true },
      images: { imageResource: true },
    };

    const updatedRestaurant = await this.restaurantRepository.findOne({
      where: { id },
      relations,
      order: { images: { order: 'ASC' } },
    });

    if (!updatedRestaurant) throw new NotFoundException('Restaurant not found');
    return { message: updatedRestaurant.name };
  }

  // ------------------------------------------------------------------------------------------------
  // Delete restaurant
  // ------------------------------------------------------------------------------------------------
  async delete(id: string) {
    const restaurant = await this.restaurantRepository.findOne({
      where: { id },
      relations: {
        images: {
          imageResource: true,
        },
      },
    });

    if (!restaurant) throw new NotFoundException('Restaurant not found');

    try {
      // Delete everything in a single transaction
      await this.restaurantRepository.manager.transaction(async manager => {
        if (restaurant.images && restaurant.images.length > 0) {
          // 1. Delete images from Cloudinary
          await Promise.all(
            restaurant.images.map(image =>
              image.imageResource.publicId
                ? this.cloudinaryService.destroyFile(image.imageResource.publicId)
                : Promise.resolve(),
            ),
          );

          // 2. Delete RestaurantImage first
          await manager.delete(
            RestaurantImage,
            restaurant.images.map(image => image.id),
          );

          // 3. Delete ImageResource
          await manager.delete(
            ImageResource,
            restaurant.images.map(image => image.imageResource.id),
          );
        }

        // 4. Finally delete the restaurant
        await manager.delete(Restaurant, { id: restaurant.id });
      });

      // After all database operations complete, delete the folder
      try {
        await this.cloudinaryService.destroyFolder(`${CLOUDINARY_FOLDERS.RESTAURANT_GALLERY}/${restaurant.slug}`);
      } catch (folderError) {
        console.warn(`Could not delete Cloudinary folder for restaurant ${restaurant.slug}:`, folderError);
        // Continue with the process, as the main deletion was successful
      }

      return { message: 'Restaurant deleted successfully' };
    } catch (error) {
      throw new BadRequestException(`Error deleting restaurant: ${error.message}`);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Bulk delete restaurants (admin) — sequential call to delete() per id so the
  // cascade (images, Cloudinary assets) runs through the existing path. Errors
  // are caught per id so one failure doesn't cancel the batch.
  // ------------------------------------------------------------------------------------------------
  async bulkDelete(ids: string[]): Promise<{ deleted: number }> {
    if (!ids?.length) return { deleted: 0 };
    let deleted = 0;
    for (const id of ids) {
      try {
        await this.delete(id);
        deleted += 1;
      } catch (err) {
        console.error(`(RestaurantsService.bulkDelete): failed to delete ${id}`, err);
      }
    }
    return { deleted };
  }

  // ------------------------------------------------------------------------------------------------
  // Upload images
  // ------------------------------------------------------------------------------------------------
  async uploadImages(id: string, files: Express.Multer.File[]) {
    const restaurant = await this.restaurantRepository.findOne({
      where: { id },
      relations: { images: { imageResource: true } },
    });

    if (!restaurant) throw new NotFoundException('Restaurant not found');

    try {
      // Process each file in the array
      const uploadPromises = files.map(async (file, index) => {
        // Upload the image to Cloudinary
        const cloudinaryRes = await this.cloudinaryService.uploadImage({
          file,
          fileName: restaurant.name,
          preset: CloudinaryPresets.RESTAURANT_IMAGE,
          folder: `${CLOUDINARY_FOLDERS.RESTAURANT_GALLERY}/${restaurant.slug}`,
        });

        if (!cloudinaryRes) throw new BadRequestException('Error uploading image');

        // Create and save the image resource
        const imageResource = await this.restaurantRepository.manager.create(ImageResource, {
          publicId: cloudinaryRes.publicId,
          url: cloudinaryRes.url,
          fileName: restaurant.name,
          width: cloudinaryRes.width,
          height: cloudinaryRes.height,
          format: cloudinaryRes.format,
          resourceType: cloudinaryRes.type,
          provider: ResourceProvider.Cloudinary,
        });

        await this.restaurantRepository.manager.save(ImageResource, imageResource);

        // Create and save the restaurant image association
        const restaurantImage = await this.restaurantRepository.manager.create(RestaurantImage, {
          imageResource,
          order: (restaurant.images?.length || 0) + index + 1,
          restaurant: { id: restaurant.id },
        });

        await this.restaurantRepository.manager.save(RestaurantImage, restaurantImage);
      });

      // Wait for all uploads to complete
      await Promise.all(uploadPromises);

      return this.findOne(restaurant.id);
    } catch (error) {
      throw error;
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Get images
  // ------------------------------------------------------------------------------------------------
  async getImages(id: string) {
    const restaurant = await this.restaurantRepository.findOne({
      where: [{ id }],
      relations: {
        images: {
          imageResource: true,
        },
      },
    });

    if (!restaurant) throw new NotFoundException('Restaurant not found');

    return restaurant.images?.sort((a, b) => a.order - b.order);
  }

  // ------------------------------------------------------------------------------------------------
  // Delete image
  // ------------------------------------------------------------------------------------------------
  async deleteImage(id: string, imageId: string) {
    const restaurant = await this.restaurantRepository.findOne({
      where: [{ id }],
      relations: {
        images: {
          imageResource: true,
        },
      },
    });

    if (!restaurant) throw new NotFoundException('Restaurant not found');

    const image = restaurant.images?.find(img => img.id === imageId);
    if (!image) throw new NotFoundException('Image not found');

    try {
      // Delete from Cloudinary
      if (image.imageResource.publicId) {
        await this.cloudinaryService.destroyFile(image.imageResource.publicId);
      }

      // Delete from database
      await this.restaurantRepository.manager.remove(image);

      // Reorder remaining images
      const remainingImages = restaurant.images
        ?.filter(img => img.id !== imageId && img.id != undefined)
        .sort((a, b) => a.order - b.order);
      if (remainingImages?.length) {
        await Promise.all(
          remainingImages.map((img, index) =>
            this.restaurantRepository.manager.update(RestaurantImage, img.id, {
              order: index + 1,
            }),
          ),
        );
      }

      return { message: 'Image deleted successfully' };
    } catch (error) {
      throw new BadRequestException('Error deleting image ' + error);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Reorder images
  // ------------------------------------------------------------------------------------------------
  async reorderImages(identifier: string, reorderImagesDto: ReorderImagesDto) {
    const restaurant = await this.restaurantRepository.findOne({ where: { id: identifier } });
    if (!restaurant) throw new NotFoundException('Restaurant not found');

    const { newOrder } = reorderImagesDto;
    await Promise.all(
      newOrder.map(({ id, order }) => this.restaurantRepository.manager.update(RestaurantImage, id, { order })),
    );

    return { message: 'Images reordered successfully' };
  }

  // ------------------------------------------------------------------------------------------------
  // Update user in lodging
  // ------------------------------------------------------------------------------------------------
  async updateUser(identifier: string, userId: string) {
    const restaurant = await this.restaurantRepository.findOne({ where: { id: identifier } });
    if (!restaurant) throw new NotFoundException('Restaurant not found');

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    restaurant.user = user;
    await this.restaurantRepository.save(restaurant);

    return user;
  }

  // ------------------------------------------------------------------------------------------------
  // Update visibility
  // ------------------------------------------------------------------------------------------------
  async updateVisibility(identifier: string, isPublic: boolean) {
    const restaurant = await this.restaurantRepository.findOne({ where: { id: identifier } });

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }
    restaurant.isPublic = isPublic;
    await this.restaurantRepository.save(restaurant);
    return { message: 'Restaurant visibility updated', data: isPublic };
  }

  // ------------------------------------------------------------------------------------------------
  // Update show google maps reviews
  // ------------------------------------------------------------------------------------------------
  async updateShowGoogleMapsReviews(identifier: string, showGoogleMapsReviews: boolean) {
    const restaurant = await this.restaurantRepository.findOne({ where: { id: identifier } });
    if (!restaurant) throw new NotFoundException('Restaurant not found');
    restaurant.showGoogleMapsReviews = showGoogleMapsReviews;
    await this.restaurantRepository.save(restaurant);
    return { message: 'Restaurant Google Maps Reviews visibility updated', data: showGoogleMapsReviews };
  }
}
