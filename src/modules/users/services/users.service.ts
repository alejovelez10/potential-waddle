import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { FindOptionsRelations, In, Repository } from 'typeorm';

import { User } from '../entities/user.entity';
import { CreateUserDto } from '../dto/create-user.dto';
import { hashPassword } from '../../auth/utils/hash-password';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';
import { CloudinaryImage } from '../../cloudinary/interfaces';
import { CloudinaryPresets } from '../../../config';
import { UserDto } from '../dto/user.dto';
import { ChangePasswordDto } from '../../auth/dto/change-password.dto';
import { compareSync } from 'bcrypt';
import { GoogleUserDto } from '../../auth/dto/google-user.dto';
import { UpdateProfileDto } from 'src/modules/auth/dto';
import { UserGuideDto } from '../dto/user-guide.dto';
import { UserLodgingDto } from '../dto/user-lodgings.dto';
import { UserRestaurantDto } from '../dto/user-restaurant.dto';
import { UserCommerceDto } from '../dto/user-commerce.dto';
import { UserTransportDto } from '../dto/user-transport.dto';
import { AdminUsersFiltersDto, AdminUsersListDto, AdminUserDto } from '../dto';
import { generateAdminUsersQueryFilters } from '../utils';
import { Town } from 'src/modules/towns/entities/town.entity';
import { Review } from 'src/modules/reviews/entities';
import { TermsService } from 'src/modules/terms/services';
import { DocumentService } from 'src/modules/documents/services';
import { DocumentEntityType } from 'src/modules/documents/enums';
import {
  computeLodgingTermsStatus,
  computeLodgingDocsStatus,
} from 'src/modules/lodgings/utils/compute-lodging-completion';
import {
  computeRestaurantTermsStatus,
  computeRestaurantDocsStatus,
} from 'src/modules/restaurants/utils/compute-restaurant-completion';
import {
  computeCommerceTermsStatus,
  computeCommerceDocsStatus,
} from 'src/modules/commerce/utils/compute-commerce-completion';

