import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { FindOptionsRelations, In, Point } from 'typeorm';
import { Commerce, CommerceImage, CommerceProduct } from './entities';
import {
  CreateCommerceDto,
  UpdateCommerceDto,
  CommerceIndexDto,
  CommerceFullDto,
  AdminCommerceFiltersDto,
  AdminCommerceListDto,
} from './dto';
import { Facility, ImageResource } from '../core/entities';
import { Category } from '../core/entities';
import { Town } from '../towns/entities';
import { CLOUDINARY_FOLDERS } from 'src/config/cloudinary-folders';
import { ReorderImagesDto } from '../common/dto/reoder-images.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CloudinaryPresets } from 'src/config/cloudinary-presets.enum';
import { ResourceProvider } from 'src/config/resource-provider.enum';
import { User } from '../users/entities';
import { CommerceFindAllParams } from './interfaces';
import { generateCommerceQueryFiltersAndSort } from './logic/generate-commerce-query-filters-and-sort';
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
  computeCommerceCompletion,
  computeCommerceTermsStatus,
  computeCommerceDocsStatus,
  CommerceTermsStatus,
  CommerceDocsStatus,
} from './utils/compute-commerce-completion';
import { TranslationResolverService } from '../translations/translation-resolver.service';

@Injectable()
export class CommerceService {
  constructor(
    @InjectRepository(Commerce)
    private readonly commerceRepository: Repository<Commerce>,

    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,

    @InjectRepository(Facility)
    private readonly facilityRepository: Repository<Facility>,

    @InjectRepository(Town)
    private readonly townRepository: Repository<Town>,

    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    @InjectRepository(CommerceProduct)
    private readonly commerceProductRepository: Repository<CommerceProduct>,

    private readonly cloudinaryService: CloudinaryService,
    private readonly entityReviewsService: EntityReviewsService,
    private readonly termsService: TermsService,
    private readonly documentService: DocumentService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly translationResolver: TranslationResolverService,
  ) {}

  async findAll({ filters }: CommerceFindAllParams = {}) {
    const { where, order } = generateCommerceQueryFiltersAndSort(filters);

    // 3-state gating: status='published' + isPublic=true + active subscription.
    const subscribedIds = await this.subscriptionsService.getActiveSubscribedEntityIds('commerce');
    if (subscribedIds.length === 0) return [];

    const commerces = await this.commerceRepository.find({
      relations: {
        town: { department: true },
        categories: { icon: true },
        images: { imageResource: true },
        user: true,
      },
      where: { ...where, id: In(subscribedIds), status: 'published', isPublic: true },
      order,
    });

    return commerces.map(commerce => new CommerceIndexDto(commerce));
  }

