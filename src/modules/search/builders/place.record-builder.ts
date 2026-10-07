import type { DataSource } from 'typeorm';

import type { SearchRecord } from '../interfaces/search-record.interface';
import { toNumber } from '../utils/text.utils';
import type { BuildContext } from './build-context';
import {
  buildBaseRecord,
  CommonRow,
  descriptionText,
  finalizeRecord,
  localizedBlock,
  TypeBuilder,
} from './base-record';
import { imagesJson, lat, lng, taxonomyJson, TOWN_JSON, whereClause } from './sql-fragments';

interface PlaceRow extends CommonRow {
  name: string;
  slug: string;
  description: string | null;
  history: string | null;
  how_to_get_there: string | null;
  transport_reference: string | null;
  local_transport_options: string | null;
  arrival_reference: string | null;
  recommendations: string | null;
  how_to_dress: string | null;
  restrictions: string | null;
  observations: string | null;
  difficulty_level: number | null;
  temperature: number | null;
  max_depth: number | null;
  altitude: number | null;
  min_age: number | null;
  max_age: number | null;
  points: number | null;
  rating: number | null;
  review_count: number | null;
  urbar_center_distance: number | null;
  google_maps_url: string | null;
  is_featured: boolean | null;
  show_location: boolean | null;
  lat: number | null;
  lng: number | null;
  is_public: boolean;
  forced_public: boolean;
}

// Places have no status workflow (places.service findPublicPlaces).
const VISIBLE = `(p.is_public OR p.forced_public)`;

export const placeRecordBuilder: TypeBuilder<PlaceRow> = {
  type: 'place',
  translationType: 'place',

  async load(ds: DataSource, ids?: string[]) {
    const where = whereClause('p', VISIBLE, ids);
    return ds.query(
      `SELECT p.id, p.name, p.slug, p.description, p.history, p.how_to_get_there, p.transport_reference,
              p.local_transport_options, p.arrival_reference, p.recommendations, p.how_to_dress, p.restrictions,
              p.observations, p.difficulty_level, p.temperature, p.max_depth, p.altitude, p.min_age, p.max_age,
              p.points, p.rating, p.review_count, p.urbar_center_distance, p.google_maps_url,
              p.is_featured, p.show_location,
              ${lat('p.location')} AS lat, ${lng('p.location')} AS lng,
              p.is_public, p.forced_public,
              ${TOWN_JSON} AS town,
              ${taxonomyJson('category', 'place_category', 'place_id', 'p')} AS categories,
              ${taxonomyJson('facility', 'place_facility', 'place_id', 'p')} AS facilities,
              ${imagesJson('place_image', 'place_id', 'p')} AS images
         FROM "place" p
         LEFT JOIN "town" t ON t.id = p.town_id
         LEFT JOIN "department" d ON d.id = t.department_id
        WHERE ${where.sql}`,
      where.params,
    );
  },

  isVisible: row => !!row.is_public || !!row.forced_public,

  toRecord(row, ctx: BuildContext): SearchRecord {
    const en = ctx.translations.get(row.id) ?? {};
    const showLocation = row.show_location !== false;

    const record = buildBaseRecord({
      type: 'place',
      row,
      ctx,
      slug: row.slug,
      path: `/places/${row.slug}`,
      name: row.name,
      description: descriptionText(row.description, en.description),
      details: localizedBlock(
        [
          row.history,
          row.how_to_get_there,
          row.transport_reference,
          row.local_transport_options,
          row.arrival_reference,
          row.recommendations,
          row.how_to_dress,
          row.restrictions,
          row.observations,
        ],
        [null, en.howToGetThere, null, null, null, null, null, null, null],
      ),
      // Hidden locations stay off the map / "near me".
      geo: showLocation ? { lat: row.lat, lng: row.lng } : undefined,
      premiumEligible: false,
      binntuRating: row.rating,
      binntuCount: row.review_count,
      urbanCenterDistance: row.urbar_center_distance,
      points: row.points,
      contact: { googleMapsUrl: showLocation ? (row.google_maps_url ?? undefined) : undefined },
      boost: row.is_featured ? 1 : 0,
    });

    const difficulty = toNumber(row.difficulty_level);
    if (difficulty) record.difficulty = difficulty;
    record.isFeatured = !!row.is_featured;
    record.showLocation = showLocation;
    if (toNumber(row.temperature) !== undefined) record.temperature = toNumber(row.temperature);
    if (toNumber(row.altitude) !== undefined) record.altitude = toNumber(row.altitude);
    if (toNumber(row.max_depth) !== undefined) record.maxDepth = toNumber(row.max_depth);
    if (toNumber(row.min_age) !== undefined) record.minAge = toNumber(row.min_age);
    if (toNumber(row.max_age) !== undefined) record.maxAge = toNumber(row.max_age);

    return finalizeRecord(record);
  },
};
