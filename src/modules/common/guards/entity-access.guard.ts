import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EntityOwnershipResolver } from '../services/entity-ownership.resolver';

export const ENTITY_ACCESS_KEY = 'entity-access';

/**
 * Stored on the request once the guard passes: the entity type and the REAL ids it resolved
 * (routes may use slugs; after a DELETE the row is gone). The search sync interceptor reads it.
 */
export interface ResolvedEntityAccess {
  entityType: string;
  ids: string[];
  /** Child types (lodging_room_type, commerce_product): their parent business ids. */
  parentIds: string[];
}

/**
 * - manage:   owner, town-admin of the entity's town, or super-admin (edit own business data)
 * - moderate: town-admin of the entity's town or super-admin, NEVER the owner alone
 *             (approve/reject, reassign owner, bulk delete)
 */
export type EntityAccessLevel = 'manage' | 'moderate';

export interface EntityAccessOptions {
  level: EntityAccessLevel;
  /**
   * Key of EntityOwnershipResolver's whitelist (lodging, restaurant, lodging_room_type, …), or
   * `param:<name>` / `body:<field>` when the type travels in the request. Unknown types are
   * rejected by the resolver's whitelist (404).
   */
  entityType: string;
  /** Route param holding the entity id or slug. Defaults to `identifier`. */
  param?: string;
  /** Body field holding a single entity id. Takes precedence over `param`. */
  bodyId?: string;
  /** Body field holding an array of ids (bulk endpoints). Takes precedence over everything. */
  bodyIds?: string;
}

/**
 * Runs after JwtAuthGuard (see the `EntityAccess` decorator). Authorizes the caller against the
 * entity addressed by the route before the handler runs.
 */
@Injectable()
export class EntityAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly ownership: EntityOwnershipResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<EntityAccessOptions | undefined>(ENTITY_ACCESS_KEY, context.getHandler());
    if (!options) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    const entityType = this.resolveEntityType(options.entityType, request);

    let identifiers: string[];
    if (options.bodyIds) {
      const raw = request.body?.[options.bodyIds];
      if (!Array.isArray(raw) || raw.length === 0) {
        throw new BadRequestException(`${options.bodyIds} must be a non-empty array`);
      }
      identifiers = raw.map(String);
    } else if (options.bodyId) {
      identifiers = [String(request.body?.[options.bodyId] ?? '')];
    } else {
      identifiers = [request.params?.[options.param ?? 'identifier']];
    }

    const ids: string[] = [];
    const parentIds: string[] = [];
    for (const identifier of identifiers) {
      const result =
        options.level === 'moderate'
          ? await this.ownership.assertCanModerate(entityType, identifier, user)
          : await this.ownership.assertCanManage(entityType, identifier, user);
      ids.push(result.entityId);
      if (result.parentId) parentIds.push(result.parentId);
    }

    request.entityAccess = { entityType, ids, parentIds } satisfies ResolvedEntityAccess;
    return true;
  }

  private resolveEntityType(entityType: string, request: any): string {
    if (entityType.startsWith('param:')) return String(request.params?.[entityType.slice(6)] ?? '');
    if (entityType.startsWith('body:')) return String(request.body?.[entityType.slice(5)] ?? '');
    return entityType;
  }
}
