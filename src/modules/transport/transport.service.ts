import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { TransportDto } from './dto/transport.dto';
import { TransportFindAllParams } from './interfaces/transport-find-all-params.interface';
import { generateTransportQueryFiltersAndSort } from './logic/generate-transport-query-filters-and-sort';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsRelations, In, Repository } from 'typeorm';
import { Transport } from './entities';
import { CreateTransportDto } from './dto/create-transport.dto';
import { Category } from '../core/entities';
import { Town } from '../towns/entities';
import { User } from '../users/entities';
import { UpdateTransportDto } from './dto/update-transport.dto';
import { TransportListDto } from './dto/transport-list.dto';
import { AdminTransportFiltersDto } from './dto/admin-transport-filters.dto';
import { AdminTransportListDto } from './dto/admin-transport-list.dto';
import { EntityReviewsService } from '../reviews/services/entity-reviews.service';
import { ReviewDomainsEnum } from '../reviews/enums';
import { Review } from '../reviews/entities';
import { TermsService } from '../terms/services';
import { TermsTypeEnum } from '../terms/interfaces';
import { computeTransportCompletion } from './utils/compute-transport-completion';
import { DocumentService } from '../documents/services';
import { DocumentEntityType } from '../documents/enums';
import { findPagePremiumFirst, shouldRankPremiumFirst, sortPremiumFirst } from '../subscriptions/utils/premium-ranking';
import { VerificationService } from '../verification/verification.service';
import { SubscriptionsService } from '../subscriptions/services';
import {
  computeLodgingTermsStatus,
  computeLodgingDocsStatus,
  type LodgingTermsStatus,
  type LodgingDocsStatus,
} from '../lodgings/utils/compute-lodging-completion';
import { isTermsEnforcementEnabled } from '../terms/utils';

@Injectable()
export class TransportService {
  constructor(
    @InjectRepository(Transport)
    private readonly transportRepository: Repository<Transport>,

    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,

    @InjectRepository(Town)
    private readonly townRepo: Repository<Town>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    private readonly entityReviewsService: EntityReviewsService,
    private readonly termsService: TermsService,
    private readonly documentService: DocumentService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly verificationService: VerificationService,
  ) {}

