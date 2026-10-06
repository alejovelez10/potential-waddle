import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { Promotion, PromotionEntityType } from './entities/promotion.entity';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionDto } from './dto/update-promotion.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CloudinaryPresets } from 'src/config';
import { SubscriptionsService } from '../subscriptions/services';

@Injectable()
export class PromotionsService {
  constructor(
    @InjectRepository(Promotion)
    private readonly promotionRepository: Repository<Promotion>,
    private readonly cloudinaryService: CloudinaryService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async create(createPromotionDto: CreatePromotionDto, file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Image is required');
    }

    // Promotions are a Premium benefit (freemium)
    await this.subscriptionsService.assertPremium(
      createPromotionDto.entityType,
      createPromotionDto.entityId,
      'promotions',
    );

    const cloudinaryResponse = await this.cloudinaryService.uploadImage({
      file,
      fileName: createPromotionDto.name,
      preset: CloudinaryPresets.DEFAULT, // You might want to create a specific preset for promotions
    });

    if (!cloudinaryResponse) {
      throw new BadRequestException('Error uploading image');
    }

    // Obtener el slug de la entidad si no se proporcionó
    let entitySlug = createPromotionDto.entitySlug;
    if (!entitySlug) {
      entitySlug = (await this.getEntitySlug(createPromotionDto.entityType, createPromotionDto.entityId)) || undefined;
    }

    const promotion = this.promotionRepository.create({
      ...createPromotionDto,
      entitySlug,
      image: cloudinaryResponse.url,
      validFrom: new Date(createPromotionDto.validFrom),
      validTo: new Date(createPromotionDto.validTo),
    });

    return this.promotionRepository.save(promotion);
  }

  async findAll(entityId?: string, entityType?: PromotionEntityType) {
    const whereCondition: any = {};

    if (entityId) {
      whereCondition.entityId = entityId;
    }

    if (entityType) {
      whereCondition.entityType = entityType;
    }

    let promotions = await this.promotionRepository.find({
      where: Object.keys(whereCondition).length > 0 ? whereCondition : undefined,
      order: { createdAt: 'DESC' },
    });

    // Public browsing (no entityId): only promotions of Premium businesses are shown. When the
    // Premium lapses the promotion disappears publicly, but the owner still sees it by entityId.
    if (!entityId) {
      const types = [...new Set(promotions.map(p => p.entityType))];
      const premiumByType = new Map(
        await Promise.all(
          types.map(async type => [type, await this.subscriptionsService.getPremiumIdSet(type)] as const),
        ),
      );
      promotions = promotions.filter(p => premiumByType.get(p.entityType)?.has(p.entityId));
    }

    // Enriquecer promociones con información de la entidad
    const enrichedPromotions = await Promise.all(
      promotions.map(async promotion => {
        const entityInfo = await this.getEntityInfo(promotion.entityType, promotion.entityId);
        return {
          ...promotion,
          entityName: entityInfo?.name || null,
          entityWhatsapp: entityInfo?.whatsapp || null,
        };
      }),
    );

    return enrichedPromotions;
  }

  async hasActivePromotions(entityId: string, entityType: PromotionEntityType): Promise<boolean> {
    const now = new Date();

    const count = await this.promotionRepository.count({
      where: {
        entityId,
        entityType,
        validFrom: LessThanOrEqual(now),
        validTo: MoreThanOrEqual(now),
      },
    });

    return count > 0;
  }

  async getLatestActivePromotion(entityId: string, entityType: PromotionEntityType) {
    const now = new Date();

    const promotion = await this.promotionRepository.findOne({
      where: {
        entityId,
        entityType,
        validFrom: LessThanOrEqual(now),
        validTo: MoreThanOrEqual(now),
      },
      order: { createdAt: 'DESC' },
    });

    return promotion;
  }

  async getActivePromotions(entityId: string, entityType: PromotionEntityType) {
    const now = new Date();

    const promotions = await this.promotionRepository.find({
      where: {
        entityId,
        entityType,
        validFrom: LessThanOrEqual(now),
        validTo: MoreThanOrEqual(now),
      },
      order: { createdAt: 'DESC' },
    });

    return promotions;
  }

