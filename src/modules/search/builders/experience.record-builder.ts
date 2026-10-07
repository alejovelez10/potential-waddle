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

interface ExperienceRow extends CommonRow {
  title: string;
  slug: string;
  description: string | null;
  departure_description: string | null;
  arrival_description: string | null;
  recommendations: string | null;
  how_to_dress: string | null;
  restrictions: string | null;
  difficulty_level: number | null;
  price: string | null;
  price_label: string | null;
  additional_prices: { label?: string; price?: number | string }[] | null;
  travel_time: number | null;
  total_distance: number | null;
  min_age: number | null;
  max_age: number | null;
  min_participants: number | null;
  max_participants: number | null;
  payment_methods: string[] | null;
  points: number | null;
  rating: number | null;
  reviews_count: number | null;
  show_binntu_reviews: boolean | null;
  lat: number | null;
  lng: number | null;
  status: string;
  is_public: boolean;
  forced_public: boolean;
  guide_id: string | null;
  guide_slug: string | null;
  guide_first_name: string | null;
  guide_last_name: string | null;
  guide_status: string | null;
  guide_is_public: boolean | null;
  guide_whatsapp: string | null;
  guide_phone: string | null;
}

// Experiences also need their guide published + public (experiences.service findPublicExperiences).
const VISIBLE = `((e.is_public AND e.status = 'published' AND g.status = 'published' AND g.is_public) OR e.forced_public)`;

export const experienceRecordBuilder: TypeBuilder<ExperienceRow> = {
  type: 'experience',
  translationType: 'experience',

  async load(ds: DataSource, ids?: string[]) {
    const where = whereClause('e', VISIBLE, ids);
    return ds.query(
      `SELECT e.id, e.title, e.slug, e.description, e.departure_description, e.arrival_description,
              e.recommendations, e.how_to_dress, e.restrictions, e.difficulty_level, e.price, e.price_label,
              e.additional_prices, e.travel_time, e.total_distance, e.min_age, e.max_age,
              e.min_participants, e.max_participants, e.payment_methods, e.points, e.rating, e.reviews_count,
              e.show_binntu_reviews,
              ${lat('e.departure_location')} AS lat, ${lng('e.departure_location')} AS lng,
              e.status::text AS status, e.is_public, e.forced_public,
              g.id AS guide_id, g.slug AS guide_slug, g.first_name AS guide_first_name, g.last_name AS guide_last_name,
              g.status::text AS guide_status, g.is_public AS guide_is_public,
              g.whatsapp AS guide_whatsapp, g.phone AS guide_phone,
              ${TOWN_JSON} AS town,
              ${taxonomyJson('category', 'experience_category', 'experience_id', 'e')} AS categories,
              ${taxonomyJson('facility', 'experience_facility', 'experience_id', 'e')} AS facilities,
              ${imagesJson('experience_image', 'experience_id', 'e')} AS images
         FROM "experience" e
         LEFT JOIN "guide" g ON g.id = e.guide_id
         LEFT JOIN "town" t ON t.id = e.town_id
         LEFT JOIN "department" d ON d.id = t.department_id
        WHERE ${where.sql}`,
      where.params,
    );
  },

  isVisible: row =>
    (row.is_public && row.status === 'published' && row.guide_status === 'published' && !!row.guide_is_public) ||
    row.forced_public,

  toRecord(row, ctx: BuildContext): SearchRecord {
    const en = ctx.translations.get(row.id) ?? {};
    const price = toNumber(row.price);
    const guideName = [row.guide_first_name, row.guide_last_name].filter(Boolean).join(' ').trim();

    const record = buildBaseRecord({
      type: 'experience',
      row,
      ctx,
      slug: row.slug,
      path: `/experiences/${row.slug}`,
      name: row.title,
      description: descriptionText(row.description, en.description),
      details: localizedBlock(
        [row.departure_description, row.arrival_description, row.recommendations, row.how_to_dress, row.restrictions],
        [en.departureDescription, en.arrivalDescription, null, null, null],
      ),
      geo: { lat: row.lat, lng: row.lng },
      binntuRating: row.rating,
      binntuCount: row.reviews_count,
      showBinntuReviews: row.show_binntu_reviews,
      price: { ...(price ? { from: price } : {}), unit: row.price_label || 'Persona' },
      points: row.points,
      paymentMethods: row.payment_methods,
      contact: {
        whatsapp: row.guide_whatsapp ? [row.guide_whatsapp] : [],
        phones: row.guide_phone ? [row.guide_phone] : [],
      },
    });

    const difficulty = toNumber(row.difficulty_level);
    if (difficulty) record.difficulty = difficulty;
    if (toNumber(row.min_age) !== undefined) record.minAge = toNumber(row.min_age);
    if (toNumber(row.max_age) !== undefined) record.maxAge = toNumber(row.max_age);
    if (toNumber(row.min_participants) !== undefined) record.minParticipants = toNumber(row.min_participants);
    if (toNumber(row.max_participants) !== undefined) record.maxParticipants = toNumber(row.max_participants);
    // travel_time is stored in seconds, total_distance in meters.
    if (toNumber(row.travel_time)) record.durationMinutes = Math.round(toNumber(row.travel_time)! / 60);
    if (toNumber(row.total_distance)) record.totalDistanceM = toNumber(row.total_distance);
    if (row.guide_id) record.guide = { id: row.guide_id, name: guideName, slug: row.guide_slug };
    record.additionalPrices = (Array.isArray(row.additional_prices) ? row.additional_prices : [])
      .map(p => ({ label: (p.label ?? '').trim(), price: toNumber(p.price) ?? 0 }))
      .filter(p => p.label && p.price > 0);

    return finalizeRecord(record);
  },
};