  // ------------------------------------------------------------------------------------------------
  // Resolve the per-owner completion context (T&C acceptance + docs requirements).
  // Mirror of LodgingsService.resolveOwnerCompletionContext so the transport wizard surfaces the
  // same termsStatus + docsStatus shape and the admin can configure required docs per municipio.
  // ------------------------------------------------------------------------------------------------
  async resolveOwnerCompletionContext(
    transport: Transport,
  ): Promise<{ termsStatus: LodgingTermsStatus; docsStatus: LodgingDocsStatus }> {
    const userId = transport.user?.id;
    const townId = transport.town?.id;
    const categoryIds = transport.categories?.map(c => c.id) ?? [];

    const [termsDto, docsList] = await Promise.all([
      userId ? this.termsService.getStatusForUser(userId) : Promise.resolve(null),
      townId
        ? this.documentService.getEntityDocumentStatus(townId, DocumentEntityType.TRANSPORT, transport.id, categoryIds)
        : Promise.resolve([]),
    ]);

    const activeTermsId = termsDto?.activeDocumentIds?.transport ?? null;
    const termsStatus = isTermsEnforcementEnabled()
      ? computeLodgingTermsStatus({
          hasActiveLodgingTerms: activeTermsId !== null,
          hasAcceptedLodgingTerms: termsDto?.hasAcceptedTransportTerms ?? false,
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

  async create(createTransportDto: CreateTransportDto, userId: string) {
    // Premium "información ampliada" can't be set on creation (a new transport isn't Premium yet)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { categoryIds, townId, vehicleModel, capacity, services, coverageTownIds, ...restDto } = createTransportDto;
    const categories = categoryIds ? await this.categoryRepo.findBy({ id: In(categoryIds) }) : [];
    const town = townId ? await this.townRepo.findOneBy({ id: townId }) : undefined;
    if (!town) throw new NotFoundException('Town not found');

    // Usar userId del JWT, no del DTO (seguridad)
    // Check if user already has a transport
    const existingTransport = await this.transportRepository.findOne({
      where: { user: { id: userId } },
    });
    if (existingTransport) {
      throw new ConflictException('User already has a transport associated. Each user can only have one transport.');
    }

    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    const transport = this.transportRepository.create({
      ...restDto,
      categories,
      town,
      user,
    });

    return await this.transportRepository.save(transport);
  }

  async findAll({ filters }: TransportFindAllParams = {}): Promise<TransportListDto> {
    const { page = 1, limit = 25 } = filters ?? {};
    const skip = (page - 1) * limit;
    const { where, order } = generateTransportQueryFiltersAndSort(filters);

    // Freemium gating: status='published' + isPublic=true (no subscription required).
    const [transports, count] = await this.transportRepository.findAndCount({
      skip,
      take: limit,
      relations: { categories: { icon: true }, town: { department: true }, user: true },
      order,
      where: { ...where, status: 'published', isPublic: true },
    });

    return new TransportListDto({ currentPage: page, pages: Math.ceil(count / limit), count }, transports);
  }

  // ------------------------------------------------------------------------------------------------
  // Find all transports paginated (Admin)
  // ------------------------------------------------------------------------------------------------
  async findAllPaginated(filters: AdminTransportFiltersDto & { status?: string }): Promise<AdminTransportListDto> {
    console.log('(TransportService.findAllPaginated): RAW filters →', JSON.stringify(filters));
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
    console.log('(TransportService.findAllPaginated): destructured →', {
      page,
      limit,
      search,
      categoryId,
      townId,
      isPublic,
      status,
      sortBy,
      sortOrder,
    });

    const queryBuilder = this.transportRepository
      .createQueryBuilder('transport')
      .leftJoinAndSelect('transport.town', 'town')
      .leftJoinAndSelect('town.department', 'department')
      .leftJoinAndSelect('transport.categories', 'categories')
      .leftJoinAndSelect('categories.icon', 'categoryIcon')
      .leftJoinAndSelect('transport.user', 'user');

    if (search) {
      queryBuilder.andWhere('(transport.firstName ILIKE :search OR transport.lastName ILIKE :search)', {
        search: `%${search}%`,
      });
    }

    if (categoryId) {
      queryBuilder.andWhere('categories.id = :categoryId', { categoryId });
    }

    if (townId) {
      queryBuilder.andWhere('town.id = :townId', { townId });
    }

    if (isPublic !== undefined) {
      queryBuilder.andWhere('transport.isPublic = :isPublic', { isPublic });
    }

    if (status) {
      console.log('(TransportService.findAllPaginated): applying status filter =', status);
      queryBuilder.andWhere('transport.status = :status', { status });
    } else {
      console.log('(TransportService.findAllPaginated): NO status filter applied');
    }

    // Sorting
    const validSortFields = ['firstName', 'lastName', 'points', 'rating', 'createdAt', 'updatedAt'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'firstName';
    queryBuilder.orderBy(`transport.${sortField}`, sortOrder);

    // Pagination
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    console.log('(TransportService.findAllPaginated): SQL →', queryBuilder.getSql());
    console.log('(TransportService.findAllPaginated): params →', queryBuilder.getParameters());

    const [transports, count] = await queryBuilder.getManyAndCount();
    console.log('(TransportService.findAllPaginated): result → count=', count, 'transports.length=', transports.length);
    if (transports.length > 0) {
      console.log('(TransportService.findAllPaginated): first transport →', {
        id: transports[0].id,
        status: transports[0].status,
        firstName: transports[0].firstName,
      });
    }
    const pages = Math.ceil(count / limit);

    const result = new AdminTransportListDto({ currentPage: page, pages, count }, transports);

    // Admin-only enrichment: per-row T&C acceptance flag for the owner
    const ownerIds = Array.from(new Set(transports.map(t => t.user?.id).filter((id): id is string => !!id)));
    const ownersWithAcceptance = await this.termsService.getOwnersWithAcceptance(TermsTypeEnum.Transport, ownerIds);
    result.data.forEach((dto, i) => {
      const ownerId = transports[i].user?.id;
      dto.ownerHasAcceptedTerms = ownerId ? ownersWithAcceptance.has(ownerId) : false;
    });

    // Per-row completion enrichment so the admin list mirrors the owner-side wizard.
    result.data.forEach((dto, i) => {
      const transport = transports[i];
      const completion = computeTransportCompletion(transport);
      const augmented = dto as TransportDto & {
        completionPercentage?: number;
        infoPercentage?: number;
        status?: string;
      };
      augmented.completionPercentage = completion.completionPercentage;
      augmented.infoPercentage = completion.infoPercentage;
      augmented.status = transport.status;
    });

    return result;
  }

  async findPublicTransports({ filters, user }: TransportFindAllParams = {}) {
    const shouldRandomize = filters?.sortBy === 'random';
    const { page = 1, limit = 25 } = filters ?? {};
    const skip = (page - 1) * limit;
    const { where, order } = generateTransportQueryFiltersAndSort(filters);

    const premiumIds = await this.subscriptionsService.getPremiumIdSet('transport');
    const verifiedIds = await this.verificationService.getVerifiedIdSet('transport');
    const listOptions = {
      skip,
      take: limit,
      relations: { categories: { icon: true }, town: { department: true }, user: true },
      order,
      where: [
        { ...where, isPublic: true, status: 'published' as const },
        { ...where, forcedPublic: true },
      ],
    };

    // Obtener transports y reviews del usuario en paralelo.
    // Premium gets more exposure on the default ordering (freemium): rank before paginating.
    const [result, userReviews] = await Promise.all([
      shouldRankPremiumFirst(filters?.sortBy)
        ? findPagePremiumFirst(this.transportRepository, listOptions, premiumIds)
        : this.transportRepository.findAndCount(listOptions),
      user
        ? this.entityReviewsService.getUserReviews({
            entityType: ReviewDomainsEnum.TRANSPORT,
            userId: user.id,
          })
        : Promise.resolve<Review[]>([]),
    ]);

    const [_transports, count] = result;
    let transports = _transports;

    if (shouldRandomize) {
      transports = sortPremiumFirst(
        transports.sort(() => Math.random() - 0.5),
        premiumIds,
      );
    }

    return {
      currentPage: page,
      pages: Math.ceil(count / limit),
      count,
      data: transports.map(transport => {
        const userReview = userReviews.find(r => r.transport?.id === transport.id);
        const dto = new TransportDto({ data: transport, userReview: userReview?.id });
        dto.isPremium = premiumIds.has(transport.id);
        dto.isVerified = verifiedIds.has(transport.id);
        return dto;
      }),
    };
  }

  async findOne(identifier: string, user?: User) {
    const relations: FindOptionsRelations<Transport> = {
      categories: { icon: true },
      town: { department: true },
      user: true,
      coverageTowns: true,
    };

    const transport = await this.transportRepository.findOne({ where: { id: identifier }, relations });
    if (!transport) throw new NotFoundException('Transport not found');

    const userReview = user
      ? await this.entityReviewsService.findUserReview({
          entityType: ReviewDomainsEnum.TRANSPORT,
          entityId: transport.id,
          userId: user.id,
        })
      : null;

    const dto = new TransportDto({ data: transport, userReview: userReview?.id }) as TransportDto & {
      status?: string;
      submittedAt?: Date | null;
      rejectionReason?: string | null;
      completionPercentage?: number;
      infoPercentage?: number;
      missingFields?: string[];
      infoMissingFields?: string[];
      infoCriticalSatisfied?: boolean;
      readyToSubmit?: boolean;
      termsStatus?: LodgingTermsStatus;
      docsStatus?: LodgingDocsStatus;
    };

    dto.isPremium = await this.subscriptionsService.isPremium('transport', transport.id);
    dto.isVerified = await this.verificationService.isVerified('transport', transport.id);

    const isOwner = !!user && transport.user?.id === user.id;
    // Public visitors only see the Premium extended info while the transport is Premium
    if (!dto.isPremium && !isOwner && !user?.isSuperUser) dto.hideExtendedInfo();
    if (isOwner || user?.isSuperUser) {
      const completion = computeTransportCompletion(transport);
      const { termsStatus, docsStatus } = await this.resolveOwnerCompletionContext(transport);
      const termsBlock = isTermsEnforcementEnabled() && termsStatus.state === 'pendientes';
      dto.status = transport.status;
      dto.submittedAt = transport.submittedAt;
      dto.rejectionReason = transport.rejectionReason;
      dto.completionPercentage = completion.completionPercentage;
      dto.infoPercentage = completion.infoPercentage;
      dto.missingFields = completion.missingFields;
      dto.infoMissingFields = completion.infoMissingFields;
      dto.infoCriticalSatisfied = completion.infoCriticalSatisfied;
      dto.termsStatus = termsStatus;
      dto.docsStatus = docsStatus;
      dto.readyToSubmit = completion.readyToSubmit && !termsBlock;
    }

    return dto;
  }

  // ------------------------------------------------------------------------------------------------
  // Submit transport for review (owner action) — mirror of LodgingsService.submitForReview
  // ------------------------------------------------------------------------------------------------
  async submitForReview({ identifier, user }: { identifier: string; user: User }) {
    const relations: FindOptionsRelations<Transport> = {
      user: true,
      categories: { icon: true },
      town: { department: true },
    };
    const transport = await this.transportRepository.findOne({ where: { id: identifier }, relations });
    if (!transport) throw new NotFoundException('Transport not found');
    if (transport.user?.id !== user.id) throw new ForbiddenException('Not your transport');
    if (transport.status !== 'draft' && transport.status !== 'rejected') {
      throw new BadRequestException({
        message: 'INVALID_STATUS',
        detail: 'Only draft or rejected transports can be submitted',
      });
    }

    const completion = computeTransportCompletion(transport);
    if (completion.infoPercentage < 80 || !completion.infoCriticalSatisfied) {
      throw new BadRequestException({
        errorCode: 'INCOMPLETE',
        infoPercentage: completion.infoPercentage,
        infoMissingFields: completion.infoMissingFields,
        completionPercentage: completion.completionPercentage,
        missingFields: completion.missingFields,
      });
    }

    const context = await this.resolveOwnerCompletionContext(transport);

    if (isTermsEnforcementEnabled() && context.termsStatus.state === 'pendientes') {
      throw new ForbiddenException({
        errorCode: 'TERMS_NOT_ACCEPTED',
        termsType: 'transport',
        activeTermsId: context.termsStatus.activeTermsId ?? null,
      });
    }

    transport.status = 'pending_review';
    transport.submittedAt = new Date();
    transport.rejectionReason = null;
    await this.transportRepository.save(transport);

    const updated = await this.transportRepository.findOne({ where: { id: transport.id }, relations });
    if (!updated) throw new NotFoundException('Transport not found after update');
    return this.findOne(updated.id, user);
  }

  // ------------------------------------------------------------------------------------------------
  // Approve transport (admin action)
  // ------------------------------------------------------------------------------------------------
  async approve({ identifier }: { identifier: string }) {
    const relations: FindOptionsRelations<Transport> = {
      user: true,
      categories: { icon: true },
      town: { department: true },
    };
    const transport = await this.transportRepository.findOne({ where: { id: identifier }, relations });
    if (!transport) throw new NotFoundException('Transport not found');
    if (transport.status !== 'pending_review') {
      throw new BadRequestException({
        message: 'Only pending_review transports can be approved',
        currentStatus: transport.status,
      });
    }
    transport.status = 'published';
    transport.rejectionReason = null;
    await this.transportRepository.save(transport);
    return this.findOne(transport.id, transport.user);
  }

  // ------------------------------------------------------------------------------------------------
  // Reject transport (admin action)
  // ------------------------------------------------------------------------------------------------
  async reject({ identifier, reason }: { identifier: string; reason: string }) {
    const relations: FindOptionsRelations<Transport> = {
      user: true,
      categories: { icon: true },
      town: { department: true },
    };
    const transport = await this.transportRepository.findOne({ where: { id: identifier }, relations });
    if (!transport) throw new NotFoundException('Transport not found');
    if (transport.status !== 'pending_review') {
      throw new BadRequestException({
        message: 'Only pending_review transports can be rejected',
        currentStatus: transport.status,
      });
    }
    transport.status = 'rejected';
    transport.rejectionReason = reason || null;
    await this.transportRepository.save(transport);
    return this.findOne(transport.id, transport.user);
  }

  async update(id: string, updateTransportDto: UpdateTransportDto) {
    const { categoryIds, townId, userId, coverageTownIds, ...restDto } = updateTransportDto;

    // Premium "información ampliada" (vehicle, capacity, services, coverage zones)
    const touchesExtendedInfo =
      coverageTownIds !== undefined ||
      restDto.vehicleModel !== undefined ||
      restDto.capacity !== undefined ||
      restDto.services !== undefined;
    if (touchesExtendedInfo) {
      await this.subscriptionsService.assertPremium('transport', id, 'transport_extended');
    }
    const coverageTowns = coverageTownIds ? await this.townRepo.findBy({ id: In(coverageTownIds) }) : undefined;

    // Solo resolver entities si el PATCH realmente trae el campo — undefined
    // significa "no tocar", para no destruir relaciones al guardar otros steps.
    const categories = categoryIds ? await this.categoryRepo.findBy({ id: In(categoryIds) }) : undefined;
    const town = townId ? await this.townRepo.findOneBy({ id: townId }) : undefined;
    const transport = await this.transportRepository.findOne({ where: { id } });
    if (!transport) throw new NotFoundException('Transport not found');

    // Check if user already has a transport (only if changing user)
    if (userId && userId !== transport.user?.id) {
      const existingTransport = await this.transportRepository.findOne({
        where: { user: { id: userId } },
      });
      if (existingTransport) {
        throw new ConflictException('User already has a transport associated. Each user can only have one transport.');
      }
    }

    const user = userId ? await this.userRepo.findOneBy({ id: userId }) : undefined;

    return this.transportRepository.save({
      ...transport,
      ...restDto,
      ...(categories !== undefined && { categories }),
      ...(coverageTowns !== undefined && { coverageTowns }),
      town: town || undefined,
      user: user || undefined,
    });
  }

  async remove(id: string) {
    const transport = await this.transportRepository.findOne({ where: { id } });
    if (!transport) throw new NotFoundException('Transport not found');

    return this.transportRepository.remove(transport);
  }

  // ------------------------------------------------------------------------------------------------
  // Bulk delete transports (admin)
  // ------------------------------------------------------------------------------------------------
  async bulkDelete(ids: string[]): Promise<{ deleted: number }> {
    if (!ids?.length) return { deleted: 0 };
    let deleted = 0;
    for (const id of ids) {
      try {
        await this.remove(id);
        deleted += 1;
      } catch (err) {
        console.error(`(TransportService.bulkDelete): failed to delete ${id}`, err);
      }
    }
    return { deleted };
  }

  async updateAvailability(id: string, isAvailable: boolean) {
    const transport = await this.transportRepository.findOne({
      where: { id },
      relations: ['categories', 'categories.icon', 'town', 'town.department', 'user'],
    });
    if (!transport) throw new NotFoundException('Transport not found');

    const updatedTransport = await this.transportRepository.save({
      ...transport,
      isAvailable,
    });

    return new TransportDto({ data: updatedTransport });
  }
  // ------------------------------------------------------------------------------------------------
  // Update user in transport
  // ------------------------------------------------------------------------------------------------
  async updateUser(identifier: string, userId: string) {
    const transport = await this.transportRepository.findOne({ where: { id: identifier } });
    if (!transport) throw new NotFoundException('Transport not found');

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Check if user already has a transport (only if changing user)
    if (userId !== transport.user?.id) {
      const existingTransport = await this.transportRepository.findOne({
        where: { user: { id: userId } },
      });
      if (existingTransport) {
        throw new ConflictException('User already has a transport associated. Each user can only have one transport.');
      }
    }

    transport.user = user;
    await this.transportRepository.save(transport);

    return user;
  }

  // ------------------------------------------------------------------------------------------------
  // Update visibility
  // ------------------------------------------------------------------------------------------------
  async updateVisibility(identifier: string, isPublic: boolean) {
    const transport = await this.transportRepository.findOne({ where: { id: identifier } });

    if (!transport) {
      throw new NotFoundException('Transport not found');
    }
    transport.isPublic = isPublic;
    await this.transportRepository.save(transport);
    return { message: 'Transport visibility updated', data: isPublic };
  }
}
