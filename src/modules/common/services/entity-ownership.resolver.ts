// BIZ-08 / T-17-01/02/05: the IDOR gate for per-entity reads and writes.
//
// Resolves the entity's owner + town(s) and authorizes the caller:
//   - assertCanRead / assertCanManage: super-admin, the entity owner, or a town-admin of its town
//   - assertCanModerate:               super-admin or a town-admin of its town (NEVER the owner —
//                                      owners must not approve/reject their own business)
// Anyone else gets a ForbiddenException (403). A missing entity gets NotFoundException (404).
//
// Security (T-17-05): entityId/town values are ALWAYS passed as bound parameters ($1). The
// table name is selected from a fixed whitelist keyed by entityType — user input never reaches
// the SQL string. An unknown entityType maps to nothing => treated as not-found.
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { DataSource } from 'typeorm';
import { User } from 'src/modules/users/entities';

interface OwnerRow {
  id: string;
  user_id: string | null;
  town_id: string | null;
  /** Child types only: id of the parent business (lodging / commerce). */
  parent_id?: string | null;
}

interface ResolvedEntity {
  id: string;
  parentId: string | null;
  ownerId: string | null;
  townIds: (string | null)[];
}

/** What the assert* methods return: the town for tenant context + the resolved ids (search sync). */
export interface EntityAccessResult {
  townId: string | null;
  /** Real id of the entity (routes may address it by slug). */
  entityId: string;
  /** Child types only: the parent business id. */
  parentId: string | null;
}

/**
 * Fixed, whitelisted owner-resolution SQL per entity type. Each returns at most one row with
 * `id`, `user_id` (owner, NULL where the entity has no owner column) and `town_id` (NULL for
 * guide — guide town lives in the guide_town join table, resolved separately). `{key}` is the
 * lookup column (`id`, or `slug` for types listed in SLUG_TYPES); the value is bound as $1.
 */
const OWNER_QUERY: Record<string, string> = {
  lodging: 'SELECT id, user_id, town_id FROM "lodging" WHERE {key} = $1',
  restaurant: 'SELECT id, user_id, town_id FROM "restaurant" WHERE {key} = $1',
  commerce: 'SELECT id, user_id, town_id FROM "commerce" WHERE {key} = $1',
  transport: 'SELECT id, user_id, town_id FROM "transport" WHERE {key} = $1',
  // guide has no town_id column — town(s) come from guide_town (see resolveGuideTowns)
  guide: 'SELECT id, user_id, NULL::uuid AS town_id FROM "guide" WHERE {key} = $1',
  // experience has no owner column — owner is the guide's user; town is on experience
  experience:
    'SELECT e.id, g.user_id AS user_id, e.town_id AS town_id FROM "experience" e LEFT JOIN "guide" g ON g.id = e.guide_id WHERE e.{key} = $1',
  // place is admin-managed: no owner column, town-scoped only
  place: 'SELECT id, NULL::uuid AS user_id, town_id FROM "place" WHERE {key} = $1',
  public_event: 'SELECT id, user_id, town_id FROM "public_event" WHERE {key} = $1',
  // Children resolve ownership through their parent business
  lodging_room_type:
    'SELECT rt.id, l.user_id, l.town_id, l.id AS parent_id FROM "lodging_room_type" rt JOIN "lodging" l ON l.id = rt.lodging_id WHERE rt.{key} = $1',
  commerce_product:
    'SELECT p.id, c.user_id, c.town_id, c.id AS parent_id FROM "commerce_product" p JOIN "commerce" c ON c.id = p.commerce_id WHERE p.{key} = $1',
};

/** Types that can also be addressed by slug (routes like PATCH /guides/:slug). */
const SLUG_TYPES = new Set(['lodging', 'restaurant', 'commerce', 'guide', 'experience', 'place', 'public_event']);

