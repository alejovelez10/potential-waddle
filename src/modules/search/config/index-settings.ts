import type { IndexSettings } from 'algoliasearch';

import { catalogIndexName, replicaIndexName, SORT_REPLICAS, SortReplicaKey } from '../search.constants';

/**
 * Settings of the unified catalog, as code. Applied by `SearchIndexerService.configure()`
 * (POST /api/search/configure in production). Changing anything here = redeploy + configure.
 */
export function buildCatalogSettings(prefix: string): IndexSettings {
  return {
    // Priority order: earlier = stronger. Comma-separated attributes share a level.
    searchableAttributes: [
      'name,nameEn',
      'categories.es,categories.en,concepts',
      'facilities.es,facilities.en,amenitiesText',
      'menu.dishes,menu.sections,products,services,roomTypes',
      'guide.name,firstName,lastName,vehicleModel',
      'town.name,zone,contact.address',
      'unordered(description.es)',
      'unordered(description.en)',
      'unordered(details.es)',
      'unordered(details.en)',
    ],
    attributesForFaceting: [
      'type',
      'filterOnly(townSlugs)',
      'searchable(town.name)',
      'categories.slugs',
      'facilities.slugs',
      'badges.slug',
      'price.from',
      'difficulty',
      'languages',
      'spokenLanguages',
      'paymentMethods',
      'acceptsCard',
      'hourSlots',
      'zone',
      'isVerified',
      'hasPromotion',
      'isFeatured',
      'hasMenu',
      'isAvailable',
      'shortcuts',
    ],
    // Premium (or featured place) first, then the daily rotation. Text relevance always wins.
    customRanking: ['desc(rank.boost)', 'desc(rank.shuffle)'],
    unretrievableAttributes: ['rank'],

    indexLanguages: ['es', 'en'],
    queryLanguages: ['es', 'en'],
    ignorePlurals: ['es', 'en'],
    removeStopWords: ['es', 'en'],
    removeWordsIfNoResults: 'allOptional',
    minWordSizefor1Typo: 4,
    minWordSizefor2Typos: 8,

    // Off by default; the global search sends distinct=3 to get "top 3 per type" in one request.
    attributeForDistinct: 'type',
    distinct: 0,

    // Never highlight whole descriptions/menus by default — only the "why it matched" fields.
    attributesToHighlight: [
      'name',
      'nameEn',
      'categories.es',
      'categories.en',
      'facilities.es',
      'facilities.en',
      'concepts',
      'menu.dishes',
      'products',
      'services',
      'amenitiesText',
      'roomTypes',
    ],
    attributesToSnippet: ['description.es:18', 'description.en:18'],
    highlightPreTag: '<mark>',
    highlightPostTag: '</mark>',
    snippetEllipsisText: '…',

    hitsPerPage: 24,
    maxValuesPerFacet: 500,
    replicas: (Object.keys(SORT_REPLICAS) as SortReplicaKey[]).map(key => `virtual(${replicaIndexName(prefix, key)})`),
  };
}

/** Each virtual replica only overrides the ranking of the primary. */
export function buildReplicaSettings(key: SortReplicaKey): IndexSettings {
  return { customRanking: [...SORT_REPLICAS[key]] };
}

export { catalogIndexName };