  // ------------------------------------------------------------------------------------------------
  // Find all commerce paginated (Admin)
  // ------------------------------------------------------------------------------------------------
  async findAllPaginated(filters: AdminCommerceFiltersDto): Promise<AdminCommerceListDto> {
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

    const queryBuilder = this.commerceRepository
      .createQueryBuilder('commerce')
      .leftJoinAndSelect('commerce.town', 'town')
      .leftJoinAndSelect('town.department', 'department')
      .leftJoinAndSelect('commerce.categories', 'categories')
      .leftJoinAndSelect('categories.icon', 'categoryIcon')
      .leftJoinAndSelect('commerce.images', 'images')
      .leftJoinAndSelect('images.imageResource', 'imageResource')
      .leftJoinAndSelect('commerce.facilities', 'facilities')
      .leftJoinAndSelect('commerce.products', 'products')
      .leftJoinAndSelect('commerce.user', 'user');

    if (search) {
      queryBuilder.andWhere('commerce.name ILIKE :search', { search: `%${search}%` });
    }

    if (categoryId) {
      queryBuilder.andWhere('categories.id = :categoryId', { categoryId });
    }

    if (townId) {
      queryBuilder.andWhere('town.id = :townId', { townId });
    }

    if (isPublic !== undefined) {
      queryBuilder.andWhere('commerce.isPublic = :isPublic', { isPublic });
    }

    if (status) {
      queryBuilder.andWhere('commerce.status = :status', { status });
    }

    // Sorting
    const validSortFields = ['name', 'points', 'rating', 'createdAt', 'updatedAt'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'name';
    queryBuilder.orderBy(`commerce.${sortField}`, sortOrder);

    // Pagination
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    const [commerces, count] = await queryBuilder.getManyAndCount();
    const pages = Math.ceil(count / limit);

    const result = new AdminCommerceListDto({ currentPage: page, pages, count }, commerces);

    // Admin-only enrichment: per-row T&C acceptance flag for the owner
    const ownerIds = Array.from(new Set(commerces.map(c => c.user?.id).filter((id): id is string => !!id)));
    const ownersWithAcceptance = await this.termsService.getOwnersWithAcceptance(TermsTypeEnum.Commerce, ownerIds);
    result.data.forEach((dto, i) => {
      const ownerId = commerces[i].user?.id;
      dto.ownerHasAcceptedTerms = ownerId ? ownersWithAcceptance.has(ownerId) : false;
    });

    // Per-row completion enrichment so the admin list mirrors the owner-side wizard.
    await Promise.all(
      result.data.map(async (dto, i) => {
        const commerce = commerces[i];
        const context = await this.resolveOwnerCompletionContext(commerce);
        const completion = computeCommerceCompletion(commerce, context);
        dto.completionPercentage = completion.completionPercentage;
        dto.infoPercentage = completion.infoPercentage;
      }),
    );

    return result;
  }

  async findPublicCommerce({ filters, user, locale = 'es' }: CommerceFindAllParams = {}) {
    const shouldRandomize = filters?.sortBy === 'random';
    const { where, order } = generateCommerceQueryFiltersAndSort(filters);

    const subscribedIds = await this.subscriptionsService.getActiveSubscribedEntityIds('commerce');
    // Sin early-return: aunque no haya suscripciones, los forced_public deben mostrarse.

    // Obtener commerces y reviews del usuario en paralelo
    const [commerces, userReviews] = await Promise.all([
      this.commerceRepository.find({
        relations: {
          town: { department: true },
          categories: { icon: true },
          images: { imageResource: true },
          user: true,
        },
        where:
          subscribedIds.length > 0
            ? [
                { ...where, isPublic: true, status: 'published', id: In(subscribedIds) },
                { ...where, forcedPublic: true },
              ]
            : [{ ...where, forcedPublic: true }],
        order,
      }),
      user
        ? this.entityReviewsService.getUserReviews({
            entityType: ReviewDomainsEnum.COMMERCE,
            userId: user.id,
          })
        : Promise.resolve<Review[]>([]),
    ]);

    let sortedCommerces = commerces;
    if (shouldRandomize) {
      sortedCommerces = commerces.sort(() => Math.random() - 0.5);
    }

    // Batch-load translations once for all commerces (N+1 guard — zero AI at request time)
    let translationsMap: Map<string, Record<string, string>> = new Map();
    if (locale !== 'es' && sortedCommerces.length) {
      translationsMap = await this.translationResolver.batchLoad('commerce', sortedCommerces.map(c => c.id), locale);
    }

    return sortedCommerces.map(commerce => {
      const userReview = userReviews.find(r => r.commerce?.id === commerce.id);
      const base =
        locale !== 'es'
          ? this.translationResolver.overlay({ ...commerce }, translationsMap.get(commerce.id) ?? {})
          : commerce;
      return new CommerceIndexDto(base as Commerce, userReview?.id);
    });
  }

  async findOne(id: string, user?: User) {
    const commerce = await this.commerceRepository.findOne({
      where: { id },
      relations: {
        town: { department: true },
        categories: { icon: true },
        images: { imageResource: true },
        facilities: { icon: true },
        products: { images: { imageResource: true } },
        user: true,
      },
      order: {
        images: { order: 'ASC' },
        products: { order: 'ASC', images: { order: 'ASC' } },
      },
    });

    if (!commerce) throw new NotFoundException(`Commerce with id ${id} not found`);

    const dto = new CommerceFullDto(commerce);

    // Enrich for owner OR super admin so admin review screens see the same percentages.
    const isOwner = !!user && commerce.user?.id === user.id;
    if (isOwner || user?.isSuperUser) {
      await this.applyOwnerEnrichment(dto, commerce);
    }

    return dto;
  }

  // ------------------------------------------------------------------------------------------------
  // Resolve the 3-indicator context (T&C + docs) for the owner of this commerce.
  // Mirror of LodgingsService.resolveOwnerCompletionContext.
  // ------------------------------------------------------------------------------------------------
  async resolveOwnerCompletionContext(
    commerce: Commerce,
  ): Promise<{ termsStatus: CommerceTermsStatus; docsStatus: CommerceDocsStatus }> {
    const userId = commerce.user?.id;
    const townId = commerce.town?.id;
    const categoryIds = commerce.categories?.map(c => c.id) ?? [];

    const [termsDto, docsList] = await Promise.all([
      userId ? this.termsService.getStatusForUser(userId) : Promise.resolve(null),
      townId
        ? this.documentService.getEntityDocumentStatus(townId, DocumentEntityType.COMMERCE, commerce.id, categoryIds)
        : Promise.resolve([]),
    ]);

    // See LodgingsService.resolveOwnerCompletionContext — same enforcement-flag honesty.
    const activeTermsId = termsDto?.activeDocumentIds?.commerce ?? null;
    const termsStatus = isTermsEnforcementEnabled()
      ? computeCommerceTermsStatus({
          hasActiveCommerceTerms: activeTermsId !== null,
          hasAcceptedCommerceTerms: termsDto?.hasAcceptedCommerceTerms ?? false,
          activeTermsId,
        })
      : { state: 'no_aplica' as const, activeTermsId: null };
    const docsStatus = computeCommerceDocsStatus(
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
  // Populate the owner-scoped fields on a CommerceFullDto. Mirror of LodgingsService.applyOwnerEnrichment.
  // ------------------------------------------------------------------------------------------------
  private async applyOwnerEnrichment(dto: CommerceFullDto, commerce: Commerce): Promise<void> {
    const context = await this.resolveOwnerCompletionContext(commerce);
    const result = computeCommerceCompletion(commerce, context);
    dto.status = commerce.status;
    dto.completionPercentage = result.completionPercentage;
    dto.missingFields = result.missingFields;
    dto.infoPercentage = result.infoPercentage;
    dto.infoMissingFields = result.infoMissingFields;
    dto.infoCriticalSatisfied = result.infoCriticalSatisfied;
    dto.termsStatus = result.termsStatus;
    dto.docsStatus = result.docsStatus;
    dto.readyToSubmit = result.readyToSubmit;
    dto.submittedAt = commerce.submittedAt;
    dto.rejectionReason = commerce.rejectionReason;
  }

  // ------------------------------------------------------------------------------------------------
  // Submit commerce for review (owner action). Mirror of LodgingsService.submitForReview.
  // Three independent gates with distinct errorCodes (INCOMPLETE / TERMS_NOT_ACCEPTED / DOCS_INCOMPLETE).
  // ------------------------------------------------------------------------------------------------
  async submitForReview({ identifier, user }: { identifier: string; user: User }) {
    const relations: FindOptionsRelations<Commerce> = {
      user: true,
      categories: { icon: true },
      facilities: { icon: true },
      town: { department: true },
      images: { imageResource: true },
      products: { images: { imageResource: true } },
    };

    const commerce = await this.commerceRepository.findOne({ where: { id: identifier }, relations });
    if (!commerce) throw new NotFoundException('Commerce not found');

    if (commerce.user?.id !== user.id) {
      throw new ForbiddenException('Not your commerce');
    }

    if (commerce.status !== 'draft' && commerce.status !== 'rejected') {
      throw new BadRequestException({
        message: 'INVALID_STATUS',
        detail: 'Only draft or rejected commerces can be submitted',
      });
    }

    const context = await this.resolveOwnerCompletionContext(commerce);
    const completion = computeCommerceCompletion(commerce, context);

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
        termsType: 'commerce',
        activeTermsId: context.termsStatus.activeTermsId ?? null,
      });
    }

    if (context.docsStatus.state === 'incompletos') {
      throw new BadRequestException({
        errorCode: 'DOCS_INCOMPLETE',
        docsStatus: context.docsStatus,
      });
    }

    commerce.status = 'pending_review';
    commerce.submittedAt = new Date();
    commerce.rejectionReason = null;
    await this.commerceRepository.save(commerce);

    const updated = await this.commerceRepository.findOne({ where: { id: commerce.id }, relations });
    if (!updated) throw new NotFoundException('Commerce not found after update');
    const dto = new CommerceFullDto(updated);
    await this.applyOwnerEnrichment(dto, updated);
    return dto;
  }