  private async getEntityInfo(entityType: string, entityId: string) {
    try {
      // Esto requiere inyectar los servicios correspondientes o usar TypeORM directamente
      // Por ahora voy a usar consultas SQL directas
      let query = '';
      const params = [entityId];

      switch (entityType) {
        case 'lodging':
          query = `
            SELECT name, whatsapp_numbers[1] as whatsapp 
            FROM lodging 
            WHERE id = $1
          `;
          break;
        case 'restaurant':
          query = `
            SELECT name, whatsapp_numbers[1] as whatsapp 
            FROM restaurant 
            WHERE id = $1
          `;
          break;
        case 'commerce':
          query = `
            SELECT name, whatsapp_numbers[1] as whatsapp
            FROM commerce
            WHERE id = $1
          `;
          break;
        case 'experience':
          query = `
            SELECT e.title as name, g.whatsapp 
            FROM experience e
            LEFT JOIN guide g ON e.guide_id = g.id
            WHERE e.id = $1
          `;
          break;
        case 'guide':
          query = `
            SELECT CONCAT(first_name, ' ', last_name) as name, whatsapp 
            FROM guide 
            WHERE id = $1
          `;
          break;
        default:
          return null;
      }

      const result = await this.promotionRepository.query(query, params);
      return result[0] || null;
    } catch (error) {
      console.error('Error fetching entity info:', error);
      return null;
    }
  }

  private async getEntitySlug(entityType: string, entityId: string): Promise<string | null> {
    try {
      let query = '';
      const params = [entityId];

      switch (entityType) {
        case 'lodging':
          query = 'SELECT slug FROM lodging WHERE id = $1';
          break;
        case 'restaurant':
          query = 'SELECT slug FROM restaurant WHERE id = $1';
          break;
        case 'commerce':
          query = 'SELECT slug FROM commerce WHERE id = $1';
          break;
        case 'experience':
          query = 'SELECT slug FROM experience WHERE id = $1';
          break;
        case 'guide':
          query = 'SELECT slug FROM guide WHERE id = $1';
          break;
        default:
          return null;
      }

      const result = await this.promotionRepository.query(query, params);
      return result[0]?.slug || null;
    } catch (error) {
      console.error('Error fetching entity slug:', error);
      return null;
    }
  }

  async findOne(id: number) {
    const promotion = await this.promotionRepository.findOne({ where: { id } });

    if (!promotion) {
      return null;
    }

    // Enriquecer con información de la entidad
    const entityInfo = await this.getEntityInfo(promotion.entityType, promotion.entityId);

    return {
      ...promotion,
      entityName: entityInfo?.name || null,
      entityWhatsapp: entityInfo?.whatsapp || null,
    };
  }

  async update(id: number, updatePromotionDto: UpdatePromotionDto, file?: Express.Multer.File) {
    const promotion = await this.findOne(id);
    if (!promotion) {
      throw new NotFoundException(`Promotion with ID ${id} not found`);
    }

    let imageUrl = promotion.image;
    if (file) {
      // Delete old image
      if (promotion.image) {
        const publicId = promotion.image.split('/').pop()?.split('.')[0];
        if (publicId) {
          await this.cloudinaryService.destroyFile(publicId);
        }
      }

      const cloudinaryResponse = await this.cloudinaryService.uploadImage({
        file,
        fileName: updatePromotionDto.name || promotion.name,
        preset: CloudinaryPresets.DEFAULT,
      });

      if (!cloudinaryResponse) {
        throw new BadRequestException('Error uploading image');
      }
      imageUrl = cloudinaryResponse.url;
    }

    const updatedPromotion = {
      ...promotion,
      ...updatePromotionDto,
      image: imageUrl,
      ...(updatePromotionDto.validFrom && { validFrom: new Date(updatePromotionDto.validFrom) }),
      ...(updatePromotionDto.validTo && { validTo: new Date(updatePromotionDto.validTo) }),
    };

    return this.promotionRepository.save(updatedPromotion);
  }

  async remove(id: number) {
    const promotion = await this.findOne(id);
    if (!promotion) {
      throw new NotFoundException(`Promotion with ID ${id} not found`);
    }

    if (promotion.image) {
      const publicId = promotion.image.split('/').pop()?.split('.')[0];
      if (publicId) {
        await this.cloudinaryService.destroyFile(publicId);
      }
    }

    return this.promotionRepository.remove(promotion);
  }
}
