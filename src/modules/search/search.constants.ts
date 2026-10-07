/** DI token for the Algolia client. `null` when the module runs in safe (no-op) mode. */
export const ALGOLIA_CLIENT = 'ALGOLIA_CLIENT';

/** Every entity type indexed in the unified catalog. */
export const SEARCH_TYPES = [
  'lodging',
  'restaurant',
  'experience',
  'place',
  'commerce',
  'guide',
  'transport',
  'event',
] as const;

export type SearchType = (typeof SEARCH_TYPES)[number];

export function isSearchType(value: unknown): value is SearchType {
  return typeof value === 'string' && (SEARCH_TYPES as readonly string[]).includes(value);
}

/** Sort replicas (virtual) — suffix appended to the main index name. */
export const SORT_REPLICAS = {
  price_asc: ['asc(price.from)'],
  price_desc: ['desc(price.from)'],
  rating_desc: ['desc(rating.display)', 'desc(rating.count)'],
  name_asc: ['asc(name)'],
} as const;

export type SortReplicaKey = keyof typeof SORT_REPLICAS;

export const catalogIndexName = (prefix: string) => `${prefix}_catalog`;
export const replicaIndexName = (prefix: string, key: SortReplicaKey) => `${catalogIndexName(prefix)}_${key}`;

export const objectIdFor = (type: SearchType, id: string) => `${type}_${id}`;

/** `visibleUntil` for records that never expire (2100-01-01, unix seconds). */
export const FAR_FUTURE_TS = 4102444800;

/** Records above this size are trimmed (Grow allows 100 KB; keep headroom). */
export const MAX_RECORD_BYTES = 90_000;