  // ------------------------------------------------------------------------------------------------
  // Approve commerce (admin action). Mirror of LodgingsService.approve.
  // ------------------------------------------------------------------------------------------------
  async approve({ identifier }: { identifier: string }): Promise<CommerceFullDto> {
    const relations: FindOptionsRelations<Commerce> = {
      user: true,
      categories: { icon: true },
      facilities: { icon: true },
      town: { department: true },
      images: { imageResource: true },
      products: { images: { imageResource: true } },
    };
    const commerce = await this.commerceRepository.findOne({ where: { id: identifier }, relations });
    if (!commerce) throw new NotFoundException('Commerce not found');

    if (commerce.status !== 'pending_review') {
      throw new BadRequestException({
        message: 'Only pending_review commerces can be approved',
        currentStatus: commerce.status,
      });
    }

    commerce.status = 'published';
    commerce.rejectionReason = null;
    await this.commerceRepository.save(commerce);

    const updated = await this.commerceRepository.findOne({ where: { id: commerce.id }, relations });
    if (!updated) throw new NotFoundException('Commerce not found after update');
    const dto = new CommerceFullDto(updated);
    await this.applyOwnerEnrichment(dto, updated);
    return dto;
  }

  // ------------------------------------------------------------------------------------------------
  // Reject commerce (admin action). Mirror of LodgingsService.reject.
  // ------------------------------------------------------------------------------------------------
  async reject({ identifier, reason }: { identifier: string; reason: string }): Promise<CommerceFullDto> {
    const relations: FindOptionsRelations<Commerce> = {
      user: true,
      categories: { icon: true },
      facilities: { icon: true },
      town: { department: true },
      images: { imageResource: true },
      products: { images: { imageResource: true } },
    };
    const commerce = await this.commerceRepository.findOne({ where: { id: identifier }, relations });
    if (!commerce) throw new NotFoundException('Commerce not found');

    if (commerce.status !== 'pending_review') {
      throw new BadRequestException({
        message: 'Only pending_review commerces can be rejected',
        currentStatus: commerce.status,
      });
    }

    commerce.status = 'rejected';
    commerce.rejectionReason = reason;
    await this.commerceRepository.save(commerce);

    const updated = await this.commerceRepository.findOne({ where: { id: commerce.id }, relations });
    if (!updated) throw new NotFoundException('Commerce not found after update');
    const dto = new CommerceFullDto(updated);
    await this.applyOwnerEnrichment(dto, updated);
    return dto;
  }

