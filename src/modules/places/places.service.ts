import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsRelations, Geometry, In, Repository } from 'typeorm';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PlaceDetailDto, PlaceDto, AdminPlacesFiltersDto, AdminPlacesListDto } from './dto';
import { Place, PlaceImage } from './entities';
import { generatePlaceQueryFilters } from './utils';
import { CreatePlaceDto } from './dto/create-place.dto';
import { UpdatePlaceDto } from './dto/update-place.dto';
import { PlaceFiltersDto } from './dto/place-filters.dto';
import { Category, Facility, ImageResource } from '../core/entities';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { User } from '../users/entities/user.entity';
import { Review } from '../reviews/entities';
import { PlaceReviewsService } from '../reviews/services';
import { ResourceProvider } from 'src/config';
import { CLOUDINARY_FOLDERS } from 'src/config/cloudinary-folders';
import { CloudinaryPresets } from 'src/config';
import { ReorderImagesDto } from '../common/dto/reoder-images.dto';
import { Town } from '../towns/entities/town.entity';
import { PlaceVectorDto } from './dto/place-vector.dto';
import { TranslationResolverService } from '../translations/translation-resolver.service';

@Injectable()
export class PlacesService {
  constructor(
    @InjectRepository(Place)
    private readonly placeRepo: Repository<Place>,

    @InjectRepository(ImageResource)
    private readonly imageResourceRepo: Repository<ImageResource>,

    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,

    @InjectRepository(Facility)
    private readonly facilityRepo: Repository<Facility>,

    @InjectRepository(PlaceImage)
    private readonly placeImageRepo: Repository<PlaceImage>,

    private readonly cloudinaryService: CloudinaryService,

    private readonly placeReviewService: PlaceReviewsService,
    private readonly translationResolver: TranslationResolverService,
  ) {}

  async create(createPlaceDto: CreatePlaceDto) {
    const { categoryIds, facilityIds, longitude, latitude, townId, ...restDto } = createPlaceDto;

    // Se recuperan las instancias de categories y facility
    const categories = categoryIds ? await this.categoryRepo.findBy({ id: In(categoryIds) }) : [];
    const facilities = facilityIds ? await this.facilityRepo.findBy({ id: In(facilityIds) }) : [];

    const town = await this.placeRepo.manager.findOne(Town, { where: { id: townId } });

    // Se crea el objeto de ubicación en formato GeoJSON
    const location: Geometry = { type: 'Point', coordinates: [longitude, latitude] };

    try {
      const place = this.placeRepo.create({
        ...restDto,
        categories,
        facilities,
        location,
        town: town ?? undefined,
      });

      await this.placeRepo.save(place);
      console.log('place', place);
      return { message: place.name };
    } catch (error) {
      throw new BadRequestException(`Error creating place: ${error.message}`);
    }
  }

  async update(id: string, updatePlaceDto: UpdatePlaceDto) {
    const place = await this.placeRepo.findOne({ where: { id } });
    if (!place) throw new NotFoundException('Place not found');

    const { categoryIds, facilityIds, longitude, latitude, townId, ...restDto } = updatePlaceDto;

    // Se recuperan las instancias de categories y facility.
    // IMPORTANTE: cuando el campo no viene en el PATCH (undefined) dejamos la
    // relación SIN TOCAR (undefined), no en [] — si no, cada step del onboarding
    // que no manda categoryIds/facilityIds borraría las categorías/facilidades
    // guardadas en pasos anteriores. Un [] explícito sí limpia (deselección).
    const categories = categoryIds ? await this.categoryRepo.findBy({ id: In(categoryIds) }) : undefined;
    const facilities = facilityIds ? await this.facilityRepo.findBy({ id: In(facilityIds) }) : undefined;

    // Get town if townId is provided
    const town = townId ? await this.placeRepo.manager.findOne(Town, { where: { id: townId } }) : undefined;

    // Se crea el objeto de ubicación en formato GeoJSON si se proporcionaron coordenadas
    const location: Geometry | undefined =
      longitude !== undefined && latitude !== undefined
        ? { type: 'Point', coordinates: [Number(longitude), Number(latitude)] }
        : undefined;

    try {
      await this.placeRepo.save({
        id: place.id,
        ...restDto,
        categories,
        facilities,
        location,
        town: town ?? undefined,
      });

      const relations: FindOptionsRelations<Place> = {
        categories: { icon: true },
        facilities: { icon: true },
        town: { department: true },
        images: { imageResource: true },
      };

      const updatedPlace = await this.placeRepo.findOne({
        where: { id },
        relations,
        order: { images: { order: 'ASC' } },
      });

      if (!updatedPlace) throw new NotFoundException('Place not found');
      return { message: updatedPlace.name };
    } catch (error) {
      throw new BadRequestException(`Error updating place: ${error.message}`);
    }
  }

