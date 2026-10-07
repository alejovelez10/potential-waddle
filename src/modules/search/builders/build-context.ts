import type { DataSource } from 'typeorm';

import type {
  SearchBadge,
  SearchTaxonomy,
  SearchTaxonomyItem,
  SearchTown,
} from '../interfaces/search-record.interface';
import type { SearchType } from '../search.constants';

/** Raw category/facility as returned by `taxonomyJson`. */
export interface RawTaxonomyItem {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
}

export interface RawTown {
  id: string;
  slug: string | null;
  name: string;
  department: string | null;
  isEnable: boolean;
  lat: number | null;
  lng: number | null;
}

/**
 * Everything a builder needs besides the entity row, loaded once per batch (never per record).
 */
export interface BuildContext {
  premiumIds: Set<string>;
  verifiedIds: Set<string>;
  /** entityId → latest active promotion (only relevant for Premium entities). */
  promotions: Map<string, { value: number; endsAt: number }>;
  badges: Map<string, SearchBadge[]>;
  /** entityId → EN translations of its fields. */
  translations: Map<string, Record<string, string>>;
  /** category/facility id → EN name. */
  taxonomyEn: Map<string, string>;
  /** YYYY-MM-DD (Colombia) seed of the daily rotation. */
  day: string;
  now: Date;
}

/** Entity types stored in `promotion.entity_type` / `entity_badge.entity_type`. */
const PROMOTION_TYPES: Partial<Record<SearchType, string>> = {
  lodging: 'lodging',
  restaurant: 'restaurant',
  experience: 'experience',
  commerce: 'commerce',
};
const BADGE_TYPES: Partial<Record<SearchType, string>> = {
  lodging: 'lodging',
  restaurant: 'restaurant',
  commerce: 'commerce',
  guide: 'guide',
  transport: 'transport',
};

export async function loadPromotions(
  ds: DataSource,
  type: SearchType,
  ids: string[],
): Promise<Map<string, { value: number; endsAt: number }>> {
  const promotionType = PROMOTION_TYPES[type];
  const map = new Map<string, { value: number; endsAt: number }>();
  if (!promotionType || !ids.length) return map;

  const rows: { entity_id: string; value: number; valid_to: Date }[] = await ds.query(
    `SELECT DISTINCT ON (entity_id) entity_id, value, valid_to
       FROM "promotion"
      WHERE entity_type = $1 AND entity_id = ANY($2::varchar[])
        AND valid_from <= NOW() AND valid_to >= NOW()
      ORDER BY entity_id, created_at DESC`,
    [promotionType, ids],
  );
  for (const row of rows) {
    map.set(row.entity_id, { value: Number(row.value), endsAt: Math.floor(new Date(row.valid_to).getTime() / 1000) });
  }
  return map;
}

export async function loadBadges(ds: DataSource, type: SearchType, ids: string[]): Promise<Map<string, SearchBadge[]>> {
  const badgeType = BADGE_TYPES[type];
  const map = new Map<string, SearchBadge[]>();
  if (!badgeType || !ids.length) return map;

  const rows: {
    entity_id: string;
    id: string;
    slug: string;
    name: string;
    icon: string | null;
    icon_color: string | null;
    background_color: string | null;
    image_url: string | null;
  }[] = await ds.query(
    `SELECT eb.entity_id, b.id, b.slug, b.name, b.icon, b.icon_color, b.background_color, b.image_url
       FROM "entity_badge" eb
       JOIN "badge" b ON b.id = eb.badge_id
      WHERE eb.entity_type = $1 AND eb.entity_id = ANY($2::uuid[]) AND b.is_enabled
      ORDER BY eb.created_at`,
    [badgeType, ids],
  );
  for (const row of rows) {
    const list = map.get(row.entity_id) ?? [];
    list.push({
      id: row.id,
      slug: row.slug,
      name: row.name,
      icon: row.icon,
      iconColor: row.icon_color,
      backgroundColor: row.background_color,
      imageUrl: row.image_url,
    });
    map.set(row.entity_id, list);
  }
  return map;
}

/** Facet-ready taxonomy: slugs for filters, ES/EN names for search, items for the cards. */
export function toTaxonomy(raw: RawTaxonomyItem[] | null | undefined, taxonomyEn: Map<string, string>): SearchTaxonomy {
  const items: SearchTaxonomyItem[] = (raw ?? [])
    .filter(item => item?.slug && item?.name)
    .map(item => ({
      id: item.id,
      slug: item.slug,
      name: { es: item.name, en: taxonomyEn.get(item.id) ?? item.name },
      icon: item.icon ?? null,
    }));
  return {
    slugs: items.map(i => i.slug),
    es: items.map(i => i.name.es),
    en: items.map(i => i.name.en),
    items,
  };
}

export function toTown(raw: RawTown | null | undefined): SearchTown | null {
  if (!raw) return null;
  return { id: raw.id, slug: raw.slug ?? null, name: raw.name, department: raw.department ?? null };
}

/** Collect category + facility ids of a batch to translate them in one query each. */
export function collectTaxonomyIds(rows: { categories?: RawTaxonomyItem[]; facilities?: RawTaxonomyItem[] }[]) {
  const categoryIds = new Set<string>();
  const facilityIds = new Set<string>();
  for (const row of rows) {
    (row.categories ?? []).forEach(c => categoryIds.add(c.id));
    (row.facilities ?? []).forEach(f => facilityIds.add(f.id));
  }
  return { categoryIds: [...categoryIds], facilityIds: [...facilityIds] };
}