  // ------------------------------------------------------------------------------------------------
  // Find one commerce by slug
  // ------------------------------------------------------------------------------------------------
  async findOneBySlug({ slug, user, locale = 'es' }: { slug: string; user?: User; locale?: string }) {
    const relations: FindOptionsRelations<Commerce> = {
      categories: { icon: true },
      facilities: { icon: true },
      town: { department: true },
      images: { imageResource: true },
      products: { images: { imageResource: true } },
    };

    // Published guard — draft / pending_review / rejected commerces must not leak to public pages.
    let commerce = await this.commerceRepository.findOne({
      where: [
        { slug, status: 'published' },
        { slug, forcedPublic: true },
      ],
      relations,
      order: {
        images: { order: 'ASC' },
        products: { order: 'ASC', images: { order: 'ASC' } },
      },
    });

    if (!commerce)
      commerce = await this.commerceRepository.findOne({ where: { slug, status: 'published' }, relations });
    if (!commerce) throw new NotFoundException('Commerce not found');

    // Obtener review del usuario
    const userReview = user
      ? await this.entityReviewsService.findUserReview({
          entityType: ReviewDomainsEnum.COMMERCE,
          entityId: commerce.id,
          userId: user.id,
        })
      : null;

    // Load and overlay translations for the requested locale (zero AI at request time)
    const base =
      locale !== 'es'
        ? this.translationResolver.overlay(
            { ...commerce },
            await this.translationResolver.load('commerce', commerce.id, locale),
          )
        : commerce;

    return new CommerceFullDto(base as Commerce, userReview?.id);
  }