  async findAll(filters: PlaceFiltersDto = {}, user: User | null = null) {
    const { where, order } = generatePlaceQueryFilters(filters);
    const relations: FindOptionsRelations<Place> = {
      town: { department: true },
      reviews: true,
      categories: { icon: true },
      images: { imageResource: true },
    };

    const [places, reviews] = await Promise.all([
      this.placeRepo.find({ relations, order, where }),
      user ? this.placeReviewService.getUserReviews({ userId: user.id }) : Promise.resolve<Review[]>([]),
    ]);

    return places.map(place => {
      const review = reviews.find(r => r.place.id === place.id);
      return new PlaceDto(place, review?.id);
    });
  }

  // ------------------------------------------------------------------------------------------------
  // Find all public places
  // ------------------------------------------------------------------------------------------------
  async findPublicPlaces(filters: PlaceFiltersDto = {}, user: User | null = null, locale = 'es') {
    /*     const shouldRandomize = filters?.sortBy === 'random';
     */ const { where, order } = generatePlaceQueryFilters(filters);
    const relations: FindOptionsRelations<Place> = {
      town: { department: true },
      reviews: true,
      categories: { icon: true },
      images: { imageResource: true },
    };

    const [places, reviews] = await Promise.all([
      this.placeRepo.find({
        relations,
        order,
        where: [
          { ...where, isPublic: true },
          { ...where, forcedPublic: true },
        ],
      }),
      user ? this.placeReviewService.getUserReviews({ userId: user.id }) : Promise.resolve<Review[]>([]),
    ]);

    const filteredPlaces = places;
    /*  if (shouldRandomize) {
      filteredPlaces = filteredPlaces.sort(() => Math.random() - 0.5);
    }
 */

    // Batch-load translations once for all places (N+1 guard — zero AI at request time)
    let translationsMap: Map<string, Record<string, string>> = new Map();
    let categoryTranslations: Map<string, Record<string, string>> = new Map();
    if (locale !== 'es' && filteredPlaces.length) {
      translationsMap = await this.translationResolver.batchLoad('place', filteredPlaces.map(p => p.id), locale);
      const categoryIds = [...new Set(filteredPlaces.flatMap(p => (p.categories ?? []).map(c => c.id)))];
      categoryTranslations = await this.translationResolver.batchLoad('category', categoryIds, locale);
    }

    return filteredPlaces.map(place => {
      const review = reviews.find(r => r.place.id === place.id);
      const base =
        locale !== 'es'
          ? this.translationResolver.overlay({ ...place }, translationsMap.get(place.id) ?? {})
          : place;
      if (locale !== 'es') {
        (base as Place).categories = this.translationResolver.overlayCollection(place.categories ?? [], categoryTranslations);
      }
      return new PlaceDto(base as Place, review?.id);
    });
  }

  // ------------------------------------------------------------------------------------------------
  // Find all public places with full info
  // ------------------------------------------------------------------------------------------------
  async findPublicFullInfoPlaces(filters: PlaceFiltersDto = {}, user: User | null = null) {
    const { where, order } = generatePlaceQueryFilters(filters);
    const relations: FindOptionsRelations<Place> = {
      town: { department: true },
      // reviewer `user` is loaded ONLY to derive a safe display name in the DTO; never serialized.
      reviews: { user: true },
      categories: { icon: true },
      images: { imageResource: true },
    };

    const [places, reviews] = await Promise.all([
      this.placeRepo.find({ relations, order, where: { ...where, isPublic: true } }),
      user ? this.placeReviewService.getUserReviews({ userId: user.id }) : Promise.resolve<Review[]>([]),
    ]);

    return places.map(place => {
      const review = reviews.find(r => r.place.id === place.id);
      return new PlaceVectorDto({ place, reviewId: review?.id });
    });
  }

