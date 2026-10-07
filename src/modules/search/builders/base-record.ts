import type { DataSource } from 'typeorm';

import { extractConcepts } from '../config/search-concepts';
import type { LocalizedText, SearchRecord } from '../interfaces/search-record.interface';
import { FAR_FUTURE_TS, MAX_RECORD_BYTES, objectIdFor, SearchType } from '../search.constants';
import { acceptsCard, normalizeLanguages } from '../utils/languages.utils';
import { cleanList, dailyShuffle, joinText, roundTo, toNumber, truncate } from '../utils/text.utils';
import { BuildContext, RawTaxonomyItem, RawTown, toTaxonomy, toTown } from './build-context';

const DESCRIPTION_MAX = 1500;
const DETAILS_MAX = 2500;
const MAX_IMAGES = 5;

/**
 * Per-type record builder. `load` returns raw rows for the given ids (any visibility — the
 * indexer deletes the invisible ones) or, without ids, every visible row (full reindex).
 */
export interface TypeBuilder<Row extends CommonRow = CommonRow> {
  type: SearchType;
  /** `entity_translation.entity_type` of this type, or null when it has no translations. */
  translationType: string | null;
  load(ds: DataSource, ids?: string[]): Promise<Row[]>;
  isVisible(row: Row, now: Date): boolean;
  toRecord(row: Row, ctx: BuildContext): SearchRecord;
}

/** Columns every builder's SQL returns (aliased to these names). */
export interface CommonRow {
  id: string;
  town?: RawTown | null;
  categories?: RawTaxonomyItem[];
  facilities?: RawTaxonomyItem[];
  images?: string[];
}

export interface BaseRecordInput {
  type: SearchType;
  row: CommonRow;
  ctx: BuildContext;
  slug: string | null;
  path: string;
  name: string;
  description: LocalizedText;
  details: LocalizedText;
  townSlugs?: string[];
  geo?: { lat?: number | null; lng?: number | null };
  premiumEligible?: boolean;
  binntuRating?: unknown;
  binntuCount?: unknown;
  googleRating?: unknown;
  googleCount?: unknown;
  showGoogleReviews?: boolean | null;
  showBinntuReviews?: boolean | null;
  price?: SearchRecord['price'];
  urbanCenterDistance?: unknown;
  points?: unknown;
  paymentMethods?: string[] | null;
  spokenLanguages?: string[] | null;
  contact?: Partial<SearchRecord['contact']>;
  boost?: number;
  visibleUntil?: number;
  image?: string | null;
}

/** ES text + its EN translation (falls back to ES so EN search still matches the content). */
export function localized(es: string | null | undefined, en: string | null | undefined, max: number): LocalizedText {
  const base = truncate(es, max);
  return { es: base, en: en ? truncate(en, max) : base };
}

export function localizedBlock(
  esParts: (string | null | undefined)[],
  enParts: (string | null | undefined)[],
  max = DETAILS_MAX,
): LocalizedText {
  const es = joinText(esParts);
  const en = joinText(enParts.map((part, i) => part || esParts[i]));
  return localized(es, en, max);
}

export function descriptionText(es: string | null | undefined, en: string | null | undefined): LocalizedText {
  return localized(es, en, DESCRIPTION_MAX);
}

