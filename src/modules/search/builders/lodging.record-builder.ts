import type { DataSource } from 'typeorm';

import type { SearchRecord } from '../interfaces/search-record.interface';
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

interface RoomTypeRow {
  name: string | null;
  description: string | null;
  amenities: string[] | null;
  price: string | null;
  maxCapacity: number | null;
  bedType: string | null;
  view: string | null;
  hasWifi: boolean | null;
  hasKitchen: boolean | null;
  hasBalcony: boolean | null;
  hasAirConditioning: boolean | null;
}

interface LodgingRow extends CommonRow {
  name: string;
  slug: string;
  description: string | null;
  how_to_get_there: string | null;
  arrival_reference: string | null;
  address: string | null;
  amenities: string[] | null;
  room_types: string[] | null;
  spoken_languages: string[] | null;
  payment_methods: string[] | null;
  whatsapp_numbers: string[] | null;
  phone_numbers: string[] | null;
  lowest_price: string | null;
  highest_price: string | null;
  price_unit: string | null;
  capacity: number | null;
  room_count: number | null;
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
  room_type_rows: RoomTypeRow[];
}

const VISIBLE = `((l.status = 'published' AND l.is_public) OR l.forced_public)`;

/** Room-type booleans become searchable words (ES + EN) — "cocina", "balcony"… */
function roomFeatureWords(rooms: RoomTypeRow[]): string[] {
  const words: string[] = [];
  if (rooms.some(r => r.hasWifi)) words.push('Wi-Fi');
  if (rooms.some(r => r.hasKitchen)) words.push('Cocina', 'Kitchen');
  if (rooms.some(r => r.hasBalcony)) words.push('Balcón', 'Balcony');
  if (rooms.some(r => r.hasAirConditioning)) words.push('Aire acondicionado', 'Air conditioning');
  return words;
}

export const lodgingRecordBuilder: TypeBuilder<LodgingRow> = {
  type: 'lodging',
  translationType: 'lodging',

  async load(ds: DataSource, ids?: string[]) {
    const where = whereClause('l', VISIBLE, ids);
    return ds.query(
      `SELECT l.id, l.name, l.slug, l.description, l.how_to_get_there, l.arrival_reference, l.address,
              l.amenities, l.room_types, l.spoken_languages, l.payment_methods, l.whatsapp_numbers, l.phone_numbers,
              l.lowest_price, l.highest_price, l.price_unit, l.capacity, l.room_count, l.points,
              l.rating, l.review_count, l.google_maps_rating, l.google_maps_reviews_count,
              l.show_google_maps_reviews, l.show_binntu_reviews, l.google_maps_url, l.urban_center_distance,
              ${lat('l.location')} AS lat, ${lng('l.location')} AS lng,
              l.status::text AS status, l.is_public, l.forced_public,
              ${TOWN_JSON} AS town,
              ${taxonomyJson('category', 'lodging_category', 'lodging_id', 'l')} AS categories,
              ${taxonomyJson('facility', 'lodging_facility', 'lodging_id', 'l')} AS facilities,
              ${imagesJson('lodging_image', 'lodging_id', 'l')} AS images,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'name', rt.name, 'description', rt.description, 'amenities', rt.amenities, 'price', rt.price,
                  'maxCapacity', rt.max_capacity, 'bedType', rt.bed_type, 'view', rt.view,
                  'hasWifi', rt.has_wifi, 'hasKitchen', rt.has_kitchen, 'hasBalcony', rt.has_balcony,
                  'hasAirConditioning', rt.has_air_conditioning
                ))
                FROM "lodging_room_type" rt WHERE rt.lodging_id = l.id AND rt.is_active IS NOT FALSE
              ), '[]'::json) AS room_type_rows
         FROM "lodging" l
         LEFT JOIN "town" t ON t.id = l.town_id
         LEFT JOIN "department" d ON d.id = t.department_id
        WHERE ${where.sql}`,
      where.params,
    );
  },

  isVisible: row => (row.status === 'published' && row.is_public) || row.forced_public,

  toRecord(row, ctx: BuildContext): SearchRecord {
    const en = ctx.translations.get(row.id) ?? {};
    const rooms = row.room_type_rows ?? [];
    const roomPrices = rooms.map(r => toNumber(r.price)).filter((p): p is number => p !== undefined && p > 0);
    const from = toNumber(row.lowest_price) || (roomPrices.length ? Math.min(...roomPrices) : undefined);
    const to = toNumber(row.highest_price) || (roomPrices.length ? Math.max(...roomPrices) : undefined);
    const roomCapacity = rooms.reduce((sum, r) => sum + (r.maxCapacity ?? 0), 0);

    const record = buildBaseRecord({
      type: 'lodging',
      row,
      ctx,
      slug: row.slug,
      path: `/lodgings/${row.slug}`,
      name: row.name,
      description: descriptionText(row.description, en.description),
      details: localizedBlock(
        [row.how_to_get_there, row.arrival_reference, ...rooms.map(r => r.description)],
        [en.howToGetThere, null, ...rooms.map(() => null)],
      ),
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
        unit: row.price_unit || 'noche',
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

    record.roomTypes = cleanList([
      ...(row.room_types ?? []),
      ...rooms.map(r => r.name),
      ...rooms.map(r => r.bedType),
      ...rooms.map(r => r.view),
    ]);
    record.amenitiesText = cleanList([
      ...(row.amenities ?? []),
      ...rooms.flatMap(r => r.amenities ?? []),
      ...roomFeatureWords(rooms),
    ]);
    const capacity = toNumber(row.capacity) || roomCapacity || undefined;
    if (capacity) record.capacity = capacity;
    if (toNumber(row.room_count)) record.rooms = toNumber(row.room_count);

    return finalizeRecord(record);
  },
};