  // ------------------------------------------------------------------------------------------------
  // Find one place
  // ------------------------------------------------------------------------------------------------
  async findOne(identifier: string, user: User | null = null, locale = 'es') {
    const relations: FindOptionsRelations<Place> = {
      categories: { icon: true },
      facilities: true,
      town: { department: true },
      images: { imageResource: true },
    };

    let place = await this.placeRepo.findOne({
      where: { slug: identifier },
      relations,
      order: { images: { order: 'ASC' } },
    });
    if (!place) place = await this.placeRepo.findOne({ where: { id: identifier }, relations });
    if (!place) throw new NotFoundException('Place not found');

    const review = user ? await this.placeReviewService.findUserReview({ userId: user.id, placeId: place.id }) : null;

    // Load and overlay translations for the requested locale (zero AI at request time)
    const base =
      locale !== 'es'
        ? this.translationResolver.overlay(
            { ...place },
            await this.translationResolver.load('place', place.id, locale),
          )
        : place;

    if (locale !== 'es') {
      const [categoryTranslations, facilityTranslations] = await Promise.all([
        this.translationResolver.batchLoad('category', (place.categories ?? []).map(c => c.id), locale),
        this.translationResolver.batchLoad('facility', (place.facilities ?? []).map(f => f.id), locale),
      ]);
      (base as Place).categories = this.translationResolver.overlayCollection(place.categories ?? [], categoryTranslations);
      (base as Place).facilities = this.translationResolver.overlayCollection(place.facilities ?? [], facilityTranslations);
    }

    return new PlaceDetailDto({ place: base as Place, reviewId: review?.id });
  }