export function buildBaseRecord(input: BaseRecordInput): SearchRecord {
  const { type, row, ctx } = input;
  const isPremium = input.premiumEligible !== false && ctx.premiumIds.has(row.id);
  const promotion = isPremium ? ctx.promotions.get(row.id) : undefined;

  const binntu = toNumber(input.binntuRating) ?? 0;
  const binntuCount = toNumber(input.binntuCount) ?? 0;
  // Freemium: the Google rating is a Premium benefit (hideGoogleRatingUnlessPremium).
  const google = isPremium ? toNumber(input.googleRating) : undefined;
  const googleCount = isPremium ? toNumber(input.googleCount) : undefined;
  const showGoogleReviews = isPremium && input.showGoogleReviews !== false && !!google;
  const showBinntuReviews = input.showBinntuReviews !== false;
  const display = binntuCount > 0 && showBinntuReviews ? binntu : showGoogleReviews ? (google ?? 0) : 0;

  const town = toTown(row.town);
  const townSlugs = cleanList(input.townSlugs ?? (town?.slug ? [town.slug] : []));
  const lat = toNumber(input.geo?.lat);
  const lng = toNumber(input.geo?.lng);
  const hasGeo = lat !== undefined && lng !== undefined && !(lat === 0 && lng === 0);
  const urbanCenterDistance = toNumber(input.urbanCenterDistance);
  const images = (row.images ?? []).filter(Boolean).slice(0, MAX_IMAGES);
  const paymentMethods = cleanList(input.paymentMethods);

  return {
    objectID: objectIdFor(type, row.id),
    type,
    id: row.id,
    slug: input.slug,
    path: input.path,
    name: input.name.trim(),
    ...(ctx.translations.get(row.id)?.name ? { nameEn: ctx.translations.get(row.id)!.name } : {}),
    town,
    townSlugs,
    ...(hasGeo ? { _geoloc: { lat: lat!, lng: lng! } } : {}),
    image: input.image !== undefined ? input.image : (images[0] ?? null),
    images,
    categories: toTaxonomy(row.categories, ctx.taxonomyEn),
    facilities: toTaxonomy(row.facilities, ctx.taxonomyEn),
    badges: ctx.badges.get(row.id) ?? [],
    description: input.description,
    details: input.details,
    concepts: [],
    price: input.price ?? {},
    rating: {
      display: roundTo(display, 1),
      count: binntuCount + (googleCount ?? 0),
      binntu: roundTo(binntu, 2),
      binntuCount,
      ...(google !== undefined ? { google, googleCount: googleCount ?? 0 } : {}),
    },
    ...(urbanCenterDistance !== undefined
      ? { urbanCenterDistance, distanceKm: roundTo(urbanCenterDistance / 1000, 1) }
      : {}),
    ...(toNumber(input.points) !== undefined ? { points: toNumber(input.points) } : {}),
    paymentMethods,
    acceptsCard: acceptsCard(paymentMethods),
    spokenLanguages: normalizeLanguages(input.spokenLanguages),
    contact: {
      whatsapp: cleanList(input.contact?.whatsapp),
      phones: cleanList(input.contact?.phones),
      ...(input.contact?.address ? { address: input.contact.address } : {}),
      ...(input.contact?.googleMapsUrl ? { googleMapsUrl: input.contact.googleMapsUrl } : {}),
      ...(hasGeo ? { lat: lat!, lng: lng! } : {}),
    },
    isPremium,
    isVerified: ctx.verifiedIds.has(row.id),
    hasPromotion: !!promotion,
    ...(promotion ? { promotion } : {}),
    showGoogleReviews,
    showBinntuReviews,
    visibleUntil: input.visibleUntil ?? FAR_FUTURE_TS,
    rank: { boost: input.boost ?? (isPremium ? 1 : 0), shuffle: dailyShuffle(row.id, ctx.day) },
  };
}

/**
 * Last step of every builder: derive `concepts` from all the record's text and enforce the size
 * budget (trim dishes, then details, then description) so no record is rejected by Algolia.
 */
export function finalizeRecord(record: SearchRecord): SearchRecord {
  const text = [
    record.name,
    record.nameEn,
    ...record.categories.es,
    ...record.categories.en,
    ...record.facilities.es,
    ...record.facilities.en,
    ...(record.amenitiesText ?? []),
    ...(record.roomTypes ?? []),
    ...(record.menu?.dishes ?? []),
    ...(record.menu?.sections ?? []),
    ...(record.products ?? []),
    ...(record.services ?? []),
    record.description.es,
    record.description.en,
    record.details.es,
    record.details.en,
  ]
    .filter(Boolean)
    .join(' \n ');
  record.concepts = extractConcepts(text);

  let size = byteSize(record);
  if (size > MAX_RECORD_BYTES && record.menu) {
    while (size > MAX_RECORD_BYTES && record.menu.dishes.length > 20) {
      record.menu.dishes = record.menu.dishes
        .slice(0, Math.floor(record.menu.dishes.length * 0.75))
        .map(d => d.split(' — ')[0]);
      size = byteSize(record);
    }
  }
  if (size > MAX_RECORD_BYTES) {
    record.details = { es: truncate(record.details.es, 600), en: truncate(record.details.en, 600) };
    size = byteSize(record);
  }
  if (size > MAX_RECORD_BYTES) {
    record.description = { es: truncate(record.description.es, 500), en: truncate(record.description.en, 500) };
  }
  return record;
}

export function byteSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