  // ------------------------------------------------------------------------------------------------
  // Create commerce
  // ------------------------------------------------------------------------------------------------
  async create(createCommerceDto: CreateCommerceDto, userId: string) {
    const { latitude, longitude, ...restCreateDto } = createCommerceDto;
    const restaurantLocation: Point | null =
      latitude && longitude
        ? {
            type: 'Point',
            coordinates: [Number(longitude), Number(latitude)],
          }
        : null;

    const categories = createCommerceDto.categoryIds
      ? await this.categoryRepository.findBy({ id: In(createCommerceDto.categoryIds) })
      : [];
    const facilities = createCommerceDto.facilityIds
      ? await this.facilityRepository.findBy({ id: In(createCommerceDto.facilityIds) })
      : [];
    const town = await this.townRepository.findOne({ where: { id: createCommerceDto.townId } });
    // Usar userId del JWT, no del DTO (seguridad)
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!town) {
      throw new NotFoundException('Town not found');
    }
    try {
      // Save, then re-hydrate via findOne so the response shape matches the FE
      // adapter (CommerceFullDto with town + categories + relations) and the
      // onboarding flow can route to /profile/commerce/:id/edit immediately
      // — no slug fallback dance.
      const saved = await this.commerceRepository.save({
        ...restCreateDto,
        location: restaurantLocation ?? undefined,
        categories,
        facilities,
        town: town ?? undefined,
        user,
      });

      return await this.findOne(saved.id, user);
    } catch (error) {
      throw new BadRequestException(`Error creating commerce: ${error.message}`);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Update commerce
  // ------------------------------------------------------------------------------------------------
  async update(id: string, updateCommerceDto: UpdateCommerceDto) {
    const commerce = await this.commerceRepository.findOne({
      where: { id },
      relations: ['town'], // Load town relation to preserve it if not updated
    });
    if (!commerce) throw new NotFoundException('Commerce not found');

    // PATCH semantics: when a relation array is omitted from the body, leave the
    // existing relation untouched. Use `undefined` as the sentinel — the `categories`
    // / `facilities` keys are spread conditionally into the save call below.
    const categories =
      updateCommerceDto.categoryIds !== undefined
        ? await this.categoryRepository.findBy({ id: In(updateCommerceDto.categoryIds) })
        : undefined;
    const facilities =
      updateCommerceDto.facilityIds !== undefined
        ? await this.facilityRepository.findBy({ id: In(updateCommerceDto.facilityIds) })
        : undefined;

    // Preserve current town by default; only override when townId is provided
    let town = commerce.town;
    if (updateCommerceDto.townId) {
      const foundTown = await this.townRepository.findOne({
        where: { id: updateCommerceDto.townId },
      });
      if (!foundTown) {
        throw new NotFoundException(`Town with ID ${updateCommerceDto.townId} not found`);
      }
      town = foundTown;
    }

    // Note: commerceProducts is extracted but ignored — products are now managed
    // independently via CommerceProductsController
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { latitude, longitude, commerceProducts: _commerceProducts, ...restUpdateDto } = updateCommerceDto;
    // PATCH semantics: only build a new Point when BOTH coords were provided.
    // Otherwise leave the location relation untouched (undefined → omitted in save).
    const commerceLocation =
      latitude !== undefined && longitude !== undefined && latitude !== null && longitude !== null
        ? ({
            type: 'Point',
            coordinates: [Number(longitude), Number(latitude)],
          } as Point)
        : undefined;

    // Conditional spread: only include relations when the caller actually sent
    // them. Otherwise TypeORM's save would persist the resolved [] and wipe the
    // existing relation (the bug this block fixes).
    await this.commerceRepository.save({
      id: commerce.id,
      ...restUpdateDto,
      ...(commerceLocation !== undefined && { location: commerceLocation }),
      ...(categories !== undefined && { categories }),
      ...(facilities !== undefined && { facilities }),
      town,
    });

    const relations: FindOptionsRelations<Commerce> = {
      categories: { icon: true },
      facilities: { icon: true },
      town: { department: true },
      images: { imageResource: true },
    };

    const updatedCommerce = await this.commerceRepository.findOne({
      where: { id },
      relations,
      order: { images: { order: 'ASC' } },
    });

    if (!updatedCommerce) throw new NotFoundException('Commerce not found');
    return { message: updatedCommerce.name };
  }

  // ------------------------------------------------------------------------------------------------
  // Delete commerce
  // ------------------------------------------------------------------------------------------------
  async delete(id: string) {
    const commerce = await this.commerceRepository.findOne({
      where: { id },
      relations: {
        images: {
          imageResource: true,
        },
      },
    });

    if (!commerce) throw new NotFoundException('Commerce not found');

    try {
      // Delete everything in a single transaction
      await this.commerceRepository.manager.transaction(async manager => {
        if (commerce.images && commerce.images.length > 0) {
          // 1. Delete images from Cloudinary
          await Promise.all(
            commerce.images.map(image =>
              image.imageResource.publicId
                ? this.cloudinaryService.destroyFile(image.imageResource.publicId)
                : Promise.resolve(),
            ),
          );

          // 2. Delete RestaurantImage first
          await manager.delete(
            CommerceImage,
            commerce.images.map(image => image.id),
          );

          // 3. Delete ImageResource
          await manager.delete(
            ImageResource,
            commerce.images.map(image => image.imageResource.id),
          );
        }

        // 4. Finally delete the restaurant
        await manager.delete(Commerce, { id: commerce.id });
      });

      // After all database operations complete, delete the folder
      try {
        await this.cloudinaryService.destroyFolder(`${CLOUDINARY_FOLDERS.RESTAURANT_GALLERY}/${commerce.slug}`);
      } catch (folderError) {
        console.warn(`Could not delete Cloudinary folder for restaurant ${commerce.slug}:`, folderError);
        // Continue with the process, as the main deletion was successful
      }

      return { message: 'Commerce deleted successfully' };
    } catch (error) {
      throw new BadRequestException(`Error deleting commerce: ${error.message}`);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Bulk delete commerces (admin)
  // ------------------------------------------------------------------------------------------------
  async bulkDelete(ids: string[]): Promise<{ deleted: number }> {
    if (!ids?.length) return { deleted: 0 };
    let deleted = 0;
    for (const id of ids) {
      try {
        await this.delete(id);
        deleted += 1;
      } catch (err) {
        console.error(`(CommerceService.bulkDelete): failed to delete ${id}`, err);
      }
    }
    return { deleted };
  }

  // ------------------------------------------------------------------------------------------------
  // Upload images
  // ------------------------------------------------------------------------------------------------
  async uploadImages(id: string, files: Express.Multer.File[]) {
    const commerce = await this.commerceRepository.findOne({
      where: { id },
      relations: { images: { imageResource: true } },
    });

    if (!commerce) throw new NotFoundException('Commerce not found');

    try {
      // Process each file in the array
      const uploadPromises = files.map(async (file, index) => {
        // Upload the image to Cloudinary
        const cloudinaryRes = await this.cloudinaryService.uploadImage({
          file,
          fileName: commerce.name,
          preset: CloudinaryPresets.RESTAURANT_IMAGE,
          folder: `${CLOUDINARY_FOLDERS.RESTAURANT_GALLERY}/${commerce.slug}`,
        });

        if (!cloudinaryRes) throw new BadRequestException('Error uploading image');

        // Create and save the image resource
        const imageResource = await this.commerceRepository.manager.create(ImageResource, {
          publicId: cloudinaryRes.publicId,
          url: cloudinaryRes.url,
          fileName: commerce.name,
          width: cloudinaryRes.width,
          height: cloudinaryRes.height,
          format: cloudinaryRes.format,
          resourceType: cloudinaryRes.type,
          provider: ResourceProvider.Cloudinary,
        });

        await this.commerceRepository.manager.save(ImageResource, imageResource);

        // Create and save the restaurant image association
        const commerceImage = await this.commerceRepository.manager.create(CommerceImage, {
          imageResource,
          order: (commerce.images?.length || 0) + index + 1,
          commerce: { id: commerce.id },
        });

        await this.commerceRepository.manager.save(CommerceImage, commerceImage);
      });

      // Wait for all uploads to complete
      await Promise.all(uploadPromises);

      return this.findOne(commerce.id);
    } catch (error) {
      throw error;
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Get images
  // ------------------------------------------------------------------------------------------------
  async getImages(id: string) {
    const commerce = await this.commerceRepository.findOne({
      where: [{ id }],
      relations: {
        images: {
          imageResource: true,
        },
      },
    });

    if (!commerce) throw new NotFoundException('Commerce not found');

    return commerce.images?.sort((a, b) => a.order - b.order);
  }

  // ------------------------------------------------------------------------------------------------
  // Delete image
  // ------------------------------------------------------------------------------------------------
  async deleteImage(id: string, imageId: string) {
    const commerce = await this.commerceRepository.findOne({
      where: [{ id }],
      relations: {
        images: {
          imageResource: true,
        },
      },
    });

    if (!commerce) throw new NotFoundException('Commerce not found');

    const image = commerce.images?.find(img => img.id === imageId);
    if (!image) throw new NotFoundException('Image not found');

    try {
      // Delete from Cloudinary
      if (image.imageResource.publicId) {
        await this.cloudinaryService.destroyFile(image.imageResource.publicId);
      }

      // Delete from database
      await this.commerceRepository.manager.remove(image);

      // Reorder remaining images
      const remainingImages = commerce.images
        ?.filter(img => img.id !== imageId && img.id != undefined)
        .sort((a, b) => a.order - b.order);
      if (remainingImages?.length) {
        await Promise.all(
          remainingImages.map((img, index) =>
            this.commerceRepository.manager.update(CommerceImage, img.id, {
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
    const commerce = await this.commerceRepository.findOne({ where: { id: identifier } });
    if (!commerce) throw new NotFoundException('Commerce not found');

    const { newOrder } = reorderImagesDto;
    await Promise.all(
      newOrder.map(({ id, order }) => this.commerceRepository.manager.update(CommerceImage, id, { order })),
    );

    return { message: 'Images reordered successfully' };
  }

  // ------------------------------------------------------------------------------------------------
  // Update user in lodging
  // ------------------------------------------------------------------------------------------------
  async updateUser(identifier: string, userId: string) {
    const commerce = await this.commerceRepository.findOne({ where: { id: identifier } });
    if (!commerce) throw new NotFoundException('Commerce not found');

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    commerce.user = user;
    await this.commerceRepository.save(commerce);

    return user;
  }

  // ------------------------------------------------------------------------------------------------
  // Update visibility
  // ------------------------------------------------------------------------------------------------
  async updateVisibility(identifier: string, isPublic: boolean) {
    const commerce = await this.commerceRepository.findOne({ where: { id: identifier } });

    if (!commerce) throw new NotFoundException('Commerce not found');
    commerce.isPublic = isPublic;
    await this.commerceRepository.save(commerce);
    return { message: 'Commerce visibility updated', data: isPublic };
  }

  // ------------------------------------------------------------------------------------------------
  // Update show google maps reviews
  // ------------------------------------------------------------------------------------------------
  async updateShowGoogleMapsReviews(identifier: string, showGoogleMapsReviews: boolean) {
    const commerce = await this.commerceRepository.findOne({ where: { id: identifier } });
    if (!commerce) throw new NotFoundException('Commerce not found');
    commerce.showGoogleMapsReviews = showGoogleMapsReviews;
    await this.commerceRepository.save(commerce);
    return { message: 'Commerce Google Maps Reviews visibility updated', data: showGoogleMapsReviews };
  }
}
