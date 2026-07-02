import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Payload to create a Rafa skill. `body` is the persona/instructions text
 * injected into the system prompt — it is intentionally UNBOUNDED (no length
 * cap): a skill body is a full persona/tone document (RESEARCH Pitfall 6).
 */
export class CreateSkillDto {
  @ApiProperty({
    description: 'Nombre del skill (único entre skills activos).',
    example: 'rafa-persona',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Descripción corta del skill (aparece en el índice de skills).',
    example: 'La persona y el tono base de Rafa.',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({
    description:
      'Cuerpo/instrucciones del skill inyectadas al prompt (texto libre, sin tope de longitud).',
    example: 'Sos Rafa, el guía turístico de San Rafael...',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiProperty({
    description: 'Patrones (glob) de tools permitidos, evaluados contra tool.name.',
    example: ['query_*', 'semantic_search'],
    required: false,
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  allowedToolPatterns?: string[];

  @ApiProperty({
    description: 'Si Rafa puede auto-invocar el skill sin que aparezca en el índice.',
    example: true,
    required: false,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  autoInvoke?: boolean;

  @ApiProperty({
    description: 'Si el skill se inyecta SIEMPRE al prompt (no solo por índice).',
    example: false,
    required: false,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  alwaysActive?: boolean;

  @ApiProperty({
    description: 'Si el skill está activo (Rafa lo resuelve por turno).',
    example: true,
    required: false,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
