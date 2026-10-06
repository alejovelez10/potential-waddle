import { PromotionEntityType } from '../entities/promotion.entity';
import { ApiProperty } from '@nestjs/swagger';

export class FileUploadDto {
  @ApiProperty({
    description: 'The entity ID that this promotion belongs to',
    example: '12345',
  })
  entityId: string;

  @ApiProperty({
    description: 'The type of entity this promotion belongs to',
    enum: ['lodging', 'restaurant', 'experience', 'guide', 'commerce'],
    example: 'lodging',
  })
  entityType: PromotionEntityType;

  @ApiProperty({
    description: 'The slug of the entity (optional, will be fetched if not provided)',
    example: 'hotel-binntu-amazing',
    required: false,
  })
  entitySlug?: string;

  @ApiProperty({
    description: 'The name of the promotion',
    example: 'Summer Special Discount',
  })
  name: string;

  @ApiProperty({
    description: 'The description of the promotion',
    example: 'Get 20% off your stay during summer months',
  })
  description: string;

  @ApiProperty({
    description: 'The start date of the promotion validity',
    example: '2024-06-01T00:00:00Z',
  })
  validFrom: string;

  @ApiProperty({
    description: 'The end date of the promotion validity',
    example: '2024-08-31T23:59:59Z',
  })
  validTo: string;

  @ApiProperty({
    description: 'The value of the promotion (percentage or amount)',
    example: 20,
  })
  value: number;

  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'The image file for the promotion',
  })
  file: Express.Multer.File;
}

export class UpdateFileUploadDto {
  @ApiProperty({
    description: 'The entity ID that this promotion belongs to',
    example: '12345',
    required: false,
  })
  entityId?: string;

  @ApiProperty({
    description: 'The type of entity this promotion belongs to',
    enum: ['lodging', 'restaurant', 'experience', 'guide', 'commerce'],
    example: 'lodging',
    required: false,
  })
  entityType?: PromotionEntityType;

  @ApiProperty({
    description: 'The slug of the entity (optional, will be fetched if not provided)',
    example: 'hotel-binntu-amazing',
    required: false,
  })
  entitySlug?: string;

  @ApiProperty({
    description: 'The name of the promotion',
    example: 'Summer Special Discount',
    required: false,
  })
  name?: string;

  @ApiProperty({
    description: 'The description of the promotion',
    example: 'Get 20% off your stay during summer months',
    required: false,
  })
  description?: string;

  @ApiProperty({
    description: 'The start date of the promotion validity',
    example: '2024-06-01T00:00:00Z',
    required: false,
  })
  validFrom?: string;

  @ApiProperty({
    description: 'The end date of the promotion validity',
    example: '2024-08-31T23:59:59Z',
    required: false,
  })
  validTo?: string;

  @ApiProperty({
    description: 'The value of the promotion (percentage or amount)',
    example: 20,
    required: false,
  })
  value?: number;

  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'The image file for the promotion (optional)',
    required: false,
  })
  file?: Express.Multer.File;
}
