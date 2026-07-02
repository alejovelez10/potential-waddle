import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

/**
 * Payload to trigger a catalog sync in rafa. `target` selects which pipeline the
 * admin wants to refresh; rafa v1 runs the full BQ→Vertex pipeline regardless and
 * records `target` in the response/log. Defaults to 'all' when omitted.
 */
export class TriggerSyncDto {
  @ApiProperty({
    description: 'Qué sincronizar: solo BigQuery, solo Vertex, o todo.',
    example: 'all',
    required: false,
    default: 'all',
    enum: ['bigquery', 'vertex', 'all'],
  })
  @IsIn(['bigquery', 'vertex', 'all'])
  @IsOptional()
  target?: 'bigquery' | 'vertex' | 'all';
}