interface AdminUsersFindAllParams {
  filters?: AdminUsersFiltersDto;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Town)
    private readonly townRepository: Repository<Town>,
    @InjectRepository(Review)
    private readonly reviewRepository: Repository<Review>,
    private readonly cloudinaryService: CloudinaryService,
    private readonly termsService: TermsService,
    private readonly documentService: DocumentService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    delete createUserDto.passwordConfirmation;
    createUserDto.password = hashPassword(createUserDto.password);

    const user = this.usersRepository.create(createUserDto);
    await this.usersRepository.save(user);
    delete user.password;

    return user;
  }

  async createFromGoogle(googleUser: GoogleUserDto) {
    const user = await this.usersRepository.findOne({ where: { email: googleUser.email } });
    if (user) {
      if (!user.emailVerifiedAt) user.emailVerifiedAt = new Date();

      if (!user.profilePhoto && googleUser.picture) {
        try {
          user.profilePhoto = await this.cloudinaryService.uploadImageFromUrl(
            googleUser.picture,
            user.username,
            CloudinaryPresets.PROFILE_PHOTO,
          );
        } catch (error) {
          this.logger.error('No se pudo cargar la imagen desde la url', error);
        }
      }

      return this.usersRepository.save(user);
    }

    const newImage: CloudinaryImage | undefined = googleUser.picture
      ? await this.cloudinaryService.uploadImageFromUrl(
          googleUser.picture,
          googleUser.username,
          CloudinaryPresets.PROFILE_PHOTO,
        )
      : undefined;

    const newUser = this.usersRepository.create({
      email: googleUser.email,
      username: googleUser.username,
      profilePhoto: newImage,
      emailVerifiedAt: new Date(),
    });

    return this.usersRepository.save(newUser);
  }

  findAll() {
    return this.usersRepository.find();
  }

  async findAllAdmin({ filters }: AdminUsersFindAllParams = {}): Promise<AdminUsersListDto> {
    const { page = 1, limit = 25 } = filters ?? {};
    const skip = (page - 1) * limit;
    const { where, order } = generateAdminUsersQueryFilters(filters);

    const relations: FindOptionsRelations<User> = {
      role: true,
      reviews: true,
    };

    const [users, count] = await this.usersRepository.findAndCount({
      skip,
      take: limit,
      relations,
      order,
      where,
    });

    return new AdminUsersListDto({ currentPage: page, pages: Math.ceil(count / limit), count }, users);
  }

  async findOne(id: string): Promise<User | null> {
    const user = await this.usersRepository.findOne({ where: { id }, relations: ['role'] });
    return user;
  }

  async findOneWithSessionAndRole(id: string, sessionId: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .innerJoinAndSelect('user.sessions', 'session')
      .leftJoinAndSelect('user.role', 'role')
      .leftJoinAndSelect('user.towns', 'towns')
      .where('user.id = :id', { id })
      .andWhere('session.id = :sessionId', { sessionId })
      .addSelect('user.password')
      .getOne();
  }

  async getFullUser(email: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.role', 'role')
      .leftJoinAndSelect('user.towns', 'towns')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();
  }

  async findOneByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } });
  }

  async updatePassword(id: string, hashedPassword: string): Promise<void> {
    await this.usersRepository.update(id, { password: hashedPassword });
  }

  async updateProfilePhoto(id: string, file: Express.Multer.File) {
    const user = await this.findOne(id);
    if (!user) throw new NotFoundException('User not found');

    const { profilePhoto: currentProfilePath } = user;
    let image: CloudinaryImage | undefined;

    try {
      // * Upload the image to Cloudinary
      image = await this.cloudinaryService.uploadImage({
        file,
        fileName: user.username,
        preset: CloudinaryPresets.PROFILE_PHOTO,
      });

      // * If the image is not uploaded, throw an error
      if (!image) throw new BadRequestException('Error uploading image');

      // * Update the user's profile photo path
      user.profilePhoto = image;
      await this.usersRepository.save(user);

      // * Delete the old profile photo if it exists

      if (currentProfilePath) {
        this.cloudinaryService.destroyFile(currentProfilePath.publicId);
      }

      return new UserDto(user);
    } catch (error) {
      this.logger.error(error);
      if (image) {
        this.logger.log('Deleting image');
        await this.cloudinaryService.destroyFile(image.publicId);
      }

      throw error;
    }
  }

  async removeProfilePhoto(id: string) {
    const user = await this.findOne(id);
    if (!user) throw new NotFoundException('User not found');

    const { profilePhoto } = user;
    if (!profilePhoto) throw new BadRequestException('User does not have a profile photo');

    await this.cloudinaryService.destroyFile(profilePhoto.publicId);
    user.profilePhoto = null;
    await this.usersRepository.save(user);

    return new UserDto(user);
  }

  async changePassword(email: string, changePasswordDto: ChangePasswordDto) {
    const { password, newPassword } = changePasswordDto;

    const user = await this.getFullUser(email);
    if (!user) throw new NotFoundException('User not found');
    if (user.password && !compareSync(password, user.password)) throw new UnauthorizedException('Invalid password');

    user.password = hashPassword(newPassword);
    await this.usersRepository.save(user);
  }

  async updateProfile(id: string, updateProfileDto: UpdateProfileDto) {
    const user = await this.findOne(id);
    if (!user) throw new NotFoundException('User not found');

    const userUpdated = await this.usersRepository.save({ ...user, ...updateProfileDto });
    return new UserDto(userUpdated);
  }

  async getUserTransport(id: string) {
    const user = await this.usersRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.transport', 'transport')
      .leftJoinAndSelect('transport.user', 'transportUser')
      .leftJoinAndSelect('transport.categories', 'categories')
      .leftJoinAndSelect('categories.icon', 'icon')
      .leftJoinAndSelect('transport.town', 'town')
      .leftJoinAndSelect('town.department', 'department')
      .where('user.id = :id', { id })
      .getOne();

    const userTransport = user?.transport ? new UserTransportDto(user, user.transport) : null;
    return userTransport ?? {};
  }

  /*   async getFullUserWithRelations(id: string) {
    const relations: FindOptionsRelations<User> = {
      lodgings: {
        town: { department: true },
        images: { imageResource: true },
        categories: { icon: true },
      },
      restaurants: {
        town: { department: true },
        images: { imageResource: true },
        categories: { icon: true },
      },
      commerces: {
        town: { department: true },
        categories: { icon: true },
        images: { imageResource: true },
      },
      guide: {
        categories: { icon: true },
        experiences: {
          categories: { icon: true },
          images: { imageResource: true },
          town: { department: true },
        },
      },
    };
    const user = await this.usersRepository.findOne({
      where: { id },
      relations,
    });
    return user;
  } */

  async getUserGuide(id: string) {
    const user = await this.usersRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.guide', 'guide')
      .leftJoinAndSelect('guide.categories', 'guideCategories')
      .leftJoinAndSelect('guide.experiences', 'experiences')
      .leftJoinAndSelect('experiences.categories', 'expCategories')
      .leftJoinAndSelect('experiences.images', 'expImages')
      .leftJoinAndSelect('expImages.imageResource', 'expImageResource')
      .leftJoinAndSelect('experiences.town', 'expTown')
      .where('user.id = :id', { id })
      .getOne();

    const userGuide = user?.guide ? new UserGuideDto({ data: user?.guide, user }) : null;
    return userGuide ?? {};
  }

  async getUserLodgings(id: string) {
    const user = await this.usersRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.lodgings', 'lodgings')
      .leftJoinAndSelect('lodgings.categories', 'categories')
      .leftJoinAndSelect('lodgings.images', 'images')
      .leftJoinAndSelect('images.imageResource', 'imageResource')
      .leftJoinAndSelect('lodgings.town', 'town')
      .leftJoinAndSelect('town.department', 'department')
      .leftJoinAndSelect('lodgings.facilities', 'facilities')
      .leftJoinAndSelect('lodgings.lodgingRoomTypes', 'lodgingRoomTypes')
      // places joined so UserLodgingDto can surface a placesCount > 0 for the skip-penalty
      .leftJoinAndSelect('lodgings.places', 'lodgingPlaces')
      .where('user.id = :id', { id })
      .getOne();

    if (!user?.lodgings || user.lodgings.length === 0) return [];

    // T&C acceptance is per-user-globally — fetch once and reuse across all lodgings the user owns.
    const termsDto = await this.termsService.getStatusForUser(id);
    const termsStatus = computeLodgingTermsStatus({
      hasActiveLodgingTerms: termsDto.activeDocumentIds.lodging !== null,
      hasAcceptedLodgingTerms: termsDto.hasAcceptedLodgingTerms,
    });

    // Docs requirements are per (town × categories) — must fetch per lodging. Parallelize.
    const docsLists = await Promise.all(
      user.lodgings.map(lodging => {
        const townId = lodging.town?.id;
        if (!townId) return Promise.resolve([]);
        const categoryIds = lodging.categories?.map(c => c.id) ?? [];
        return this.documentService.getEntityDocumentStatus(
          townId,
          DocumentEntityType.LODGING,
          lodging.id,
          categoryIds,
        );
      }),
    );

    return user.lodgings.map((lodging, i) => {
      const docsStatus = computeLodgingDocsStatus(
        docsLists[i].map(d => ({
          documentTypeName: d.documentType.name,
          isRequired: d.isRequired,
          isUploaded: d.isUploaded,
          isExpired: d.isExpired,
        })),
      );
      return new UserLodgingDto(lodging, { termsStatus, docsStatus });
    });
  }

  async getUserCommerce(id: string) {
    const user = await this.usersRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.commerces', 'commerces')
      .leftJoinAndSelect('commerces.images', 'images')
      .leftJoinAndSelect('images.imageResource', 'imageResource')
      .leftJoinAndSelect('commerces.categories', 'categories')
      .leftJoinAndSelect('commerces.town', 'town')
      .leftJoinAndSelect('town.department', 'department')
      .leftJoinAndSelect('commerces.facilities', 'commerceFacilities')
      .leftJoinAndSelect('commerces.products', 'commerceProducts')
      .where('user.id = :id', { id })
      .getOne();

    if (!user?.commerces || user.commerces.length === 0) return [];

    const termsDto = await this.termsService.getStatusForUser(id);
    const termsStatus = computeCommerceTermsStatus({
      hasActiveCommerceTerms: termsDto.activeDocumentIds.commerce !== null,
      hasAcceptedCommerceTerms: termsDto.hasAcceptedCommerceTerms,
      activeTermsId: termsDto.activeDocumentIds.commerce,
    });

    const docsLists = await Promise.all(
      user.commerces.map(commerce => {
        const townId = commerce.town?.id;
        if (!townId) return Promise.resolve([]);
        const categoryIds = commerce.categories?.map(c => c.id) ?? [];
        return this.documentService.getEntityDocumentStatus(
          townId,
          DocumentEntityType.COMMERCE,
          commerce.id,
          categoryIds,
        );
      }),
    );

    return user.commerces.map((commerce, i) => {
      const docsStatus = computeCommerceDocsStatus(
        docsLists[i].map(d => ({
          documentTypeName: d.documentType.name,
          isRequired: d.isRequired,
          isUploaded: d.isUploaded,
          isExpired: d.isExpired,
        })),
      );
      return new UserCommerceDto(commerce, { termsStatus, docsStatus });
    });
  }

  async getUserRestaurants(id: string) {
    const user = await this.usersRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.restaurants', 'restaurants')
      .leftJoinAndSelect('restaurants.images', 'images')
      .leftJoinAndSelect('images.imageResource', 'imageResource')
      .leftJoinAndSelect('restaurants.categories', 'categories')
      .leftJoinAndSelect('restaurants.town', 'town')
      .leftJoinAndSelect('town.department', 'department')
      .leftJoinAndSelect('restaurants.facilities', 'restaurantFacilities')
      .leftJoinAndSelect('restaurants.menus', 'restaurantMenus')
      .where('user.id = :id', { id })
      .getOne();

    if (!user?.restaurants || user.restaurants.length === 0) return [];

    const termsDto = await this.termsService.getStatusForUser(id);
    const termsStatus = computeRestaurantTermsStatus({
      hasActiveRestaurantTerms: termsDto.activeDocumentIds.restaurant !== null,
      hasAcceptedRestaurantTerms: termsDto.hasAcceptedRestaurantTerms,
      activeTermsId: termsDto.activeDocumentIds.restaurant,
    });

    const docsLists = await Promise.all(
      user.restaurants.map(restaurant => {
        const townId = restaurant.town?.id;
        if (!townId) return Promise.resolve([]);
        const categoryIds = restaurant.categories?.map(c => c.id) ?? [];
        return this.documentService.getEntityDocumentStatus(
          townId,
          DocumentEntityType.RESTAURANT,
          restaurant.id,
          categoryIds,
        );
      }),
    );

    return user.restaurants.map((restaurant, i) => {
      const docsStatus = computeRestaurantDocsStatus(
        docsLists[i].map(d => ({
          documentTypeName: d.documentType.name,
          isRequired: d.isRequired,
          isUploaded: d.isUploaded,
          isExpired: d.isExpired,
        })),
      );
      return new UserRestaurantDto(restaurant, { termsStatus, docsStatus });
    });
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * ADMIN METHODS
  // * ----------------------------------------------------------------------------------------------------------------

  async findOneAdmin(id: string) {
    const user = await this.usersRepository.findOne({
      where: { id },
      relations: ['role', 'reviews'],
    });

    if (!user) throw new NotFoundException('User not found');

    return new AdminUserDto(user);
  }

  async toggleActive(id: string) {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    user.isActive = !user.isActive;
    await this.usersRepository.save(user);

    return { id: user.id, isActive: user.isActive };
  }

  async toggleSuperUser(id: string) {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    user.isSuperUser = !user.isSuperUser;
    await this.usersRepository.save(user);

    return { id: user.id, isSuperUser: user.isSuperUser };
  }

  async remove(id: string) {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    await this.usersRepository.remove(user);

    return { deleted: true, id };
  }

  async updateUserTowns(userId: string, townIds: string[]) {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      relations: ['towns'],
    });

    if (!user) throw new NotFoundException('User not found');

    if (townIds.length === 0) {
      user.towns = [];
    } else {
      const towns = await this.townRepository.find({
        where: { id: In(townIds) },
      });

      if (towns.length !== townIds.length) {
        throw new BadRequestException('One or more towns not found');
      }

      user.towns = towns;
    }

    await this.usersRepository.save(user);

    return {
      id: user.id,
      towns: user.towns.map(t => ({ id: t.id, name: t.name, slug: t.slug })),
    };
  }

  async getUserTowns(userId: string) {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      relations: ['towns'],
    });

    if (!user) throw new NotFoundException('User not found');

    return user.towns?.map(t => ({ id: t.id, name: t.name, slug: t.slug })) || [];
  }

  // * ----------------------------------------------------------------------------------------------------------------
  // * GET USER REVIEWS (lugares visitados)
  // * ----------------------------------------------------------------------------------------------------------------
  // * ----------------------------------------------------------------------------------------------------------------
  // * GET ALL USER BUSINESSES (for admin subscription creation)
  // * ----------------------------------------------------------------------------------------------------------------
  async getUserBusinesses(userId: string) {
    const user = await this.usersRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.lodgings', 'lodgings')
      .leftJoinAndSelect('user.restaurants', 'restaurants')
      .leftJoinAndSelect('user.commerces', 'commerces')
      .leftJoinAndSelect('user.guide', 'guide')
      .leftJoinAndSelect('user.transport', 'transport')
      .where('user.id = :userId', { userId })
      .getOne();

    if (!user) return [];

    const businesses: Array<{ id: string; name: string; entityType: string }> = [];

    // Add lodgings
    if (user.lodgings) {
      user.lodgings.forEach(lodging => {
        businesses.push({ id: lodging.id, name: lodging.name, entityType: 'lodging' });
      });
    }

    // Add restaurants
    if (user.restaurants) {
      user.restaurants.forEach(restaurant => {
        businesses.push({ id: restaurant.id, name: restaurant.name, entityType: 'restaurant' });
      });
    }

    // Add commerces
    if (user.commerces) {
      user.commerces.forEach(commerce => {
        businesses.push({ id: commerce.id, name: commerce.name, entityType: 'commerce' });
      });
    }

    // Add guide (OneToOne)
    if (user.guide) {
      businesses.push({
        id: user.guide.id,
        name: `${user.guide.firstName} ${user.guide.lastName}`,
        entityType: 'guide',
      });
    }

    // Add transport (OneToOne)
    if (user.transport) {
      businesses.push({
        id: user.transport.id,
        name: `${user.transport.firstName} ${user.transport.lastName}`,
        entityType: 'transport',
      });
    }

    return businesses;
  }

  async getUserReviews(userId: string) {
    const reviews = await this.reviewRepository.find({
      where: { user: { id: userId } },
      relations: {
        place: { images: { imageResource: true }, town: true },
        lodging: { images: { imageResource: true }, town: true },
        restaurant: { images: { imageResource: true }, town: true },
        commerce: { images: { imageResource: true }, town: true },
        experience: { images: { imageResource: true }, town: true },
        transport: { town: true },
        guide: true,
        images: { image: true },
      },
      order: { createdAt: 'DESC' },
      // 'query' evita el producto cartesiano de ~20 LEFT JOIN en una sola sentencia
      // (reseña × imágenes de la entidad × imágenes de la reseña × town): en prod este
      // endpoint tardaba ~7 s por usuario. Con 'query' TypeORM carga cada relación con
      // SELECT ... WHERE id IN (...) — varias queries pequeñas en vez de una gigante.
      relationLoadStrategy: 'query',
    });

    return reviews.map(review => {
      // Determinar el tipo y la entidad
      let type: string | null = null;
      let entity: any = null;

      if (review.place) {
        type = 'place';
        entity = review.place;
      } else if (review.lodging) {
        type = 'lodging';
        entity = review.lodging;
      } else if (review.restaurant) {
        type = 'restaurant';
        entity = review.restaurant;
      } else if (review.commerce) {
        type = 'commerce';
        entity = review.commerce;
      } else if (review.experience) {
        type = 'experience';
        entity = review.experience;
      } else if (review.transport) {
        type = 'transport';
        entity = review.transport;
      } else if (review.guide) {
        type = 'guide';
        entity = review.guide;
      }

      // Obtener la imagen principal de la entidad. Se ordena explícitamente por la columna
      // `order` porque ni el LEFT JOIN ni la carga por query garantizan un orden estable:
      // sin este sort, la miniatura de una reseña podía cambiar entre requests.
      const entityImage =
        [...(entity?.images ?? [])].sort((a: any, b: any) => (a?.order ?? 0) - (b?.order ?? 0))[0]?.imageResource
          ?.url || null;

      return {
        id: review.id,
        type,
        entityId: entity?.id || null,
        name: entity?.name || entity?.username || 'Sin nombre',
        image: entityImage,
        location: entity?.town?.name || null,
        rating: entity?.rating || null,
        userRating: review.rating,
        comment: review.comment,
        reviewDate: review.createdAt,
        status: review.status,
      };
    });
  }
}
