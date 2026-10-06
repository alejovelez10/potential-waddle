import { Controller, Post, Get, Delete, Param, Query } from '@nestjs/common';
import { VectorizationService } from './vectorization.service';
import { EntityType } from './chunking.service';
import { SuperAdmin } from '../auth/decorators';

@Controller('vectorization')
@SuperAdmin()
export class VectorizationController {
  constructor(private readonly vectorizationService: VectorizationService) {}

  /**
   * Vectorize all entities (lodging, restaurant, experience, place, guide, transport, commerce)
   * POST /vectorization/all
   */
  @Post('all')
  async vectorizeAll() {
    const results = await this.vectorizationService.vectorizeAll();
    return {
      message: 'Vectorization completed',
      results,
    };
  }

  /**
   * Vectorize entities by type
   * POST /vectorization/:entityType
   */
  @Post(':entityType')
  async vectorizeByType(@Param('entityType') entityType: EntityType) {
    const result = await this.vectorizationService.vectorizeByType(entityType);
    return {
      message: `Vectorization of ${entityType} completed`,
      result,
    };
  }

  /**
   * Delete all vectors from all entity types
   * DELETE /vectorization/all
   */
  @Delete('all')
  async deleteAll() {
    const entityTypes: EntityType[] = [
      'lodging',
      'restaurant',
      'experience',
      'place',
      'guide',
      'transport',
      'commerce',
    ];
    for (const entityType of entityTypes) {
      await this.vectorizationService.deleteByEntityType(entityType);
    }
    return {
      message: 'All vectors deleted',
    };
  }

  /**
   * Delete all vectors for an entity type
   * DELETE /vectorization/:entityType
   */
  @Delete(':entityType')
  async deleteByEntityType(@Param('entityType') entityType: EntityType) {
    await this.vectorizationService.deleteByEntityType(entityType);
    return {
      message: `All ${entityType} vectors deleted`,
    };
  }

  /**
   * Delete a specific entity vector
   * DELETE /vectorization/:entityType/:entityId
   */
  @Delete(':entityType/:entityId')
  async deleteEntity(@Param('entityType') entityType: EntityType, @Param('entityId') entityId: string) {
    await this.vectorizationService.deleteEntity(entityType, entityId);
    return {
      message: `Vector ${entityType}_${entityId} deleted`,
    };
  }

  /**
   * Search for similar entities
   * GET /vectorization/search?query=...&entityType=...&topK=...
   */
  @Get('search')
  async search(
    @Query('query') query: string,
    @Query('entityType') entityType?: EntityType,
    @Query('townId') townId?: string,
    @Query('department') department?: string,
    @Query('topK') topK?: string,
  ) {
    const results = await this.vectorizationService.search(query, {
      entityType,
      townId,
      department,
      topK: topK ? parseInt(topK, 10) : 10,
    });

    return {
      query,
      count: results.length,
      results,
    };
  }
}
