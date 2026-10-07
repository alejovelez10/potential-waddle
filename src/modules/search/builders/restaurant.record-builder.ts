import type { DataSource } from 'typeorm';

import type { SearchRecord } from '../interfaces/search-record.interface';
import { flattenMenu } from '../utils/menu.utils';
import { cleanList, toNumber } from '../utils/text.utils';
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

interface PriceRange {
  label?: string;
  priceFrom?: number | string;
  featured?: boolean;
}

interface RestaurantRow extends CommonRow {
  name: string;
  slug: string;
  description: string | null;
  how_to_get_there: string | null;
  arrival_reference: string | null;
  address: string | null;
  town_zone: string | null;
  spoken_languages: string[] | null;
  payment_methods: string[] | null;
  whatsapp_numbers: string[] | null;
  phone_numbers: string[] | null;
  lowest_price: string | null;
  higher_price: string | null;
  price_ranges: PriceRange[] | null;
  menu_url: string | null;
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
  menu_data: unknown;
}

const VISIBLE = `((r.status = 'published' AND r.is_public) OR r.forced_public)`;

export const restaurantRecordBuilder: TypeBuilder<RestaurantRow> = {
  type: 'restaurant',
  translationType: 'restaurant',

  async load(ds: DataSource, ids?: string[]) {
    const where = whereClause('r', VISIBLE, ids);
    return ds.query(
      `SELECT r.id, r.name, r.slug, r.description, r.how_to_get_there, r.arrival_reference, r.address, r.town_zone,
              r.spoken_languages, r.payment_methods, r.whatsapp_numbers, r.phone_numbers,
              r.lowest_price, r.higher_price, r.price_ranges, r.menu_url, r.points,
              r.rating, r.review_count, r.google_maps_rating, r.google_maps_reviews_count,
              r.show_google_maps_reviews, r.show_binntu_reviews, r.google_maps_url, r.urban_center_distance,
              ${lat('r.location')} AS lat, ${lng('r.location')} AS lng,
              r.status::text AS status, r.is_public, r.forced_public,
              ${TOWN_JSON} AS town,
              ${taxonomyJson('category', 'restaurant_category', 'restaurant_id', 'r')} AS categories,
              ${taxonomyJson('facility', 'restaurant_facility', 'restaurant_id', 'r')} AS facilities,
              ${imagesJson('restaurant_image', 'restaurant_id', 'r')} AS images,
              (SELECT m.data FROM "menu" m
                WHERE m.restaurant_id = r.id AND m.status = 'completed' AND m.data IS NOT NULL
                ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC
                LIMIT 1) AS menu_data
         FROM "restaurant" r
         LEFT JOIN "town" t ON t.id = r.town_id
         LEFT JOIN "department" d ON d.id = t.department_id
        WHERE ${where.sql}`,
      where.params,
    );
  },

  isVisible: row => (row.status === 'published' && row.is_public) || row.forced_public,

  toRecord(row, ctx: BuildContext): SearchRecord {
    const en = ctx.translations.get(row.id) ?? {};
    const ranges = (Array.isArray(row.price_ranges) ? row.price_ranges : [])
      .map(r => ({ label: (r.label ?? '').trim(), priceFrom: toNumber(r.priceFrom) ?? 0, featured: !!r.featured }))
      .filter(r => r.label && r.priceFrom > 0);
    const featured = ranges.find(r => r.featured);
    // "Plato desde": the featured range when the owner marked one, else the stored lowest price.
    const from = featured?.priceFrom ?? toNumber(row.lowest_price);
    const to = toNumber(row.higher_price);
    const menu = flattenMenu(row.menu_data);

    const record = buildBaseRecord({
      type: 'restaurant',
      row,
      ctx,
      slug: row.slug,
      path: `/restaurants/${row.slug}`,
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
      price: {
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        unit: 'plato',
        ...(featured ? { featuredLabel: featured.label } : {}),
      },
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

    record.menu = { dishes: menu.dishes, sections: cleanList([...menu.sections, ...ranges.map(r => r.label)]) };
    record.priceRanges = ranges;
    record.hasMenu = menu.dishes.length > 0 || !!row.menu_url;
    if (row.menu_url) record.menuUrl = row.menu_url;
    if (row.town_zone?.trim()) record.zone = row.town_zone.trim();

    return finalizeRecord(record);
  },
};
