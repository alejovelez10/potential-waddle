import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * v1 knowledge-source edit surface (D-08): the admin UI only toggles whether a
 * source is active and whether semantic (Vertex) search is enabled. All other
 * KS fields (bigquery_table, vertex_data_store_id, last_sync_*) are NOT writable.
 */
export class UpdateKnowledgeSourceDto {
  @ApiProperty({
    description: 'Si la fuente de conocimiento está activa (entra al loop de sync).',
    example: true,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiProperty({
    description: 'Si la fuente se indexa/consulta por búsqueda semántica (Vertex).',
    example: true,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  enableSemanticSearch?: boolean;
}
