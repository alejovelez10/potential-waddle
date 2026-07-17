import { FindOptionsRelations, In, Point, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';

import {
  AdminExperiencesFiltersDto,
  AdminExperiencesListDto,
  CreateExperienceDto,
  ExperienceDto,
  UpdateExperienceDto,
} from './dto';
import { Experience, ExperienceImage } from './entities';
import type { ExperienceFindAllParams } from './interfaces';
import { generateExperienceQueryFiltersAndSort } from './logic';
import { Facility, ImageResource } from '../core/entities';
import { Category } from '../core/entities';
import { Town } from '../towns/entities';
import { Guide } from '../guides/entities/guide.entity';
import { CLOUDINARY_FOLDERS } from 'src/config/cloudinary-folders';
import { ReorderImagesDto } from '../common/dto/reoder-images.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CloudinaryPresets } from 'src/config/cloudinary-presets.enum';
import { ResourceProvider } from 'src/config/resource-provider.enum';
import { ExperienceIndexDto } from './dto/experience-index.dto';
import { ExperienceVectorDto } from './dto/experience-vector.dto';
import { PromotionsService } from '../promotions/promotions.service';
import { EntityReviewsService } from '../reviews/services';
import { ReviewDomainsEnum } from '../reviews/enums';
import { Review } from '../reviews/entities';
import { User } from '../users/entities';
import { TermsService } from '../terms/services';
import { isTermsEnforcementEnabled } from '../terms/utils';
import { DocumentService } from '../documents/services';
import { DocumentEntityType } from '../documents/enums';
import { SubscriptionsService } from '../subscriptions/services';
import {
  computeExperienceCompletion,
  computeExperienceInfoCompletion,
  computeExperienceTermsStatus,
  computeExperienceDocsStatus,
  ExperienceTermsStatus,
  ExperienceDocsStatus,
} from './utils/compute-experience-completion';
import { TranslationResolverService } from '../translations/translation-resolver.service';

@Injectable()
export class ExperiencesService {
  constructor(
    @InjectRepository(Experience)
    private readonly experienceRepository: Repository<Experience>,

    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,

    @InjectRepository(Facility)
    private readonly facilityRepository: Repository<Facility>,

    @InjectRepository(Town)
    private readonly townRepository: Repository<Town>,

    @InjectRepository(Guide)
    private readonly guideRepository: Repository<Guide>,

    private readonly cloudinaryService: CloudinaryService,
    private readonly promotionsService: PromotionsService,
    private readonly entityReviewsService: EntityReviewsService,
    private readonly termsService: TermsService,
    private readonly documentService: DocumentService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly translationResolver: TranslationResolverService,
  ) {}

  // ------------------------------------------------------------------------------------------------
  // Find all experiences
  // ------------------------------------------------------------------------------------------------
  async findAll({ filters }: ExperienceFindAllParams = {}): Promise<ExperienceDto[]> {
    const { where, order } = generateExperienceQueryFiltersAndSort(filters);

    // Experiences inherit public gating from their parent guide. So the 3-state
    // gate runs on the GUIDE (not the experience): guide must be published,
    // isPublic=true, and subscribed. The experience itself must also be
    // status='published' + isPublic=true so the owner can hide individual
    // experiences without unpublishing the guide profile.
    const subscribedGuideIds = await this.subscriptionsService.getActiveSubscribedEntityIds('guide');
    if (subscribedGuideIds.length === 0) return [];

    const experiences = await this.experienceRepository.find({
      relations: {
        categories: { icon: true },
        images: { imageResource: true },
        town: { department: true },
        guide: true,
      },
      order,
      where: {
        ...where,
        status: 'published',
        isPublic: true,
        guide: { id: In(subscribedGuideIds), status: 'published', isPublic: true },
      },
    });

    return experiences.map(experience => new ExperienceIndexDto({ data: experience }));
  }

  // ------------------------------------------------------------------------------------------------
  // Find all experiences paginated (Admin)
  // ------------------------------------------------------------------------------------------------
  async findAllPaginated(filters: AdminExperiencesFiltersDto): Promise<AdminExperiencesListDto> {
    const {
      page = 1,
      limit = 10,
      search,
      categoryId,
      townId,
      isPublic,
      status,
      sortBy = 'title',
      sortOrder = 'ASC',
    } = filters;

    const queryBuilder = this.experienceRepository
      .createQueryBuilder('experience')
      .leftJoinAndSelect('experience.town', 'town')
      .leftJoinAndSelect('town.department', 'department')
      .leftJoinAndSelect('experience.categories', 'categories')
      .leftJoinAndSelect('categories.icon', 'categoryIcon')
      .leftJoinAndSelect('experience.images', 'images')
      .leftJoinAndSelect('images.imageResource', 'imageResource')
      .leftJoinAndSelect('experience.guide', 'guide');

    if (search) {
      queryBuilder.andWhere('experience.title ILIKE :search', { search: `%${search}%` });
    }

    if (categoryId) {
      queryBuilder.andWhere('categories.id = :categoryId', { categoryId });
    }

    if (townId) {
      queryBuilder.andWhere('town.id = :townId', { townId });
    }

    if (isPublic !== undefined) {
      queryBuilder.andWhere('experience.isPublic = :isPublic', { isPublic });
    }

    if (status) {
      queryBuilder.andWhere('experience.status = :status', { status });
    }

    // Sorting
    const validSortFields = ['title', 'points', 'rating', 'createdAt', 'updatedAt', 'price'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'title';
    queryBuilder.orderBy(`experience.${sortField}`, sortOrder);

    // Pagination
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    const [experiences, count] = await queryBuilder.getManyAndCount();
    const pages = Math.ceil(count / limit);

    const listDto = new AdminExperiencesListDto({ currentPage: page, pages, count }, experiences);
    // Popular completionPercentage por entry para que la admin list / pending
    // panel muestren el mismo valor que el owner ve en su wizard. Usamos solo
    // computeExperienceInfoCompletion (sin terms/docs context) — barato y
    // suficiente para el panel de admin.
    listDto.data.forEach((dto, i) => {
      const info = computeExperienceInfoCompletion(experiences[i]);
      dto.completionPercentage = info.infoPercentage;
    });
    return listDto;
  }

  // ------------------------------------------------------------------------------------------------
  // Find public experiences
  // ------------------------------------------------------------------------------------------------
  async findPublicExperiences({ filters, user, locale = 'es' }: ExperienceFindAllParams = {}): Promise<ExperienceDto[]> {
    const shouldRandomize = filters?.sortBy === 'random';
    const { where, order } = generateExperienceQueryFiltersAndSort(filters);

    // Gating inherits from guide: see findAll for the full reasoning.
    const subscribedGuideIds = await this.subscriptionsService.getActiveSubscribedEntityIds('guide');
    // Sin early-return: aunque no haya suscripciones, los forced_public deben mostrarse.

    // Fetch experiences and user reviews in parallel
    const [experiences, userReviews] = await Promise.all([
      this.experienceRepository.find({
        relations: {
          categories: { icon: true },
          images: { imageResource: true },
          town: { department: true },
          guide: true,
        },
        order,
        where:
          subscribedGuideIds.length > 0
            ? [
                {
                  ...where,
                  isPublic: true,
                  status: 'published',
                  guide: { id: In(subscribedGuideIds), status: 'published', isPublic: true },
                },
                { ...where, forcedPublic: true },
              ]
            : [{ ...where, forcedPublic: true }],
      }),
      user
        ? this.entityReviewsService.getUserReviews({
            entityType: ReviewDomainsEnum.EXPERIENCES,
            userId: user.id,
          })
        : Promise.resolve<Review[]>([]),
    ]);

    let sortedExperiences = experiences;
    if (shouldRandomize) {
      sortedExperiences = experiences.sort(() => Math.random() - 0.5);
    }

    // Check for active promotions for each experience
    const experiencesWithPromotions = await Promise.all(
      sortedExperiences.map(async experience => {
        const hasPromotions = await this.promotionsService.hasActivePromotions(experience.id, 'experience');
        const latestPromotion = await this.promotionsService.getLatestActivePromotion(experience.id, 'experience');
        return { experience, hasPromotions, latestPromotion };
      }),
    );

    // Batch-load translations once for all experiences (N+1 guard — zero AI at request time)
    let translationsMap: Map<string, Record<string, string>> = new Map();
    let categoryTranslations: Map<string, Record<string, string>> = new Map();
    if (locale !== 'es' && sortedExperiences.length) {
      translationsMap = await this.translationResolver.batchLoad('experience', sortedExperiences.map(e => e.id), locale);
      const categoryIds = [...new Set(sortedExperiences.flatMap(e => (e.categories ?? []).map(c => c.id)))];
      categoryTranslations = await this.translationResolver.batchLoad('category', categoryIds, locale);
    }

    return experiencesWithPromotions.map(({ experience, hasPromotions, latestPromotion }) => {
      const userReview = userReviews.find(r => r.experience?.id === experience.id);
      const base =
        locale !== 'es'
          ? this.translationResolver.overlay({ ...experience }, translationsMap.get(experience.id) ?? {})
          : experience;
      if (locale !== 'es') {
        (base as Experience).categories = this.translationResolver.overlayCollection(
          experience.categories ?? [],
          categoryTranslations,
        );
      }
      const dto = new ExperienceIndexDto({ data: base as Experience, userReview: userReview?.id });
      (dto as any).hasPromotions = hasPromotions;
      (dto as any).latestPromotionValue = latestPromotion?.value;
      return dto;
    });
  }

  // ------------------------------------------------------------------------------------------------
  // Find public experiences with full info
  // ------------------------------------------------------------------------------------------------
  async findPublicFullInfoExperiences({ filters }: ExperienceFindAllParams = {}): Promise<ExperienceVectorDto[]> {
    const shouldRandomize = filters?.sortBy === 'random';
    const { where, order } = generateExperienceQueryFiltersAndSort(filters);

    // Gating inherits from guide: see findAll for the full reasoning.
    const subscribedGuideIds = await this.subscriptionsService.getActiveSubscribedEntityIds('guide');
    if (subscribedGuideIds.length === 0) return [];

    let experiences = await this.experienceRepository.find({
      relations: {
        categories: { icon: true },
        images: { imageResource: true },
        town: { department: true },
        guide: true,
        // reviewer `user` is loaded ONLY to derive a safe display name in the DTO; never serialized.
        reviews: { user: true },
      },
      order,
      where: {
        ...where,
        isPublic: true,
        status: 'published',
        guide: { id: In(subscribedGuideIds), status: 'published', isPublic: true },
      },
    });

    if (shouldRandomize) {
      experiences = experiences.sort(() => Math.random() - 0.5);
    }
    return experiences.map(experience => new ExperienceVectorDto({ data: experience }));
  }

  // ------------------------------------------------------------------------------------------------
  // Find one experience by identifier
  // ------------------------------------------------------------------------------------------------
  async findOne(identifier: string, user?: User) {
    const experience = await this.experienceRepository.findOne({
      where: { id: identifier },
      relations: {
        categories: { icon: true },
        facilities: true,
        images: { imageResource: true },
        town: { department: true },
        guide: { user: true },
      },
      order: { images: { order: 'ASC' } },
    });

    if (!experience) throw new NotImplementedException('Experience not found');

    const dto = new ExperienceDto({ data: experience });

    // Enrich con completion fields para el owner (su wizard) y super admins.
    // Sin esto, el wizard recibe infoCriticalSatisfied=undefined → el botón
    // "Enviar a validación" queda inhabilitable. Espejo del patrón de
    // guides/restaurants/commerce.
    const isOwner = !!user && experience.guide?.user?.id === user.id;
    if (isOwner || user?.isSuperUser) {
      await this.applyOwnerEnrichment(dto, experience);
    }

    return dto;
  }

  // ------------------------------------------------------------------------------------------------
  // Find one lodging by slug
  // ------------------------------------------------------------------------------------------------
  async findOneBySlug({ slug, user, locale = 'es' }: { slug: string; user?: User; locale?: string }) {
    const relations: FindOptionsRelations<Experience> = {
      categories: { icon: true },
      facilities: { icon: true },
      town: { department: true },
      images: { imageResource: true },
      guide: { user: true },
    };

    let experience = await this.experienceRepository.findOne({
      where: { slug },
      relations,
      order: { images: { order: 'ASC' } },
    });

    if (!experience) experience = await this.experienceRepository.findOne({ where: { slug }, relations });
    if (!experience) throw new NotFoundException('Experience not found');

    // Get user review
    const userReview = user
      ? await this.entityReviewsService.findUserReview({
          entityType: ReviewDomainsEnum.EXPERIENCES,
          entityId: experience.id,
          userId: user.id,
        })
      : null;

    // Check for active promotions
    const hasPromotions = await this.promotionsService.hasActivePromotions(experience.id, 'experience');
    const latestPromotion = await this.promotionsService.getLatestActivePromotion(experience.id, 'experience');
    const activePromotions = await this.promotionsService.getActivePromotions(experience.id, 'experience');

    // Load and overlay translations for the requested locale (zero AI at request time)
    const base =
      locale !== 'es'
        ? this.translationResolver.overlay(
            { ...experience },
            await this.translationResolver.load('experience', experience.id, locale),
          )
        : experience;

    if (locale !== 'es') {
      const [categoryTranslations, facilityTranslations] = await Promise.all([
        this.translationResolver.batchLoad('category', (experience.categories ?? []).map(c => c.id), locale),
        this.translationResolver.batchLoad('facility', (experience.facilities ?? []).map(f => f.id), locale),
      ]);
      (base as Experience).categories = this.translationResolver.overlayCollection(
        experience.categories ?? [],
        categoryTranslations,
      );
      (base as Experience).facilities = this.translationResolver.overlayCollection(
        experience.facilities ?? [],
        facilityTranslations,
      );
    }

    const dto = new ExperienceDto({ data: base as Experience, userReview: userReview?.id });
    (dto as any).hasPromotions = hasPromotions;
    (dto as any).latestPromotionValue = latestPromotion?.value;
    (dto as any).activePromotions = activePromotions;

    return dto;
  }

  // ------------------------------------------------------------------------------------------------
  // Create experience
  // ------------------------------------------------------------------------------------------------
  async create(createExperienceDto: CreateExperienceDto) {
    const { departure, arrival, ...restCreateDto } = createExperienceDto;
    const arrivalLocation: Point | null =
      arrival?.latitude && arrival?.longitude
        ? {
            type: 'Point',
            coordinates: [arrival.longitude, arrival.latitude],
          }
        : null;

    const departureLocation: Point | null =
      departure?.latitude && departure?.longitude
        ? {
            type: 'Point',
            coordinates: [departure.longitude, departure.latitude],
          }
        : null;

    const departureDescription = departure?.description;
    const arrivalDescription = arrival?.description;

    const categories = createExperienceDto.categoryIds
      ? await this.categoryRepository.findBy({ id: In(createExperienceDto.categoryIds) })
      : [];
    const facilities = createExperienceDto.facilityIds
      ? await this.facilityRepository.findBy({ id: In(createExperienceDto.facilityIds) })
      : [];
    const town = await this.townRepository.findOne({ where: { id: createExperienceDto.townId } });
    const guide = await this.guideRepository.findOne({ where: { id: createExperienceDto.guideId } });

    if (!town) {
      throw new NotFoundException('Town not found');
    }
    try {
      await this.experienceRepository.save({
        ...restCreateDto,
        departureLocation: departureLocation ?? undefined,
        arrivalLocation: arrivalLocation ?? undefined,
        departureDescription,
        arrivalDescription,
        categories,
        facilities,
        town: town ?? undefined,
        guide: guide ?? undefined,
      });

      return { message: restCreateDto.title };
    } catch (error) {
      throw new BadRequestException(`Error creating experience: ${error.message}`);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Update lodging
  // ------------------------------------------------------------------------------------------------
  async update(id: string, updateExperienceDto: UpdateExperienceDto) {
    const experience = await this.experienceRepository.findOne({ where: { id } });
    if (!experience) throw new NotFoundException('Experience not found');

    // PATCH semantics: undefined = no tocar, para no destruir relaciones al
    // guardar otros steps. Mismo patrón que lodging/restaurant/commerce.
    // CRÍTICO: solo resolver guide si el patch lo trae explícitamente — un
    // findOne con id=undefined puede retornar el primer registro o desasignar
    // la relación, lo que rompe los últimos pasos del wizard.
    const guide = updateExperienceDto.guideId
      ? ((await this.guideRepository.findOne({ where: { id: updateExperienceDto.guideId } })) ?? undefined)
      : undefined;
    const town = updateExperienceDto.townId
      ? ((await this.townRepository.findOne({ where: { id: updateExperienceDto.townId } })) ?? undefined)
      : undefined;
    const categories = updateExperienceDto.categoryIds
      ? await this.categoryRepository.findBy({ id: In(updateExperienceDto.categoryIds) })
      : undefined;
    const facilities = updateExperienceDto.facilityIds
      ? await this.facilityRepository.findBy({ id: In(updateExperienceDto.facilityIds) })
      : undefined;

    // Extraer lat y lng del DTO y crear el Point
    const { departure, arrival, ...restUpdateDto } = updateExperienceDto;
    const departureLocation: Point | undefined =
      departure?.latitude && departure.longitude
        ? {
            type: 'Point',
            coordinates: [departure.longitude, departure.latitude], // GeoJSON usa [longitude, latitude]
          }
        : undefined;

    const arrivalLocation: Point | undefined =
      arrival?.latitude && arrival.longitude
        ? {
            type: 'Point',
            coordinates: [arrival.longitude, arrival.latitude], // GeoJSON usa [longitude, latitude]
          }
        : undefined;

    const departureDescription = departure?.description;
    const arrivalDescription = arrival?.description;

    await this.experienceRepository.save({
      id: experience.id,
      ...restUpdateDto,
      ...(arrivalLocation !== undefined && { arrivalLocation }),
      ...(departureLocation !== undefined && { departureLocation }),
      ...(departureDescription !== undefined && { departureDescription }),
      ...(arrivalDescription !== undefined && { arrivalDescription }),
      ...(categories !== undefined && { categories }),
      ...(guide !== undefined && { guide }),
      ...(town !== undefined && { town }),
      ...(facilities !== undefined && { facilities }),
    });

    const relations: FindOptionsRelations<Experience> = {
      categories: { icon: true },
      facilities: { icon: true },
      town: { department: true },
      images: { imageResource: true },
      guide: { user: true },
    };

    const updatedExperience = await this.experienceRepository.findOne({
      where: { id },
      relations,
      order: { images: { order: 'ASC' } },
    });

    if (!updatedExperience) throw new NotFoundException('Experience not found');
    return { message: updatedExperience.title };
    // return new ExperienceDto({ data: updatedExperience });
  }

  // ------------------------------------------------------------------------------------------------
  // Delete lodging
  // ------------------------------------------------------------------------------------------------
  async delete(id: string) {
    const experience = await this.experienceRepository.findOne({
      where: { id },
      relations: {
        images: {
          imageResource: true,
        },
      },
    });

    if (!experience) throw new NotFoundException('Experience not found');

    try {
      // Eliminar todo en una única transacción
      await this.experienceRepository.manager.transaction(async manager => {
        if (experience.images && experience.images.length > 0) {
          // 1. Eliminar imágenes de Cloudinary
          await Promise.all(
            experience.images.map(image =>
              image.imageResource.publicId
                ? this.cloudinaryService.destroyFile(image.imageResource.publicId)
                : Promise.resolve(),
            ),
          );

          // 2. Eliminar las ExperienceImage primero
          await manager.delete(
            ExperienceImage,
            experience.images.map(image => image.id),
          );

          // 3. Eliminar los ImageResource
          await manager.delete(
            ImageResource,
            experience.images.map(image => image.imageResource.id),
          );
        }

        // 4. Finalmente eliminar la experiencia
        await manager.delete(Experience, { id: experience.id });
      });

      // Después de que todas las operaciones de base de datos se completen, eliminar la carpeta
      try {
        await this.cloudinaryService.destroyFolder(`${CLOUDINARY_FOLDERS.EXPERIENCE_GALLERY}/${experience.slug}`);
      } catch (folderError) {
        console.warn(`Could not delete Cloudinary folder for experience ${experience.slug}:`, folderError);
        // Continuar con el proceso, ya que la eliminación principal fue exitosa
      }

      return { message: 'Experience deleted successfully' };
    } catch (error) {
      throw new BadRequestException(`Error deleting experience: ${error.message}`);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Bulk delete experiences (admin)
  // ------------------------------------------------------------------------------------------------
  async bulkDelete(ids: string[]): Promise<{ deleted: number }> {
    if (!ids?.length) return { deleted: 0 };
    let deleted = 0;
    for (const id of ids) {
      try {
        await this.delete(id);
        deleted += 1;
      } catch (err) {
        console.error(`(ExperiencesService.bulkDelete): failed to delete ${id}`, err);
      }
    }
    return { deleted };
  }

  // ------------------------------------------------------------------------------------------------
  // Upload image
  // ------------------------------------------------------------------------------------------------
  async uploadImages(id: string, files: Express.Multer.File[]) {
    const experience = await this.experienceRepository.findOne({
      where: { id },
      relations: { images: { imageResource: true } },
    });

    if (!experience) throw new NotFoundException('Experience not found');

    try {
      // Process each file in the array
      const uploadPromises = files.map(async (file, index) => {
        // Upload the image to Cloudinary
        const cloudinaryRes = await this.cloudinaryService.uploadImage({
          file,
          fileName: experience.title,
          preset: CloudinaryPresets.EXPERIENCE_IMAGE,
          folder: `${CLOUDINARY_FOLDERS.EXPERIENCE_GALLERY}/${experience.slug}`,
        });

        if (!cloudinaryRes) throw new BadRequestException('Error uploading image');

        // Create and save the image resource
        const imageResource = await this.experienceRepository.manager.create(ImageResource, {
          publicId: cloudinaryRes.publicId,
          url: cloudinaryRes.url,
          fileName: experience.title,
          width: cloudinaryRes.width,
          height: cloudinaryRes.height,
          format: cloudinaryRes.format,
          resourceType: cloudinaryRes.type,
          provider: ResourceProvider.Cloudinary,
        });

        await this.experienceRepository.manager.save(ImageResource, imageResource);

        // Create and save the experience image association
        const experienceImage = await this.experienceRepository.manager.create(ExperienceImage, {
          imageResource,
          order: experience.images.length + index + 1,
          experience: { id: experience.id },
        });

        await this.experienceRepository.manager.save(ExperienceImage, experienceImage);
      });

      // Wait for all uploads to complete
      await Promise.all(uploadPromises);

      return this.findOne(experience.id);
    } catch (error) {
      throw error;
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Get images
  // ------------------------------------------------------------------------------------------------
  async getImages(id: string) {
    const experience = await this.experienceRepository.findOne({
      where: [{ id }],
      relations: {
        images: {
          imageResource: true,
        },
      },
    });
    console.log('images', experience?.images.length);

    if (!experience) throw new NotFoundException('Experience not found');

    return experience.images.sort((a, b) => a.order - b.order);
  }

  // ------------------------------------------------------------------------------------------------
  // Delete image
  // ------------------------------------------------------------------------------------------------
  async deleteImage(id: string, imageId: string) {
    const experience = await this.experienceRepository.findOne({
      where: [{ id }],
      relations: {
        images: {
          imageResource: true,
        },
      },
    });

    if (!experience) throw new NotFoundException('Experience not found');

    const image = experience.images.find(img => img.id === imageId);
    if (!image) throw new NotFoundException('Image not found');

    try {
      // Delete from Cloudinary
      if (image.imageResource.publicId) {
        await this.cloudinaryService.destroyFile(image.imageResource.publicId);
      }

      // Delete from database
      await this.experienceRepository.manager.remove(image);

      // Reorder remaining images
      const remainingImages = experience.images
        .filter(img => img.id !== imageId && img.id != undefined)
        .sort((a, b) => a.order - b.order);

      await Promise.all(
        remainingImages.map((img, index) =>
          this.experienceRepository.manager.update(ExperienceImage, img.id, {
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
    const experience = await this.experienceRepository.findOne({ where: { id: identifier } });
    if (!experience) throw new NotFoundException('Experience not found');

    const { newOrder } = reorderImagesDto;
    console.log(newOrder);
    await Promise.all(
      newOrder.map(({ id, order }) => this.experienceRepository.manager.update(ExperienceImage, id, { order })),
    );

    return { message: 'Images reordered successfully' };
  }

  // ------------------------------------------------------------------------------------------------
  // Update user in lodging
  // ------------------------------------------------------------------------------------------------
  async updateGuide(identifier: string, guideId: string) {
    const experience = await this.experienceRepository.findOne({ where: { id: identifier } });
    if (!experience) throw new NotFoundException('Experience not found');

    const guide = await this.guideRepository.findOne({ where: { id: guideId } });
    if (!guide) throw new NotFoundException('Guide not found');
    experience.guide = guide;
    await this.experienceRepository.save(experience);

    return guide;
  }

  async updateVisibility(identifier: string, isPublic: boolean) {
    const experience = await this.experienceRepository.findOne({ where: { id: identifier } });

    if (!experience) {
      throw new NotFoundException('Experience not found');
    }
    experience.isPublic = isPublic;
    await this.experienceRepository.save(experience);
    return { message: 'Experience visibility updated', data: isPublic };
  }

  // ------------------------------------------------------------------------------------------------
  // Resolve the 3-indicator context (T&C + docs). Experience reuses Guide T&C semantics.
  // ------------------------------------------------------------------------------------------------
  async resolveOwnerCompletionContext(
    experience: Experience,
  ): Promise<{ termsStatus: ExperienceTermsStatus; docsStatus: ExperienceDocsStatus }> {
    const ownerId = experience.guide?.user?.id;
    const townId = experience.town?.id;
    const categoryIds = experience.categories?.map(c => c.id) ?? [];

    // Las experiencias no tienen documentos propios — los documentos los firma
    // el guía dueño (la enum `town_document_requirement_entity_type_enum` de la
    // BD no incluye 'experience'). Por eso saltamos el lookup y dejamos
    // docsList vacío → docsStatus = 'no_requeridos'.
    const _unusedDocumentEntityType = DocumentEntityType; // silencia el import si no se usa abajo
    void _unusedDocumentEntityType;
    const [termsDto, docsList] = await Promise.all([
      ownerId ? this.termsService.getStatusForUser(ownerId) : Promise.resolve(null),
      Promise.resolve([] as Awaited<ReturnType<typeof this.documentService.getEntityDocumentStatus>>),
    ]);
    void townId;
    void categoryIds;

    // Experiences reuse Guide T&C — handoff §4 product decision.
    const activeTermsId = termsDto?.activeDocumentIds?.guide ?? null;
    const termsStatus = isTermsEnforcementEnabled()
      ? computeExperienceTermsStatus({
          hasActiveGuideTerms: activeTermsId !== null,
          hasAcceptedGuideTerms: termsDto?.hasAcceptedGuideTerms ?? false,
          activeTermsId,
        })
      : { state: 'no_aplica' as const, activeTermsId: null };
    const docsStatus = computeExperienceDocsStatus(
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
  // Populate owner-scoped fields on an ExperienceDto.
  // ------------------------------------------------------------------------------------------------
  private async applyOwnerEnrichment(dto: ExperienceDto, experience: Experience): Promise<void> {
    const context = await this.resolveOwnerCompletionContext(experience);
    const result = computeExperienceCompletion(experience, context);
    dto.status = experience.status;
    dto.completionPercentage = result.completionPercentage;
    dto.missingFields = result.missingFields;
    dto.infoPercentage = result.infoPercentage;
    dto.infoMissingFields = result.infoMissingFields;
    dto.infoCriticalSatisfied = result.infoCriticalSatisfied;
    dto.termsStatus = result.termsStatus;
    dto.docsStatus = result.docsStatus;
    dto.readyToSubmit = result.readyToSubmit;
    dto.submittedAt = experience.submittedAt;
    dto.rejectionReason = experience.rejectionReason;
  }

  // ------------------------------------------------------------------------------------------------
  // Submit experience for review. Gates: info, terms, docs + guide must be 'published'.
  // ------------------------------------------------------------------------------------------------
  async submitForReview({ identifier, user }: { identifier: string; user: User }) {
    const relations: FindOptionsRelations<Experience> = {
      categories: { icon: true },
      facilities: { icon: true },
      town: { department: true },
      images: { imageResource: true },
      guide: { user: true },
    };
    const experience = await this.experienceRepository.findOne({ where: { id: identifier }, relations });
    if (!experience) throw new NotFoundException('Experience not found');

    // Fresh lookup del guide del user actual contra BD. Evita el caso en que
    // experience.guide.user no se haya hidratado bien por la relación, o que
    // el JWT/cache del request tenga info stale del guide tras una aprobación
    // reciente. El FK experience.guideId vs guide.id es la fuente de verdad.
    const ownerGuide = await this.guideRepository.findOne({
      where: { user: { id: user.id } },
      relations: { user: true },
    });
    const experienceGuideId = experience.guide?.id ?? null;
    const ownerGuideId = ownerGuide?.id ?? null;
    const userOwnsExperience =
      ownerGuideId !== null && experienceGuideId !== null && ownerGuideId === experienceGuideId;

    if (!userOwnsExperience) {
      // Debug log so we can see exactly which IDs are misaligned in the server
      // terminal. The ExceptionFilter sanitises the response body so we can't
      // bubble these to the client.
      // eslint-disable-next-line no-console
      console.error('[submitForReview] OWNERSHIP MISMATCH', {
        experienceGuideId,
        ownerGuideId,
        currentUserId: user.id,
        experienceGuideUserId: experience.guide?.user?.id ?? null,
        experienceId: experience.id,
      });
      throw new ForbiddenException('Not your experience');
    }

    // Gate: guide must be approved before an experience can be submitted.
    // Usamos el guide recién consultado en BD (no el embebido en experience)
    // para no leer un status stale.
    const liveStatus = ownerGuide?.status ?? experience.guide?.status;
    if (liveStatus !== 'published') {
      throw new ForbiddenException({
        errorCode: 'GUIDE_NOT_APPROVED',
        detail: 'Tu perfil de guía debe estar aprobado antes de enviar una experiencia',
        guideStatus: liveStatus ?? null,
      });
    }

    if (experience.status !== 'draft' && experience.status !== 'rejected') {
      throw new BadRequestException({
        message: 'INVALID_STATUS',
        detail: 'Only draft or rejected experiences can be submitted',
      });
    }

    const context = await this.resolveOwnerCompletionContext(experience);
    const completion = computeExperienceCompletion(experience, context);

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

    experience.status = 'pending_review';
    experience.submittedAt = new Date();
    experience.rejectionReason = null;
    await this.experienceRepository.save(experience);

    const updated = await this.experienceRepository.findOne({ where: { id: experience.id }, relations });
    if (!updated) throw new NotFoundException('Experience not found after update');
    const dto = new ExperienceDto({ data: updated });
    await this.applyOwnerEnrichment(dto, updated);
    return dto;
  }

  // ------------------------------------------------------------------------------------------------
  // Approve experience (admin).
  // ------------------------------------------------------------------------------------------------
  async approve({ identifier }: { identifier: string }) {
    const relations: FindOptionsRelations<Experience> = {
      categories: { icon: true },
      facilities: { icon: true },
      town: { department: true },
      images: { imageResource: true },
      guide: { user: true },
    };
    const experience = await this.experienceRepository.findOne({ where: { id: identifier }, relations });
    if (!experience) throw new NotFoundException('Experience not found');

    if (experience.status !== 'pending_review') {
      throw new BadRequestException({
        message: 'Only pending_review experiences can be approved',
        currentStatus: experience.status,
      });
    }

    experience.status = 'published';
    experience.rejectionReason = null;
    await this.experienceRepository.save(experience);

    const updated = await this.experienceRepository.findOne({ where: { id: experience.id }, relations });
    if (!updated) throw new NotFoundException('Experience not found after update');
    const dto = new ExperienceDto({ data: updated });
    await this.applyOwnerEnrichment(dto, updated);
    return dto;
  }

  // ------------------------------------------------------------------------------------------------
  // Reject experience (admin).
  // ------------------------------------------------------------------------------------------------
  async reject({ identifier, reason }: { identifier: string; reason: string }) {
    const relations: FindOptionsRelations<Experience> = {
      categories: { icon: true },
      facilities: { icon: true },
      town: { department: true },
      images: { imageResource: true },
      guide: { user: true },
    };
    const experience = await this.experienceRepository.findOne({ where: { id: identifier }, relations });
    if (!experience) throw new NotFoundException('Experience not found');

    if (experience.status !== 'pending_review') {
      throw new BadRequestException({
        message: 'Only pending_review experiences can be rejected',
        currentStatus: experience.status,
      });
    }

    experience.status = 'rejected';
    experience.rejectionReason = reason;
    await this.experienceRepository.save(experience);

    const updated = await this.experienceRepository.findOne({ where: { id: experience.id }, relations });
    if (!updated) throw new NotFoundException('Experience not found after update');
    const dto = new ExperienceDto({ data: updated });
    await this.applyOwnerEnrichment(dto, updated);
    return dto;
  }
}
