import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';

/**
 * Full set of tool ids a skill should be granted. The service reconciles the
 * `skill_allowed_tool` join to EXACTLY these ids (delete-missing + insert-new).
 */
export class AssignToolsDto {
  @ApiProperty({
    description: 'Ids (uuid v4) de los tools que el skill debe tener asignados (set completo).',
    example: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
    required: true,
    type: [String],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  toolIds: string[];
}
