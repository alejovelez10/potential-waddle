/**
 * SQL fragments shared by the record builders. Table/column names are fixed literals (never user
 * input); entity ids always travel as bound parameters. Each fragment returns JSON so a whole
 * record loads in one round trip per type.
 */

/** `{ id, slug, name, department, lat, lng }` of the town joined as `t` / department `d`. */
export const TOWN_JSON = `CASE WHEN t.id IS NULL THEN NULL ELSE json_build_object(
  'id', t.id, 'slug', t.slug, 'name', t.name, 'department', d.name, 'isEnable', t.is_enable,
  'lat', ST_Y(t.location::geometry), 'lng', ST_X(t.location::geometry)
) END`;

/** Enabled categories or facilities of an entity, through its join table. */
export function taxonomyJson(
  kind: 'category' | 'facility',
  joinTable: string,
  fkColumn: string,
  alias: string,
): string {
  const table = kind === 'category' ? 'category' : 'facility';
  const fk = kind === 'category' ? 'category_id' : 'facility_id';
  return `COALESCE((
    SELECT json_agg(json_build_object('id', x.id, 'slug', x.slug, 'name', x.name, 'icon', ai.code) ORDER BY x.name)
    FROM "${joinTable}" j
    JOIN "${table}" x ON x.id = j.${fk}
    LEFT JOIN "app_icon" ai ON ai.id = x.icon_id
    WHERE j.${fkColumn} = ${alias}.id AND x.is_enabled
  ), '[]'::json)`;
}

/** Public image urls of an entity in display order. */
export function imagesJson(
  imageTable: string,
  fkColumn: string,
  alias: string,
  { orderColumn = '"order"', hasPublicFlag = true }: { orderColumn?: string; hasPublicFlag?: boolean } = {},
): string {
  return `COALESCE((
    SELECT json_agg(ir.url ORDER BY i.${orderColumn} NULLS LAST, i.created_at)
    FROM "${imageTable}" i
    JOIN "image_resource" ir ON ir.id = i.image_resource_id
    WHERE i.${fkColumn} = ${alias}.id ${hasPublicFlag ? 'AND i.is_public IS NOT FALSE' : ''} AND ir.url IS NOT NULL
  ), '[]'::json)`;
}

export const lat = (column: string) => `ST_Y(${column}::geometry)`;
export const lng = (column: string) => `ST_X(${column}::geometry)`;

/** `WHERE` for "these ids" (partial reindex) vs "everything visible" (full reindex). */
export function whereClause(alias: string, visibleSql: string, ids?: string[]): { sql: string; params: unknown[] } {
  if (ids) return { sql: `${alias}.id = ANY($1::uuid[])`, params: [ids] };
  return { sql: visibleSql, params: [] };
}
