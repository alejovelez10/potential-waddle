import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AssistanceStatus } from '../entities';

export class AdminUpdateAssistanceDto {
  @ApiProperty({ enum: ['none', 'pending', 'contacted', 'completed'], example: 'contacted' })
  @IsIn(['none', 'pending', 'contacted', 'completed'])
  status: AssistanceStatus;

  @ApiProperty({ required: false, nullable: true, example: 'Llamado el 7/10, envía fotos el viernes' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
