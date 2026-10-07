import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseInterceptors,
  UploadedFile,
  ParseIntPipe,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionDto } from './dto/update-promotion.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiConsumes, ApiBody, ApiOperation, ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import { SwaggerTags } from 'src/config/swagger-tags.enum';
import { Promotion, PromotionEntityType } from './entities/promotion.entity';
import { Auth } from '../auth/decorators';
import { GetUser } from '../common/decorators';
import { EntityOwnershipResolver } from '../common/services/entity-ownership.resolver';
import { User } from '../users/entities';
import { SearchSyncSkip } from 'src/modules/search/decorators/search-sync.decorator';

// Search sync: pushed from PromotionsService (it knows the promoted entity).
@SearchSyncSkip()
@Controller('promotions')
@ApiTags(SwaggerTags.Promotions)
export class PromotionsController {
  constructor(
    private readonly promotionsService: PromotionsService,
    private readonly ownership: EntityOwnershipResolver,
  ) {}

  @Post()
  @Auth()
  @ApiOperation({ summary: 'Create a new promotion' })
  @ApiCreatedResponse({
    description: 'The promotion has been successfully created.',
    type: Promotion,
  })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        entityId: {
          type: 'string',
          example: '12345',
          description: 'The entity ID that this promotion belongs to',
        },
        entityType: {
          type: 'string',
          enum: ['lodging', 'restaurant', 'experience', 'guide', 'commerce'],
          example: 'lodging',
          description: 'The type of entity this promotion belongs to',
        },
        name: {
          type: 'string',
          example: 'Summer Special Discount',
          description: 'The name of the promotion',
        },
        description: {
          type: 'string',
          example: 'Get 20% off your stay during summer months',
          description: 'The description of the promotion',
        },
        validFrom: {
          type: 'string',
          format: 'date-time',
          example: '2024-06-01T00:00:00Z',
          description: 'The start date of the promotion validity',
        },
        validTo: {
          type: 'string',
          format: 'date-time',
          example: '2024-08-31T23:59:59Z',
          description: 'The end date of the promotion validity',
        },
        value: {
          type: 'number',
          example: 20,
          description: 'The value of the promotion (percentage or amount)',
        },
        file: {
          type: 'string',
          format: 'binary',
          description: 'The image file for the promotion',
        },
      },
    },
  })
  async create(
    @Body() createPromotionDto: CreatePromotionDto,
    @UploadedFile() file: Express.Multer.File,
    @GetUser() user: User,
  ) {
    await this.ownership.assertCanManage(createPromotionDto.entityType, createPromotionDto.entityId, user);
    return this.promotionsService.create(createPromotionDto, file);
  }

  @Get()
  @ApiOperation({ summary: 'Get all promotions' })
  @ApiOkResponse({
    description: 'The promotions have been successfully retrieved.',
    type: [Promotion],
  })
  findAll(@Query('entityId') entityId?: string, @Query('entityType') entityType?: PromotionEntityType) {
    return this.promotionsService.findAll(entityId, entityType);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a promotion by ID' })
  @ApiOkResponse({
    description: 'The promotion has been successfully retrieved.',
    type: Promotion,
  })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.promotionsService.findOne(id);
  }

  @Patch(':id')
  @Auth()
  @ApiOperation({ summary: 'Update a promotion' })
  @ApiOkResponse({
    description: 'The promotion has been successfully updated.',
    type: Promotion,
  })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        entityId: {
          type: 'string',
          example: '12345',
          description: 'The entity ID that this promotion belongs to',
        },
        entityType: {
          type: 'string',
          enum: ['lodging', 'restaurant', 'experience', 'guide', 'commerce'],
          example: 'lodging',
          description: 'The type of entity this promotion belongs to',
        },
        name: {
          type: 'string',
          example: 'Summer Special Discount',
          description: 'The name of the promotion',
        },
        description: {
          type: 'string',
          example: 'Get 20% off your stay during summer months',
          description: 'The description of the promotion',
        },
        validFrom: {
          type: 'string',
          format: 'date-time',
          example: '2024-06-01T00:00:00Z',
          description: 'The start date of the promotion validity',
        },
        validTo: {
          type: 'string',
          format: 'date-time',
          example: '2024-08-31T23:59:59Z',
          description: 'The end date of the promotion validity',
        },
        value: {
          type: 'number',
          example: 20,
          description: 'The value of the promotion (percentage or amount)',
        },
        file: {
          type: 'string',
          format: 'binary',
          description: 'The image file for the promotion (optional for updates)',
        },
      },
    },
  })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updatePromotionDto: UpdatePromotionDto,
    @GetUser() user: User,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const promotion = await this.promotionsService.findOne(id);
    if (!promotion) throw new NotFoundException('Promotion not found');
    await this.ownership.assertCanManage(promotion.entityType, promotion.entityId, user);
    // Moving a promotion to another entity requires rights over the target too.
    if (updatePromotionDto.entityId && updatePromotionDto.entityId !== promotion.entityId) {
      const targetType = updatePromotionDto.entityType ?? promotion.entityType;
      await this.ownership.assertCanManage(targetType, updatePromotionDto.entityId, user);
    }
    return this.promotionsService.update(id, updatePromotionDto, file);
  }

  @Delete(':id')
  @Auth()
  @ApiOperation({ summary: 'Delete a promotion' })
  @ApiOkResponse({ description: 'The promotion has been successfully deleted.' })
  async remove(@Param('id', ParseIntPipe) id: number, @GetUser() user: User) {
    const promotion = await this.promotionsService.findOne(id);
    if (!promotion) throw new NotFoundException('Promotion not found');
    await this.ownership.assertCanManage(promotion.entityType, promotion.entityId, user);
    return this.promotionsService.remove(id);
  }
}
