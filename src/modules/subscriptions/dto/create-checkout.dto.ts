import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsUUID,
  ValidateNested,
  ArrayMinSize,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EntityType } from '../entities';

export class CheckoutItemDto {
  @ApiProperty({ example: '624013aa-9555-4a69-bf08-30cf990c56dd', description: 'Plan ID' })
  @IsUUID()
  planId: string;

  @ApiProperty({
    example: 'lodging',
    enum: ['lodging', 'restaurant', 'commerce', 'transport', 'guide'],
  })
  @IsEnum(['lodging', 'restaurant', 'commerce', 'transport', 'guide'])
  entityType: EntityType;

  @ApiProperty({ example: '624013aa-9555-4a69-bf08-30cf990c56dd', description: 'Business entity ID' })
  @IsUUID()
  entityId: string;

  @ApiProperty({ example: 'Hotel San Rafael', description: 'Business name for reference' })
  @IsString()
  @IsNotEmpty()
  entityName: string;

  @ApiProperty({
    example: false,
    required: false,
    description:
      '"Registro asistido Premium": allows paying while the business is still a draft (the Binntu team helps complete it). Otherwise the business must be published first.',
  })
  @IsOptional()
  @IsBoolean()
  assisted?: boolean;
}

export class CreateCheckoutDto {
  @ApiProperty({
    type: [CheckoutItemDto],
    description: 'List of businesses to subscribe',
    example: [
      { planId: 'uuid', entityType: 'lodging', entityId: 'uuid', entityName: 'Hotel San Rafael' },
      { planId: 'uuid', entityType: 'restaurant', entityId: 'uuid', entityName: 'Restaurante La Esquina' },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items: CheckoutItemDto[];
}

// Response cuando se crea el checkout (antes de pagar)
export class CheckoutResponseDto {
  @ApiProperty({ example: '624013aa-9555-4a69-bf08-30cf990c56dd' })
  paymentId: string;

  @ApiProperty({ example: 'BINNTU-PAY-1234567890' })
  reference: string;

  @ApiProperty({ example: 16980000, description: 'Total amount in cents' })
  amountInCents: number;

  @ApiProperty({ example: 169800, description: 'Total amount formatted' })
  amount: number;

  @ApiProperty({ example: 'COP' })
  currency: string;

  @ApiProperty({ example: 'pub_test_xxx', description: 'Wompi public key for widget' })
  publicKey: string;

  @ApiProperty({ example: 'sha256hash', description: 'Integrity signature for widget' })
  signature: string;

  @ApiProperty({ example: 'https://binntu.com/profile/suscripciones', description: 'Redirect URL after payment' })
  redirectUrl: string;

  @ApiProperty({
    example: [
      { entityName: 'Hotel San Rafael', planName: 'Pro', price: 99900 },
      { entityName: 'Restaurante', planName: 'Básico', price: 69900 },
    ],
  })
  items: {
    entityName: string;
    planName: string;
    priceInCents: number;
    price: number;
  }[];
}
