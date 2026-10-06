import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectLiteral, Repository } from 'typeorm';
import { Place } from '../places/entities';
import { Lodging } from '../lodgings/entities';
import { Restaurant } from '../restaurants/entities';
import { Experience } from '../experiences/entities';
import { Review } from '../reviews/entities';
import { HomeItemDto, HomeDataDto } from './dto';

const HOME_ITEMS_LIMIT = 6;

// Alias del query builder; coincide con el nombre de la relación en Review (review.place, review.lodging...)
type HomeEntityAlias = 'place' | 'lodging' | 'restaurant' | 'experience';

@Injectable()
export class HomeService {
  constructor(
    @InjectRepository(Place)
    private readonly placeRepository: Repository<Place>,
    @InjectRepository(Lodging)
    private readonly lodgingRepository: Repository<Lodging>,
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
    @InjectRepository(Experience)
    private readonly experienceRepository: Repository<Experience>,
    @InjectRepository(Review)
    private readonly reviewRepository: Repository<Review>,
  ) {}

  async getHomeData(tenantId?: string | null, userId?: string): Promise<HomeDataDto> {
    const [places, lodgings, restaurants, experiences] = await Promise.all([
      this.getRandomPlaces(tenantId, userId),
      this.getRandomLodgings(tenantId, userId),
      this.getRandomRestaurants(tenantId, userId),
      this.getRandomExperiences(tenantId, userId),
    ]);

    return {
      places,
      lodgings,
      restaurants,
      experiences,
    };
  }

  private async getRandomPlaces(tenantId?: string | null, userId?: string): Promise<HomeItemDto[]> {
    const places = await this.findRandom(this.placeRepository, 'place', tenantId);
    const { categories, userReviews } = await this.loadExtras(this.placeRepository, 'place', places, userId);

    return places.map(place => ({
      id: place.id,
      name: place.name,
      slug: place.slug,
      image: place.images?.[0]?.imageResource?.url,
      rating: place.rating,
      reviewCount: place.reviewCount,
      category: categories.get(place.id),
      difficultyLevel: place.difficultyLevel,
      distanceMeters: place.urbarCenterDistance,
      userReview: userReviews.get(place.id),
    }));
  }

  private async getRandomLodgings(tenantId?: string | null, userId?: string): Promise<HomeItemDto[]> {
    const lodgings = await this.findRandom(this.lodgingRepository, 'lodging', tenantId);
    const { categories, userReviews } = await this.loadExtras(this.lodgingRepository, 'lodging', lodgings, userId);

    return lodgings.map(lodging => ({
      id: lodging.id,
      name: lodging.name,
      slug: lodging.slug,
      image: lodging.images?.[0]?.imageResource?.url,
      rating: lodging.rating,
      reviewCount: lodging.reviewCount,
      category: categories.get(lodging.id),
      userReview: userReviews.get(lodging.id),
    }));
  }

  private async getRandomRestaurants(tenantId?: string | null, userId?: string): Promise<HomeItemDto[]> {
    const restaurants = await this.findRandom(this.restaurantRepository, 'restaurant', tenantId);
    const { categories, userReviews } = await this.loadExtras(
      this.restaurantRepository,
      'restaurant',
      restaurants,
      userId,
    );

    return restaurants.map(restaurant => ({
      id: restaurant.id,
      name: restaurant.name,
      slug: restaurant.slug,
      image: restaurant.images?.[0]?.imageResource?.url,
      rating: restaurant.rating,
      reviewCount: restaurant.reviewCount,
      category: categories.get(restaurant.id),
      userReview: userReviews.get(restaurant.id),
    }));
  }

  private async getRandomExperiences(tenantId?: string | null, userId?: string): Promise<HomeItemDto[]> {
    const experiences = await this.findRandom(this.experienceRepository, 'experience', tenantId);
    const { categories, userReviews } = await this.loadExtras(
      this.experienceRepository,
      'experience',
      experiences,
      userId,
    );

    return experiences.map(experience => ({
      id: experience.id,
      name: experience.title, // Note: Experience entity uses 'title' instead of 'name'
      slug: experience.slug,
      image: experience.images?.[0]?.imageResource?.url,
      rating: experience.rating,
      reviewCount: experience.reviewsCount,
      category: categories.get(experience.id),
      difficultyLevel: Number(experience.difficultyLevel),
      userReview: userReviews.get(experience.id),
    }));
  }

  private findRandom<T extends ObjectLiteral>(
    repository: Repository<T>,
    alias: HomeEntityAlias,
    tenantId?: string | null,
  ): Promise<T[]> {
    const query = repository
      .createQueryBuilder(alias)
      .leftJoinAndSelect(`${alias}.images`, 'images', 'images.isPublic = :imageIsPublic AND images.order = 1')
      .leftJoinAndSelect('images.imageResource', 'imageResource')
      .where(`${alias}.isPublic = :isPublic`, { isPublic: true })
      .setParameter('imageIsPublic', true);

    // Scope to the current tenant's town (apex / no tenant → unfiltered).
    if (tenantId) {
      query.innerJoin(`${alias}.town`, 'town').andWhere('town.id = :tenantId', { tenantId });
    }

    return query.orderBy('RANDOM()').limit(HOME_ITEMS_LIMIT).getMany();
  }

  // Categorías y reseñas del usuario se cargan aparte: unirlas a la query aleatoria multiplicaría
  // las filas y el `limit` devolvería menos de HOME_ITEMS_LIMIT entidades.
  private async loadExtras<T extends ObjectLiteral>(
    repository: Repository<T>,
    alias: HomeEntityAlias,
    items: { id: string }[],
    userId?: string,
  ) {
    const ids = items.map(item => item.id);
    const [categories, userReviews] = await Promise.all([
      this.findFirstCategoryNames(repository, alias, ids),
      this.findUserReviewIds(alias, ids, userId),
    ]);

    return { categories, userReviews };
  }

  private async findFirstCategoryNames<T extends ObjectLiteral>(
    repository: Repository<T>,
    alias: HomeEntityAlias,
    ids: string[],
  ): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (!ids.length) return names;

    const rows = await repository
      .createQueryBuilder(alias)
      .innerJoin(`${alias}.categories`, 'category')
      .select(`${alias}.id`, 'id')
      .addSelect('category.name', 'name')
      .where(`${alias}.id IN (:...ids)`, { ids })
      .orderBy('category.name', 'ASC')
      .getRawMany<{ id: string; name: string }>();

    for (const row of rows) {
      if (!names.has(row.id)) names.set(row.id, row.name);
    }

    return names;
  }

  private async findUserReviewIds(alias: HomeEntityAlias, ids: string[], userId?: string): Promise<Map<string, string>> {
    const reviewIds = new Map<string, string>();
    if (!userId || !ids.length) return reviewIds;

    const rows = await this.reviewRepository
      .createQueryBuilder('review')
      .innerJoin(`review.${alias}`, 'entity')
      .innerJoin('review.user', 'user')
      .select('review.id', 'reviewId')
      .addSelect('entity.id', 'entityId')
      .where('user.id = :userId', { userId })
      .andWhere('entity.id IN (:...ids)', { ids })
      .getRawMany<{ reviewId: string; entityId: string }>();

    for (const row of rows) {
      reviewIds.set(row.entityId, row.reviewId);
    }

    return reviewIds;
  }
}