  // ------------------------------------------------------------------------------------------------
  // Delete place
  // ------------------------------------------------------------------------------------------------
  async delete(id: string) {
    const place = await this.placeRepo.findOne({
      where: { id },
      relations: {
        images: {
          imageResource: true,
        },
      },
    });

    if (!place) throw new NotFoundException('Place not found');

    try {
      // Delete everything in a single transaction
      await this.placeRepo.manager.transaction(async manager => {
        if (place.images && place.images.length > 0) {
          // 1. Delete images from Cloudinary
          await Promise.all(
            place.images.map(image =>
              image.imageResource.publicId
                ? this.cloudinaryService.destroyFile(image.imageResource.publicId)
                : Promise.resolve(),
            ),
          );

          // 2. Delete RestaurantImage first
          await manager.delete(
            PlaceImage,
            place.images.map(image => image.id),
          );

          // 3. Delete ImageResource
          await manager.delete(
            ImageResource,
            place.images.map(image => image.imageResource.id),
          );
        }

        // 4. Finally delete the restaurant
        await manager.delete(Place, { id: place.id });
      });

      // After all database operations complete, delete the folder
      try {
        await this.cloudinaryService.destroyFolder(`${CLOUDINARY_FOLDERS.PLACE_GALLERY}/${place.slug}`);
      } catch (folderError) {
        console.warn(`Could not delete Cloudinary folder for place ${place.slug}:`, folderError);
        // Continue with the process, as the main deletion was successful
      }

      return { message: 'Place deleted successfully' };
    } catch (error) {
      throw new BadRequestException(`Error deleting place: ${error.message}`);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Upload image
  // ------------------------------------------------------------------------------------------------
  async uploadImages(id: string, files: Express.Multer.File[], mediaFormat?: string, videoUrl?: string) {
    const place = await this.placeRepo.findOne({
      where: { id },
      relations: { images: { imageResource: true } },
    });

    if (!place) throw new NotFoundException('Place not found');

    try {
      // Process each file in the array
      const uploadPromises = files.map(async (file, index) => {
        // Upload the image to Cloudinary
        const cloudinaryRes = await this.cloudinaryService.uploadImage({
          file,
          fileName: place.name,
          preset: CloudinaryPresets.PLACE_IMAGE,
          folder: `${CLOUDINARY_FOLDERS.PLACE_GALLERY}/${place.slug}`,
        });

        if (!cloudinaryRes) throw new BadRequestException('Error uploading image');

        // Create and save the image resource
        const imageResource = await this.placeRepo.manager.create(ImageResource, {
          publicId: cloudinaryRes.publicId,
          url: cloudinaryRes.url,
          fileName: place.name,
          width: cloudinaryRes.width,
          height: cloudinaryRes.height,
          format: cloudinaryRes.format,
          resourceType: cloudinaryRes.type,
          provider: ResourceProvider.Cloudinary,
        });

        await this.placeRepo.manager.save(ImageResource, imageResource);

        // Create and save the lodging image association
        const placeImage = await this.placeRepo.manager.create(PlaceImage, {
          imageResource,
          order: place.images.length + index + 1,
          place: { id: place.id },
          mediaFormat: mediaFormat || 'image',
          videoUrl: videoUrl || undefined,
        });

        await this.placeRepo.manager.save(PlaceImage, placeImage);
      });

      // Wait for all uploads to complete
      await Promise.all(uploadPromises);

      return this.findOne(place.id);
    } catch (error) {
      throw error;
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Get images
  // ------------------------------------------------------------------------------------------------
  async getImages(id: string) {
    const place = await this.placeRepo.findOne({
      where: [{ id }],
      relations: {
        images: {
          imageResource: true,
        },
      },
    });
    console.log('images', place?.images.length);

    if (!place) throw new NotFoundException('Place not found');

    return place.images.sort((a, b) => a.order - b.order);
  }

  // ------------------------------------------------------------------------------------------------
  // Delete image
  // ------------------------------------------------------------------------------------------------
  async deleteImage(id: string, imageId: string) {
    const place = await this.placeRepo.findOne({
      where: [{ id }],
      relations: {
        images: {
          imageResource: true,
        },
      },
    });

    if (!place) throw new NotFoundException('Place not found');

    const image = place.images.find(img => img.id === imageId);
    if (!image) throw new NotFoundException('Image not found');

    try {
      // Delete from Cloudinary
      if (image.imageResource.publicId) {
        await this.cloudinaryService.destroyFile(image.imageResource.publicId);
      }

      // Delete from database
      await this.placeRepo.manager.remove(image);

      // Reorder remaining images
      const remainingImages = place.images
        .filter(img => img.id !== imageId && img.id != undefined)
        .sort((a, b) => a.order - b.order);

      await Promise.all(
        remainingImages.map((img, index) =>
          this.placeRepo.manager.update(PlaceImage, img.id, {
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
    const place = await this.placeRepo.findOne({ where: { id: identifier } });
    if (!place) throw new NotFoundException('Place not found');

    const { newOrder } = reorderImagesDto;
    console.log(newOrder);
    await Promise.all(newOrder.map(({ id, order }) => this.placeRepo.manager.update(PlaceImage, id, { order })));

    return { message: 'Images reordered successfully' };
  }

  async updateVisibility(identifier: string, isPublic: boolean) {
    const place = await this.placeRepo.findOne({ where: { id: identifier } });

    if (!place) {
      throw new NotFoundException('Place not found');
    }
    place.isPublic = isPublic;
    await this.placeRepo.save(place);
    return { message: 'Place visibility updated', data: isPublic };
  }

  // ------------------------------------------------------------------------------------------------
  // Find all places paginated (Admin)
  // ------------------------------------------------------------------------------------------------
  async findAllPaginated(filters: AdminPlacesFiltersDto): Promise<AdminPlacesListDto> {
    const { page = 1, limit = 10, search, categoryId, townId, isPublic, sortBy = 'name', sortOrder = 'ASC' } = filters;

    const queryBuilder = this.placeRepo
      .createQueryBuilder('place')
      .leftJoinAndSelect('place.town', 'town')
      .leftJoinAndSelect('town.department', 'department')
      .leftJoinAndSelect('place.categories', 'categories')
      .leftJoinAndSelect('categories.icon', 'categoryIcon')
      .leftJoinAndSelect('place.images', 'images')
      .leftJoinAndSelect('images.imageResource', 'imageResource');

    if (search) {
      queryBuilder.andWhere('place.name ILIKE :search', { search: `%${search}%` });
    }

    if (categoryId) {
      queryBuilder.andWhere('categories.id = :categoryId', { categoryId });
    }

    if (townId) {
      queryBuilder.andWhere('town.id = :townId', { townId });
    }

    if (isPublic !== undefined) {
      queryBuilder.andWhere('place.isPublic = :isPublic', { isPublic });
    }

    // Sorting
    const validSortFields = ['name', 'points', 'rating', 'createdAt', 'updatedAt'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'name';
    queryBuilder.orderBy(`place.${sortField}`, sortOrder);

    // Pagination
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    const [places, count] = await queryBuilder.getManyAndCount();
    const pages = Math.ceil(count / limit);

    return new AdminPlacesListDto({ currentPage: page, pages, count }, places);
  }
}
