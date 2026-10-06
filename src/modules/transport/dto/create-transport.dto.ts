import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { parseArrayValue } from 'src/utils';

export class CreateTransportDto {
  // * ----------------------------------------------------------------------------------------------------------------
  // * -------------------------------------- PERSONAL INFO -----------------------------------------------------------
  // * ----------------------------------------------------------------------------------------------------------------
  @ApiProperty({
    example: 'john.doe@example.com',
    description: 'Email address of the transport provider',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: 'John',
    description: 'The first name of the transport provider',
  })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({
    example: 'Doe',
    description: 'The last name of the transport provider',
  })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  // * ----------------------------------------------------------------------------------------------------------------
  // * -------------------------------------- DOCUMENT INFO ----------------------------------------------------------
  // * ----------------------------------------------------------------------------------------------------------------
  @ApiProperty({
    example: 'CC',
    description: 'The type of identification document',
  })
  @IsString()
  @IsNotEmpty()
  documentType: string;

  @ApiProperty({
    example: '1234567890',
    description: 'The identification document number',
  })
  @IsString()
  @IsNotEmpty()
  document: string;

  // * ----------------------------------------------------------------------------------------------------------------
  // * -------------------------------------- CONTACT INFO -----------------------------------------------------------
  // * ----------------------------------------------------------------------------------------------------------------
  @ApiProperty({
    example: '+573001234567',
    description: 'Phone number of the transport provider',
  })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({
    example: '+573001234567',
    description: 'WhatsApp number of the transport provider',
    required: false,
  })
  @IsString()
  @IsOptional()
  whatsapp?: string;

  // * ----------------------------------------------------------------------------------------------------------------
  // * -------------------------------------- SERVICE INFO -----------------------------------------------------------
  // * ----------------------------------------------------------------------------------------------------------------
  @ApiProperty({
    example: '08:00',
    description: 'Start time of service availability',
  })
  @IsString()
  @IsOptional()
  startTime?: string;

  @ApiProperty({
    example: '18:00',
    description: 'End time of service availability',
  })
  @IsString()
  @IsOptional()
  endTime?: string;

  @ApiProperty({
    example: true,
    description: 'Whether the transport provider is currently available',
    default: true,
  })
  @IsBoolean()
  @Type(() => Boolean)
  @IsOptional()
  isAvailable?: boolean;

  @ApiProperty({
    example: 'ABC123',
    description: 'License plate of the vehicle',
  })
  @IsString()
  @IsOptional()
  licensePlate?: string;

  // * ---------------------------------------------------------------------------------------------------------------
  // * PREMIUM — información ampliada (only editable while the transport is Premium)
  // * ---------------------------------------------------------------------------------------------------------------

  @ApiProperty({ example: 'Motocarro Bajaj RE 2022', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  vehicleModel?: string;

  @ApiProperty({ example: 4, description: 'Passenger capacity', required: false })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  capacity?: number;

  @ApiProperty({ example: 'Traslados al embalse, mudanzas pequeñas, tours por veredas', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  services?: string;

  @ApiProperty({ example: ['123e4567-e89b-12d3-a456-426614174000'], description: 'Coverage towns', required: false })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  coverageTownIds?: string[];

  @ApiProperty({
    example: ['cash', 'card'],
    description: 'Payment method',
    required: false,
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  paymentMethods?: string[];
  // * ----------------------------------------------------------------------------------------------------------------
  // * -------------------------------------- RELATIONSHIPS ----------------------------------------------------------
  // * ----------------------------------------------------------------------------------------------------------------
  @ApiProperty({
    description: 'Town ID where the transport service operates',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID('4')
  @IsNotEmpty()
  townId: string;

  @ApiProperty({
    description: 'User ID associated with this transport provider',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID('4')
  @IsOptional()
  userId: string;

  @ApiProperty({
    description: 'Categories IDs for the transport service',
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsUUID('4', { each: true })
  @IsArray()
  @Transform(({ value }) => parseArrayValue(value))
  categoryIds?: string[];

  @ApiProperty({
    example: true,
    description: 'Whether the transport provider is currently available',
    default: true,
  })
  @IsBoolean()
  @Type(() => Boolean)
  @IsOptional()
  isPublic?: boolean;
}