@Injectable()
export class EntityOwnershipResolver {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Authorize `user` to read analytics for (entityType, entityId).
   * @returns the resolved `{ townId }` (the entity's town, for downstream tenant context).
   * @throws NotFoundException if the entity (or entityType) does not exist.
   * @throws ForbiddenException if the user is neither owner, town-admin of its town, nor super.
   */
  async assertCanRead(entityType: string, entityId: string, user: User): Promise<EntityAccessResult> {
    return this.assertOwnerOrAdmin(entityType, entityId, user, 'No tienes acceso a las analíticas de este negocio');
  }

  /**
   * Authorize `user` to modify owner-managed data of (entityType, entityId): promotions,
   * documents, verification requests. Same rule as reads: owner, town-admin or super.
   */
  async assertCanManage(entityType: string, entityId: string, user: User): Promise<EntityAccessResult> {
    return this.assertOwnerOrAdmin(entityType, entityId, user, 'No tienes permisos sobre este negocio');
  }

  /**
   * Authorize `user` to moderate (approve/reject) (entityType, entityId): super-admin or a
   * town-admin of the entity's town. The owner alone is NOT enough.
   */
  async assertCanModerate(entityType: string, entityId: string, user: User): Promise<EntityAccessResult> {
    const { id, parentId, townIds } = await this.resolve(entityType, entityId);

    if (user?.isSuperUser) return { townId: townIds[0] ?? null, entityId: id, parentId };

    const matchedTown = this.matchAdminTown(townIds, user);
    if (matchedTown) return { townId: matchedTown, entityId: id, parentId };

    throw new ForbiddenException('Solo un administrador puede realizar esta acción');
  }

  /** Authorize `user` to administer town-scoped config (e.g. document requirements): super or town-admin. */
  assertCanAdminTown(townId: string, user: User): void {
    if (user?.isSuperUser) return;
    if (this.matchAdminTown([townId], user)) return;
    throw new ForbiddenException('Solo un administrador del municipio puede realizar esta acción');
  }

  private async assertOwnerOrAdmin(
    entityType: string,
    entityId: string,
    user: User,
    forbiddenMessage: string,
  ): Promise<EntityAccessResult> {
    const { id, parentId, ownerId, townIds } = await this.resolve(entityType, entityId);

    // Super-admin sees everything.
    if (user?.isSuperUser) {
      return { townId: townIds[0] ?? null, entityId: id, parentId };
    }

    const isOwner = !!ownerId && ownerId === user?.id;
    // Prefer the town the caller administers (so downstream tenant context matches), else first.
    const matchedTown = this.matchAdminTown(townIds, user);

    if (isOwner || matchedTown) {
      return { townId: matchedTown ?? townIds[0] ?? null, entityId: id, parentId };
    }

    throw new ForbiddenException(forbiddenMessage);
  }

  private matchAdminTown(townIds: (string | null)[], user: User): string | null {
    const userTownIds = new Set((user?.towns ?? []).map(t => t.id));
    return townIds.find((tid): tid is string => !!tid && userTownIds.has(tid)) ?? null;
  }

  private async resolve(entityType: string, identifier: string): Promise<ResolvedEntity> {
    const template = OWNER_QUERY[entityType];
    if (!template || !identifier) throw new NotFoundException('Entidad no encontrada');

    // Look up by id; by slug only for types that have one. A non-uuid id would make Postgres
    // throw (500) — treat it as not-found instead.
    const key = isUUID(identifier) ? 'id' : SLUG_TYPES.has(entityType) ? 'slug' : null;
    if (!key) throw new NotFoundException('Entidad no encontrada');

    const rows: OwnerRow[] = await this.dataSource.query(template.replace('{key}', key), [identifier]);
    const row = rows?.[0];
    if (!row) throw new NotFoundException('Entidad no encontrada');

    // Guide stores its towns in guide_town (a guide can belong to several towns).
    const townIds: (string | null)[] = entityType === 'guide' ? await this.resolveGuideTowns(row.id) : [row.town_id];

    return { id: row.id, parentId: row.parent_id ?? null, ownerId: row.user_id, townIds };
  }

  /** Resolve the set of town_ids a guide belongs to (guide_town join table). */
  private async resolveGuideTowns(guideId: string): Promise<(string | null)[]> {
    const rows: { town_id: string }[] = await this.dataSource.query(
      'SELECT town_id FROM "guide_town" WHERE guide_id = $1',
      [guideId],
    );
    return rows.map(r => r.town_id);
  }
}
