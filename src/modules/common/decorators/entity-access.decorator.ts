import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import {
  ENTITY_ACCESS_KEY,
  EntityAccessGuard,
  EntityAccessLevel,
  EntityAccessOptions,
} from '../guards/entity-access.guard';

/**
 * Requires a logged-in user with rights over the entity addressed by the route.
 *
 * @example
 *   @Patch(':identifier')
 *   @EntityAccess('manage', 'lodging')                         // owner / town-admin / super
 *   @Post('admin/bulk-delete')
 *   @EntityAccess('moderate', 'lodging', { bodyIds: 'ids' })   // town-admin / super, per id
 *
 * The module using it must import CommonModule (it provides EntityOwnershipResolver).
 */
export function EntityAccess(
  level: EntityAccessLevel,
  entityType: string,
  options: Pick<EntityAccessOptions, 'param' | 'bodyId' | 'bodyIds'> = {},
) {
  return applyDecorators(
    SetMetadata(ENTITY_ACCESS_KEY, { level, entityType, ...options } satisfies EntityAccessOptions),
    UseGuards(JwtAuthGuard, EntityAccessGuard),
    ApiBearerAuth(),
    ApiUnauthorizedResponse({ description: 'Access to this route requires authentication.' }),
    ApiForbiddenResponse({ description: 'The user has no rights over this entity.' }),
  );
}
