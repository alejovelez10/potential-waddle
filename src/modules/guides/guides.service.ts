import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateGuideDto } from './dto/create-guide.dto';
import { UpdateGuideDto } from './dto/update-guide.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsRelations, In, Repository } from 'typeorm';
import { Guide } from './entities/guide.entity';
import { Category, ImageResource } from '../core/entities';
import { User } from '../users/entities';
import { Town } from '../towns/entities/town.entity';
import { GuideFindAllParams } from './interfaces/guide-find-all-params.interface';
import { GuidesListDto } from './dto/guides-list.dto';
import { GuidesFiltersDto } from './dto/guides-filters.dto';
import { GuideDto } from './dto/guide.dto';
import { AdminGuidesFiltersDto } from './dto/admin-guides-filters.dto';
import { AdminGuidesListDto } from './dto/admin-guides-list.dto';
import { generateGuideQueryFilters } from './utils/generate-guides-query-filters';
import { UserDto } from '../users/dto/user.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { GuideImage } from './entities/guide-image.entity';
import { ReorderImagesDto } from '../common/dto/reoder-images.dto';
import { ResourceProvider } from 'src/config/resource-provider.enum';
import { CloudinaryPresets } from 'src/config';
import { CLOUDINARY_FOLDERS } from 'src/config/cloudinary-folders';
import { GuideVectorDto } from './dto/guide-vector.dto';
import { EntityReviewsService } from '../reviews/services/entity-reviews.service';
import { ReviewDomainsEnum } from '../reviews/enums';
import { Review } from '../reviews/entities';
import { TermsService } from '../terms/services';
import { TermsTypeEnum } from '../terms/interfaces';
import { isTermsEnforcementEnabled } from '../terms/utils';
import { DocumentService } from '../documents/services';
import { DocumentEntityType } from '../documents/enums';
import { SubscriptionsService } from '../subscriptions/services';
import {
  computeGuideCompletion,
  computeGuideTermsStatus,
  computeGuideDocsStatus,
  GuideTermsStatus,
  GuideDocsStatus,
} from './utils/compute-guide-completion';

