import type { DataSource } from 'typeorm';

import type { SearchRecord } from '../interfaces/search-record.interface';
import { cleanList, truncate } from '../utils/text.utils';
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

interface ProductRow {
  name: string | null;
  description: string | null;
}

interface CommerceRow extends CommonRow {
  name: string;
  slug: string;
  description: string | null;
  how_to_get_there: string | null;
  arrival_reference: string | null;
  address: string | null;
  services: string[] | null;
  spoken_languages: string[] | null;
  payment_methods: string[] | null;
  whatsapp_numbers: string[] | null;
  phone_numbers: string[] | null;
  points: number | null;
  rating: number | null;
  review_count: number | null;
  google_maps_rating: number | null;
  google_maps_reviews_count: number | null;
  show_google_maps_reviews: boolean | null;
  show_binntu_reviews: boolean | null;
  google_maps_url: string | null;
  urban_center_distance: number | null;
  lat: number | null;
  lng: number | null;
  status: string;
  is_public: boolean;
  forced_public: boolean;
  products: ProductRow[];
}

const VISIBLE = `((c.status = 'published' AND c.is_public) OR c.forced_public)`;

export const commerceRecordBuilder: TypeBuilder<CommerceRow> = {
  type: 'commerce',
  translationType: 'commerce',

  async load(ds: DataSource, ids?: string[]) {
    const where = whereClause('c', VISIBLE, ids);
    return ds.query(
      `SELECT c.id, c.name, c.slug, c.description, c.how_to_get_there, c.arrival_reference, c.address, c.services,
              c.spoken_languages, c.payment_methods, c.whatsapp_numbers, c.phone_numbers, c.points,
              c.rating, c.review_count, c.google_maps_rating, c.google_maps_reviews_count,
              c.show_google_maps_reviews, c.show_binntu_reviews, c.google_maps_url, c.urban_center_distance,
              ${lat('c.location')} AS lat, ${lng('c.location')} AS lng,
              c.status::text AS status, c.is_public, c.forced_public,
              ${TOWN_JSON} AS town,
              ${taxonomyJson('category', 'commerce_category', 'commerce_id', 'c')} AS categories,
              ${taxonomyJson('facility', 'commerce_facility', 'commerce_id', 'c')} AS facilities,
              ${imagesJson('commerce_image', 'commerce_id', 'c')} AS images,
              COALESCE((
                SELECT json_agg(json_build_object('name', p.name, 'description', p.description) ORDER BY p."order" NULLS LAST)
                FROM "commerce_product" p
                WHERE p.commerce_id = c.id AND p.is_public IS NOT FALSE AND p.is_available IS NOT FALSE
              ), '[]'::json) AS products
         FROM "commerce" c
         LEFT JOIN "town" t ON t.id = c.town_id
         LEFT JOIN "department" d ON d.id = t.department_id
        WHERE ${where.sql}`,
      where.params,
    );
  },

  isVisible: row => (row.status === 'published' && row.is_public) || row.forced_public,

  toRecord(row, ctx: BuildContext): SearchRecord {
    const en = ctx.translations.get(row.id) ?? {};

    const record = buildBaseRecord({
      type: 'commerce',
      row,
      ctx,
      slug: row.slug,
      path: `/commerce/${row.slug}`,
      name: row.name,
      description: descriptionText(row.description, en.description),
      details: localizedBlock([row.how_to_get_there, row.arrival_reference], [en.howToGetThere, null]),
      geo: { lat: row.lat, lng: row.lng },
      binntuRating: row.rating,
      binntuCount: row.review_count,
      googleRating: row.google_maps_rating,
      googleCount: row.google_maps_reviews_count,
      showGoogleReviews: row.show_google_maps_reviews,
      showBinntuReviews: row.show_binntu_reviews,
      urbanCenterDistance: row.urban_center_distance,
      points: row.points,
      paymentMethods: row.payment_methods,
      spokenLanguages: row.spoken_languages,
      contact: {
        whatsapp: row.whatsapp_numbers ?? [],
        phones: row.phone_numbers ?? [],
        address: row.address ?? undefined,
        googleMapsUrl: row.google_maps_url ?? undefined,
      },
    });

    record.services = cleanList(row.services);
    record.products = cleanList(
      (row.products ?? []).map(p => (p.description ? `${p.name} — ${truncate(p.description, 80)}` : p.name)),
    );

    return finalizeRecord(record);
  },
};
