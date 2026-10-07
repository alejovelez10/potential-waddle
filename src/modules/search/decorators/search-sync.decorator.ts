import { SetMetadata } from '@nestjs/common';

export const SEARCH_SYNC_KEY = 'search-sync';
export const SEARCH_SYNC_SKIP_KEY = 'search-sync-skip';

/**
 * Where a route's affected entity id travels. Identifiers may be ids or slugs.
 * `type` is a search type / fan-out kind (lodging, guide, category, facility, town, badge…),
 * or `param:<name>` / `body:<field>` when the type itself travels in the request.
 */
export interface SearchSyncTarget {
  type: string;
  /** Route param holding the id or slug. */
  param?: string;
  /** Body field holding a single id. */
  bodyId?: string;
  /** Body field holding an array of ids. */
  bodyIds?: string;
  /** Field of the handler's return value holding the id (create routes). `true` = `id`. */
  fromResponse?: string | true;
}

/**
 * Marks a write route whose success changes what the catalog shows, for routes the global
 * interceptor cannot infer from `@EntityAccess` (approve/reject, SuperAdmin catalogs, reviews,
 * promotions…). The reindex runs after the response, debounced, and never blocks the request.
 *
 * @example
 *   @Post(':identifier/approve')
 *   @SearchSync('lodging', { param: 'identifier' })
 *
 *   @Post('admin/:entityType/:entityId/approve')
 *   @SearchSync('param:entityType', { param: 'entityId' })
 */
export function SearchSync(type: string, options: Omit<SearchSyncTarget, 'type'> = {}) {
  return SetMetadata(SEARCH_SYNC_KEY, [{ type, ...options } satisfies SearchSyncTarget]);
}

/** Several targets on one route (e.g. a review that touches its entity + the reviewer ranking). */
export function SearchSyncMany(...targets: SearchSyncTarget[]) {
  return SetMetadata(SEARCH_SYNC_KEY, targets);
}

/** Write route that never changes catalog data (keeps the coverage test explicit). */
export function SearchSyncSkip() {
  return SetMetadata(SEARCH_SYNC_SKIP_KEY, true);
}
