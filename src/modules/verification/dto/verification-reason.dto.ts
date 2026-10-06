import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class VerificationReasonDto {
  @ApiProperty({ example: 'El RUT no coincide con el nombre del negocio' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}