@Injectable()
export class GuidesService {
  constructor(
    @InjectRepository(Guide)
    private readonly guideRepository: Repository<Guide>,

    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(Town)
    private readonly townRepo: Repository<Town>,

    private readonly cloudinaryService: CloudinaryService,
    private readonly entityReviewsService: EntityReviewsService,
    private readonly termsService: TermsService,
    private readonly documentService: DocumentService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  // ------------------------------------------------------------------------------------------------
  // Create guide
  // ------------------------------------------------------------------------------------------------
  async create(createGuideDto: CreateGuideDto, userId: string) {
    const { categories, townIds, ...restDto } = createGuideDto;
    const categoriesEntities = categories ? await this.categoryRepo.findBy({ id: In(categories) }) : [];
    const townsEntities = townIds ? await this.townRepo.findBy({ id: In(townIds) }) : [];
    // Usar userId del JWT, no del DTO (seguridad)
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    const guide = this.guideRepository.create({
      ...restDto,
      categories: categoriesEntities,
      towns: townsEntities,
      user,
      // Explícito porque la columna DB heredada tiene default=false; alinear
      // con lodging/restaurant/commerce/transport que arrancan public=true.
      isPublic: true,
    });

    return await this.guideRepository.save(guide);
  }

  async findAll({ filters }: GuideFindAllParams = {}): Promise<GuidesListDto> {
    const { page = 1, limit = 25 } = filters ?? {};
    const skip = (page - 1) * limit;
    const { where, order } = generateGuideQueryFilters(filters);

    // 3-state gating: status='published' + isPublic=true + active subscription.
    const subscribedIds = await this.subscriptionsService.getActiveSubscribedEntityIds('guide');
    if (subscribedIds.length === 0) {
      return new GuidesListDto({ currentPage: page, pages: 0, count: 0 }, []);
    }

    const relations: FindOptionsRelations<Guide> = {
      categories: { icon: true },
      images: { imageResource: true },
      user: true,
      towns: { department: true },
    };

    const [guides, count] = await this.guideRepository.findAndCount({
      skip,
      take: limit,
      relations,
      order,
      where: { ...where, id: In(subscribedIds), status: 'published', isPublic: true },
    });

    return new GuidesListDto({ currentPage: page, pages: Math.ceil(count / limit), count }, guides);
  }

  // ------------------------------------------------------------------------------------------------
  // Find all guides paginated (Admin)
  // ------------------------------------------------------------------------------------------------
  async findAllPaginated(filters: AdminGuidesFiltersDto): Promise<AdminGuidesListDto> {
    const {
      page = 1,
      limit = 10,
      search,
      categoryId,
      townId,
      isPublic,
      status,
      sortBy = 'firstName',
      sortOrder = 'ASC',
    } = filters;

    const queryBuilder = this.guideRepository
      .createQueryBuilder('guide')
      .leftJoinAndSelect('guide.towns', 'towns')
      .leftJoinAndSelect('guide.categories', 'categories')
      .leftJoinAndSelect('categories.icon', 'categoryIcon')
      .leftJoinAndSelect('guide.images', 'images')
      .leftJoinAndSelect('images.imageResource', 'imageResource')
      .leftJoinAndSelect('guide.user', 'user');

    if (search) {
      queryBuilder.andWhere('(guide.firstName ILIKE :search OR guide.lastName ILIKE :search)', {
        search: `%${search}%`,
      });
    }

    if (categoryId) {
      queryBuilder.andWhere('categories.id = :categoryId', { categoryId });
    }

    if (townId) {
      queryBuilder.andWhere('towns.id = :townId', { townId });
    }

    if (isPublic !== undefined) {
      queryBuilder.andWhere('guide.isPublic = :isPublic', { isPublic });
    }

    if (status) {
      queryBuilder.andWhere('guide.status = :status', { status });
    }

    // Sorting
    const validSortFields = ['firstName', 'lastName', 'points', 'rating', 'createdAt', 'updatedAt'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'firstName';
    queryBuilder.orderBy(`guide.${sortField}`, sortOrder);

    // Pagination
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    const [guides, count] = await queryBuilder.getManyAndCount();
    const pages = Math.ceil(count / limit);

    const result = new AdminGuidesListDto({ currentPage: page, pages, count }, guides);

    // Admin-only enrichment: per-row T&C acceptance flag for the owner
    const ownerIds = Array.from(new Set(guides.map(g => g.user?.id).filter((id): id is string => !!id)));
    const ownersWithAcceptance = await this.termsService.getOwnersWithAcceptance(TermsTypeEnum.Guide, ownerIds);
    result.data.forEach((dto, i) => {
      const ownerId = guides[i].user?.id;
      dto.ownerHasAcceptedTerms = ownerId ? ownersWithAcceptance.has(ownerId) : false;
    });

    // Per-row completion enrichment so the admin list mirrors the owner-side wizard.
    await Promise.all(
      result.data.map(async (dto, i) => {
        const guide = guides[i];
        const context = await this.resolveOwnerCompletionContext(guide);
        const completion = computeGuideCompletion(guide, context);
        dto.completionPercentage = completion.completionPercentage;
        dto.infoPercentage = completion.infoPercentage;
      }),
    );

    return result;
  }

  async findPublicGuides({ filters, user }: GuideFindAllParams = {}) {
    const shouldRandomize = filters?.sortBy === 'random';
    const { page = 1, limit = 25 } = filters ?? {};
    const skip = (page - 1) * limit;
    const { where, order } = generateGuideQueryFilters(filters);

    const subscribedIds = await this.subscriptionsService.getActiveSubscribedEntityIds('guide');
    // Sin early-return: aunque no haya suscripciones, los forced_public deben mostrarse.

    const relations: FindOptionsRelations<Guide> = {
      categories: { icon: true },
      images: { imageResource: true },
      user: true,
      towns: { department: true },
    };

    // Obtener guides y reviews del usuario en paralelo
    const [result, userReviews] = await Promise.all([
      this.guideRepository.findAndCount({
        skip,
        take: limit,
        relations,
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
            entityType: ReviewDomainsEnum.GUIDES,
            userId: user.id,
          })
        : Promise.resolve<Review[]>([]),
    ]);

    const [_guides, count] = result;
    const guides = _guides;

    if (shouldRandomize) {
      // Fisher-Yates shuffle algorithm for better randomization
      for (let i = guides.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [guides[i], guides[j]] = [guides[j], guides[i]];
      }
    }

    return {
      currentPage: page,
      pages: Math.ceil(count / limit),
      count,
      data: guides.map(guide => {
        const userReview = userReviews.find(r => r.guide?.id === guide.id);
        return new GuideDto({ data: guide, userReview: userReview?.id });
      }),
    };
  }

  async findPublicFullInfoGuides(filters: GuidesFiltersDto = {}): Promise<GuideVectorDto[]> {
    const { where, order } = generateGuideQueryFilters(filters);

    const subscribedIds = await this.subscriptionsService.getActiveSubscribedEntityIds('guide');
    if (subscribedIds.length === 0) return [];

    const relations: FindOptionsRelations<Guide> = {
      categories: { icon: true },
      images: { imageResource: true },
      // reviewer `user` is loaded ONLY to derive a safe display name in the DTO; never serialized.
      reviews: { user: true },
      towns: { department: true },
      experiences: {
        images: { imageResource: true },
        categories: { icon: true },
      },
    };

    const guides = await this.guideRepository.find({
      relations,
      order,
      where: {
        ...where,
        isPublic: true,
        status: 'published',
        id: In(subscribedIds),
      },
    });

    return guides.map(guide => new GuideVectorDto({ data: guide }));
  }

  // ------------------------------------------------------------------------------------------------
  // Find one guide
  // ------------------------------------------------------------------------------------------------
  async findOne({ identifier, user }: { identifier: string; user?: User }) {
    const relations: FindOptionsRelations<Guide> = {
      categories: { icon: true },
      user: true,
      images: { imageResource: true },
      towns: { department: true },
      experiences: {
        images: { imageResource: true },
        categories: { icon: true },
      },
    };

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

    let guide = isUuid ? await this.guideRepository.findOne({ where: { id: identifier }, relations }) : null;
    if (!guide) {
      guide = await this.guideRepository.findOne({ where: { slug: identifier }, relations });
    }
    if (!guide) throw new NotFoundException('Guide not found');

    const isOwner = !!user && guide.user?.id === user.id;
    if (!isOwner && guide.experiences) {
      guide.experiences = guide.experiences.filter(e => e.isPublic);
    }

    const userReview = user
      ? await this.entityReviewsService.findUserReview({
          entityType: ReviewDomainsEnum.GUIDES,
          entityId: guide.id,
          userId: user.id,
        })
      : null;

    const dto = new GuideDto({ data: guide, userReview: userReview?.id });

    // Enrich with completion fields for the owner (their wizard) and for super admins
    // (so the admin review screens see the same percentages the owner sees).
    if (isOwner || user?.isSuperUser) {
      await this.applyOwnerEnrichment(dto, guide);
    }

    return dto;
  }

  async findOneById(id: string, user?: User) {
    const relations: FindOptionsRelations<Guide> = {
      categories: { icon: true },
      user: true,
      images: { imageResource: true },
      towns: { department: true },
      experiences: {
        images: { imageResource: true },
        categories: { icon: true },
      },
    };

    const guide = await this.guideRepository.findOne({
      where: {
        id,
        experiences: { isPublic: true },
      },
      relations,
    });
    if (!guide) throw new NotFoundException('Guide not found');

    // Obtener review del usuario
    const userReview = user
      ? await this.entityReviewsService.findUserReview({
          entityType: ReviewDomainsEnum.GUIDES,
          entityId: guide.id,
          userId: user.id,
        })
      : null;

    return new GuideDto({ data: guide, userReview: userReview?.id });
  }

  // ------------------------------------------------------------------------------------------------
  // Update guide
  // ------------------------------------------------------------------------------------------------
  async update(identifier: string, updateGuideDto: UpdateGuideDto) {
    const { categories, userId, townIds, ...restDto } = updateGuideDto;
    // Solo resolver entities si el PATCH realmente trae el campo — undefined
    // significa "no tocar", para no destruir relaciones al guardar otros steps.
    const categoriesEntities = categories ? await this.categoryRepo.findBy({ id: In(categories) }) : undefined;
    const townsEntities = townIds ? await this.townRepo.findBy({ id: In(townIds) }) : undefined;
    const user = userId ? await this.userRepo.findOneBy({ id: userId }) : undefined;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
    let guide = isUuid ? await this.guideRepository.findOne({ where: { id: identifier } }) : null;
    if (!guide) guide = await this.guideRepository.findOne({ where: { slug: identifier } });
    if (!guide) throw new NotFoundException('Guide not found');

    const updatedGuide = await this.guideRepository.save({
      ...guide,
      ...restDto,
      ...(categoriesEntities !== undefined && { categories: categoriesEntities }),
      ...(townsEntities !== undefined && { towns: townsEntities }),
      user: user || undefined,
    });

    return new UserDto(updatedGuide.user);
  }

  // ------------------------------------------------------------------------------------------------
  // Delete guide
  // ------------------------------------------------------------------------------------------------
  async remove(id: string) {
    const guide = await this.guideRepository.findOne({
      where: { id },
      relations: {
        images: {
          imageResource: true,
        },
      },
    });

    if (!guide) throw new NotFoundException('Guide not found');

    try {
      // Delete everything in a single transaction
      await this.guideRepository.manager.transaction(async manager => {
        if (guide.images && guide.images.length > 0) {
          // 1. Delete images from Cloudinary
          await Promise.all(
            guide.images.map(image =>
              image.imageResource.publicId
                ? this.cloudinaryService.destroyFile(image.imageResource.publicId)
                : Promise.resolve(),
            ),
          );

          // 2. Delete GuideImage entries first
          await manager.delete(
            GuideImage,
            guide.images.map(image => image.id),
          );

          // 3. Delete ImageResource entries
          await manager.delete(
            ImageResource,
            guide.images.map(image => image.imageResource.id),
          );
        }

        // 4. Finally delete the guide
        await manager.delete(Guide, { id: guide.id });
      });

      // After all database operations are complete, delete the folder
      try {
        await this.cloudinaryService.destroyFolder(`${CLOUDINARY_FOLDERS.GUIDE_GALLERY}/${guide.slug}`);
      } catch (folderError) {
        console.warn(`Could not delete Cloudinary folder for guide ${guide.slug}:`, folderError);
        // Continue with the process, as the main deletion was successful
      }

      return { message: 'Guide deleted successfully' };
    } catch (error) {
      throw new BadRequestException(`Error deleting guide: ${JSON.stringify(error)}`);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Bulk delete guides (admin)
  // ------------------------------------------------------------------------------------------------
  async bulkDelete(ids: string[]): Promise<{ deleted: number }> {
    if (!ids?.length) return { deleted: 0 };
    let deleted = 0;
    for (const id of ids) {
      try {
        await this.remove(id);
        deleted += 1;
      } catch (err) {
        console.error(`(GuidesService.bulkDelete): failed to delete ${id}`, err);
      }
    }
    return { deleted };
  }

  // ------------------------------------------------------------------------------------------------
  // Update guide availability
  // ------------------------------------------------------------------------------------------------
  async updateAvailability(id: string, isAvailable: boolean) {
    const guide = await this.guideRepository.findOne({ where: { id } });
    if (!guide) throw new NotFoundException('Guide not found');

    return this.guideRepository.save({
      ...guide,
      isAvailable,
    });
  }

  // ------------------------------------------------------------------------------------------------
  // Upload image
  // ------------------------------------------------------------------------------------------------
  async uploadImages(id: string, files: Express.Multer.File[]) {
    const guide = await this.guideRepository.findOne({
      where: { id },
      relations: { images: { imageResource: true } },
    });

    if (!guide) throw new NotFoundException('Guide not found');

    try {
      // Process each file in the array
      const uploadPromises = files.map(async (file, index) => {
        // Upload the image to Cloudinary
        const cloudinaryRes = await this.cloudinaryService.uploadImage({
          file,
          fileName: guide.firstName,
          preset: CloudinaryPresets.LODGING_IMAGE,
          folder: `${CLOUDINARY_FOLDERS.GUIDE_GALLERY}/${guide.slug}`,
        });

        if (!cloudinaryRes) throw new BadRequestException('Error uploading image');

        // Create and save the image resource
        const imageResource = await this.guideRepository.manager.create(ImageResource, {
          publicId: cloudinaryRes.publicId,
          url: cloudinaryRes.url,
          fileName: guide.firstName,
          width: cloudinaryRes.width,
          height: cloudinaryRes.height,
          format: cloudinaryRes.format,
          resourceType: cloudinaryRes.type,
          provider: ResourceProvider.Cloudinary,
        });

        await this.guideRepository.manager.save(ImageResource, imageResource);

        // Create and save the guide image association
        const guideImage = await this.guideRepository.manager.create(GuideImage, {
          imageResource,
          order: (guide.images || []).length + index + 1,
          guide: { id: guide.id },
        });

        await this.guideRepository.manager.save(GuideImage, guideImage);
      });

      // Wait for all uploads to complete
      await Promise.all(uploadPromises);

      return this.findOne({ identifier: guide.slug });
    } catch (error) {
      throw error;
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Get images
  // ------------------------------------------------------------------------------------------------
  async getImages(id: string) {
    const guide = await this.guideRepository.findOne({
      where: [{ id }],
      relations: {
        images: {
          imageResource: true,
        },
      },
    });

    if (!guide) throw new NotFoundException('Guide not found');

    return guide.images?.sort((a, b) => a.order - b.order);
  }

  // ------------------------------------------------------------------------------------------------
  // Delete image
  // ------------------------------------------------------------------------------------------------
  async deleteImage(id: string, imageId: string) {
    const guide = await this.guideRepository.findOne({
      where: [{ id }],
      relations: {
        images: {
          imageResource: true,
        },
      },
    });

    if (!guide) throw new NotFoundException('Guide not found');

    const image = guide.images?.find(img => img.id === imageId);
    if (!image) throw new NotFoundException('Image not found');

    try {
      // Delete from Cloudinary
      if (image.imageResource.publicId) {
        await this.cloudinaryService.destroyFile(image.imageResource.publicId);
      }

      // Delete from database
      await this.guideRepository.manager.remove(image);

      // Reorder remaining images
      const remainingImages = guide.images
        ?.filter(img => img.id !== imageId && img.id != undefined)
        .sort((a, b) => a.order - b.order);
      await Promise.all(
        remainingImages?.map((img, index) =>
          this.guideRepository.manager.update(GuideImage, img.id, {
            order: index + 1,
          }),
        ) || [],
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
    const guide = await this.guideRepository.findOne({ where: { id: identifier } });
    if (!guide) throw new NotFoundException('Guide not found');

    const { newOrder } = reorderImagesDto;
    console.log(newOrder);
    await Promise.all(newOrder.map(({ id, order }) => this.guideRepository.manager.update(GuideImage, id, { order })));

    return { message: 'Images reordered successfully' };
  }

  async findOrderedGuides({ filters }: GuideFindAllParams = {}): Promise<Guide[]> {
    const { order } = generateGuideQueryFilters(filters);

    const relations: FindOptionsRelations<Guide> = {
      categories: { icon: true },
      images: { imageResource: true },
      user: true,
      towns: { department: true },
    };

    const guides = await this.guideRepository.find({
      relations,
      order: Object.keys(order || {}).length > 0 ? order : { id: 'DESC' },
      where: {
        isPublic: true,
      },
    });

    if (Object.keys(order || {}).length === 0) {
      guides.sort(() => Math.random() - 0.5);
    }

    return guides;
  }
  // ------------------------------------------------------------------------------------------------
  // Update user in lodging
  // ------------------------------------------------------------------------------------------------
  async updateUser(identifier: string, userId: string) {
    const guide = await this.guideRepository.findOne({ where: { id: identifier } });
    if (!guide) throw new NotFoundException('Guide not found');

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    guide.user = user;
    await this.guideRepository.save(guide);

    return user;
  }

  // ------------------------------------------------------------------------------------------------
  // Update visibility
  // ------------------------------------------------------------------------------------------------
  async updateVisibility(identifier: string, isPublic: boolean) {
    const guide = await this.guideRepository.findOne({ where: { id: identifier } });

    if (!guide) {
      throw new NotFoundException('Guide not found');
    }
    guide.isPublic = isPublic;
    await this.guideRepository.save(guide);
    return { message: 'Guide visibility updated', data: isPublic };
  }

  // ------------------------------------------------------------------------------------------------
  // Resolve the 3-indicator context (T&C + docs). Mirror of RestaurantsService.resolveOwnerCompletionContext.
  // ------------------------------------------------------------------------------------------------
  async resolveOwnerCompletionContext(
    guide: Guide,
  ): Promise<{ termsStatus: GuideTermsStatus; docsStatus: GuideDocsStatus }> {
    const userId = guide.user?.id;
    // Guides are multi-town. For doc requirements we pick the first town as the reference
    // (matches the Lodging single-town pattern). Docs are still filtered by category.
    const townId = guide.towns?.[0]?.id;
    const categoryIds = guide.categories?.map(c => c.id) ?? [];

    const [termsDto, docsList] = await Promise.all([
      userId ? this.termsService.getStatusForUser(userId) : Promise.resolve(null),
      townId
        ? this.documentService.getEntityDocumentStatus(townId, DocumentEntityType.GUIDE, guide.id, categoryIds)
        : Promise.resolve([]),
    ]);

    const activeTermsId = termsDto?.activeDocumentIds?.guide ?? null;
    const termsStatus = isTermsEnforcementEnabled()
      ? computeGuideTermsStatus({
          hasActiveGuideTerms: activeTermsId !== null,
          hasAcceptedGuideTerms: termsDto?.hasAcceptedGuideTerms ?? false,
          activeTermsId,
        })
      : { state: 'no_aplica' as const, activeTermsId: null };
    const docsStatus = computeGuideDocsStatus(
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
  // Populate owner-scoped fields on a GuideDto. Mirror of RestaurantsService.applyOwnerEnrichment.
  // ------------------------------------------------------------------------------------------------
  private async applyOwnerEnrichment(dto: GuideDto, guide: Guide): Promise<void> {
    const context = await this.resolveOwnerCompletionContext(guide);
    const result = computeGuideCompletion(guide, context);
    dto.status = guide.status;
    dto.completionPercentage = result.completionPercentage;
    dto.missingFields = result.missingFields;
    dto.infoPercentage = result.infoPercentage;
    dto.infoMissingFields = result.infoMissingFields;
    dto.infoCriticalSatisfied = result.infoCriticalSatisfied;
    dto.termsStatus = result.termsStatus;
    dto.docsStatus = result.docsStatus;
    dto.readyToSubmit = result.readyToSubmit;
    dto.submittedAt = guide.submittedAt;
    dto.rejectionReason = guide.rejectionReason;
  }

  // ------------------------------------------------------------------------------------------------
  // Submit guide for review. Mirror of RestaurantsService.submitForReview with 3 gates.
  // ------------------------------------------------------------------------------------------------
  async submitForReview({ identifier, user }: { identifier: string; user: User }) {
    const relations: FindOptionsRelations<Guide> = {
      user: true,
      categories: { icon: true },
      towns: { department: true },
      images: { imageResource: true },
    };
    const guide = await this.guideRepository.findOne({ where: { id: identifier }, relations });
    if (!guide) throw new NotFoundException('Guide not found');

    if (guide.user?.id !== user.id) {
      throw new ForbiddenException('Not your guide');
    }

    if (guide.status !== 'draft' && guide.status !== 'rejected') {
      throw new BadRequestException({
        message: 'INVALID_STATUS',
        detail: 'Only draft or rejected guides can be submitted',
      });
    }

    const context = await this.resolveOwnerCompletionContext(guide);
    const completion = computeGuideCompletion(guide, context);

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
        termsType: 'guide',
        activeTermsId: context.termsStatus.activeTermsId ?? null,
      });
    }

    if (context.docsStatus.state === 'incompletos') {
      throw new BadRequestException({
        errorCode: 'DOCS_INCOMPLETE',
        docsStatus: context.docsStatus,
      });
    }

    guide.status = 'pending_review';
    guide.submittedAt = new Date();
    guide.rejectionReason = null;
    await this.guideRepository.save(guide);

    const updated = await this.guideRepository.findOne({ where: { id: guide.id }, relations });
    if (!updated) throw new NotFoundException('Guide not found after update');
    const dto = new GuideDto({ data: updated });
    await this.applyOwnerEnrichment(dto, updated);
    return dto;
  }

  // ------------------------------------------------------------------------------------------------
  // Approve guide (admin).
  // ------------------------------------------------------------------------------------------------
  async approve({ identifier }: { identifier: string }) {
    const relations: FindOptionsRelations<Guide> = {
      user: true,
      categories: { icon: true },
      towns: { department: true },
      images: { imageResource: true },
    };
    const guide = await this.guideRepository.findOne({ where: { id: identifier }, relations });
    if (!guide) throw new NotFoundException('Guide not found');

    if (guide.status !== 'pending_review') {
      throw new BadRequestException({
        message: 'Only pending_review guides can be approved',
        currentStatus: guide.status,
      });
    }

    guide.status = 'published';
    guide.rejectionReason = null;
    await this.guideRepository.save(guide);

    const updated = await this.guideRepository.findOne({ where: { id: guide.id }, relations });
    if (!updated) throw new NotFoundException('Guide not found after update');
    const dto = new GuideDto({ data: updated });
    await this.applyOwnerEnrichment(dto, updated);
    return dto;
  }

  // ------------------------------------------------------------------------------------------------
  // Reject guide (admin).
  // ------------------------------------------------------------------------------------------------
  async reject({ identifier, reason }: { identifier: string; reason: string }) {
    const relations: FindOptionsRelations<Guide> = {
      user: true,
      categories: { icon: true },
      towns: { department: true },
      images: { imageResource: true },
    };
    const guide = await this.guideRepository.findOne({ where: { id: identifier }, relations });
    if (!guide) throw new NotFoundException('Guide not found');

    if (guide.status !== 'pending_review') {
      throw new BadRequestException({
        message: 'Only pending_review guides can be rejected',
        currentStatus: guide.status,
      });
    }

    guide.status = 'rejected';
    guide.rejectionReason = reason;
    await this.guideRepository.save(guide);

    const updated = await this.guideRepository.findOne({ where: { id: guide.id }, relations });
    if (!updated) throw new NotFoundException('Guide not found after update');
    const dto = new GuideDto({ data: updated });
    await this.applyOwnerEnrichment(dto, updated);
    return dto;
  }
}
