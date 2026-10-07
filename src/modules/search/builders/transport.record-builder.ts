import type { DataSource } from 'typeorm';

import type { SearchRecord } from '../interfaces/search-record.interface';
import { buildHourSlots } from '../utils/hour-slots';
import { cleanList, toNumber } from '../utils/text.utils';
import type { BuildContext, RawTown } from './build-context';
import { buildBaseRecord, CommonRow, finalizeRecord, localizedBlock, TypeBuilder } from './base-record';
import { taxonomyJson, TOWN_JSON, whereClause } from './sql-fragments';

interface TransportRow extends CommonRow {
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  whatsapp: string | null;
  start_time: string | null;
  end_time: string | null;
  is_available: boolean | null;
  payment_methods: string[] | null;
  points: number | null;
  rating: number | null;
  review_count: number | null;
  show_binntu_reviews: boolean | null;
  vehicle_model: string | null;
  capacity: number | null;
  services: string | null;
  status: string | null;
  is_public: boolean;
  forced_public: boolean;
  profile_photo: { url?: string } | null;
  coverage_towns: RawTown[];
}

const VISIBLE = `((tr.status = 'published' AND tr.is_public) OR tr.forced_public)`;

/**
 * Transport: no coordinates, no slug (detail is /transport/:id). Never index document,
 * documentType or licensePlate. vehicleModel / capacity / services / coverage towns are a
 * Premium benefit (transport.service hideExtendedInfo), so they only go in for Premium.
 */
export const transportRecordBuilder: TypeBuilder<TransportRow> = {
  type: 'transport',
  translationType: null,

  async load(ds: DataSource, ids?: string[]) {
    const where = whereClause('tr', VISIBLE, ids);
    return ds.query(
      `SELECT tr.id, tr.first_name, tr.last_name, tr.phone, tr.whatsapp, tr.start_time, tr.end_time, tr.is_available,
              tr.payment_methods, tr.points, tr.rating, tr.review_count, tr.show_binntu_reviews,
              tr.vehicle_model, tr.capacity, tr.services, tr.status, tr.is_public, tr.forced_public,
              u.profile_photo,
              ${TOWN_JSON} AS town,
              COALESCE((
                SELECT json_agg(json_build_object('id', ct.id, 'slug', ct.slug, 'name', ct.name, 'department', NULL,
                                                  'isEnable', ct.is_enable, 'lat', NULL, 'lng', NULL))
                FROM "transport_coverage_town" tct JOIN "town" ct ON ct.id = tct.town_id
                WHERE tct.transport_id = tr.id
              ), '[]'::json) AS coverage_towns,
              ${taxonomyJson('category', 'transport_category', 'transport_id', 'tr')} AS categories
         FROM "transport" tr
         LEFT JOIN "users" u ON u.id = tr.user_id
         LEFT JOIN "town" t ON t.id = tr.town_id
         LEFT JOIN "department" d ON d.id = t.department_id
        WHERE ${where.sql}`,
      where.params,
    );
  },

  isVisible: row => (row.status === 'published' && row.is_public) || row.forced_public,

  toRecord(row, ctx: BuildContext): SearchRecord {
    const isPremium = ctx.premiumIds.has(row.id);
    const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
    const profilePhoto = row.profile_photo?.url ?? null;
    const coverage = isPremium ? (row.coverage_towns ?? []) : [];

    const record = buildBaseRecord({
      type: 'transport',
      row,
      ctx,
      slug: null,
      path: `/transport/${row.id}`,
      name,
      description: localizedBlock([isPremium ? row.services : null], [null]),
      details: localizedBlock([], []),
      townSlugs: [row.town?.slug, ...coverage.map(t => t.slug)].filter((s): s is string => !!s),
      binntuRating: row.rating,
      binntuCount: row.review_count,
      showBinntuReviews: row.show_binntu_reviews,
      points: row.points,
      paymentMethods: row.payment_methods,
      contact: {
        whatsapp: row.whatsapp ? [row.whatsapp] : [],
        phones: row.phone ? [row.phone] : [],
      },
      image: profilePhoto,
    });

    record.firstName = row.first_name ?? '';
    record.lastName = row.last_name ?? '';
    record.profilePhoto = profilePhoto;
    record.isAvailable = row.is_available !== false;
    record.hourSlots = buildHourSlots(row.start_time, row.end_time);
    if (row.start_time) record.startTime = row.start_time;
    if (row.end_time) record.endTime = row.end_time;
    if (isPremium) {
      if (row.vehicle_model?.trim()) record.vehicleModel = row.vehicle_model.trim();
      if (toNumber(row.capacity)) record.capacity = toNumber(row.capacity);
      if (row.services?.trim()) record.services = cleanList(row.services.split(/[,;\n]/));
    }

    return finalizeRecord(record);
  },
};
