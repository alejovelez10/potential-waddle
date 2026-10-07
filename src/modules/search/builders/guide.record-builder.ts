import type { DataSource } from 'typeorm';

import type { SearchRecord } from '../interfaces/search-record.interface';
import { normalizeLanguages } from '../utils/languages.utils';
import type { BuildContext, RawTown } from './build-context';
import {
  buildBaseRecord,
  CommonRow,
  descriptionText,
  finalizeRecord,
  localizedBlock,
  TypeBuilder,
} from './base-record';
import { imagesJson, taxonomyJson, whereClause } from './sql-fragments';

interface GuideRow extends CommonRow {
  slug: string;
  first_name: string | null;
  last_name: string | null;
  biography: string | null;
  languages: string[] | null;
  guide_type: string[] | null;
  phone: string | null;
  whatsapp: string | null;
  facebook: string | null;
  instagram: string | null;
  youtube: string | null;
  tiktok: string | null;
  is_available: boolean | null;
  points: number | null;
  rating: number | null;
  review_count: number | null;
  show_binntu_reviews: boolean | null;
  status: string;
  is_public: boolean;
  forced_public: boolean;
  profile_photo: { url?: string } | null;
  towns: RawTown[];
}

const VISIBLE = `((g.status = 'published' AND g.is_public) OR g.forced_public)`;

/**
 * Guides have no coordinates (no `_geoloc`, no "near me") and can work in several towns
 * (guide_town) — every one of them goes to `townSlugs`.
 */
export const guideRecordBuilder: TypeBuilder<GuideRow> = {
  type: 'guide',
  translationType: 'guide',

  async load(ds: DataSource, ids?: string[]) {
    const where = whereClause('g', VISIBLE, ids);
    return ds.query(
      `SELECT g.id, g.slug, g.first_name, g.last_name, g.biography, g.languages, g.guide_type, g.phone, g.whatsapp,
              g.facebook, g.instagram, g.youtube, g.tiktok, g.is_available, g.points, g.rating, g.review_count,
              g.show_binntu_reviews, g.status::text AS status, g.is_public, g.forced_public,
              u.profile_photo,
              COALESCE((
                SELECT json_agg(json_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'department', d.name,
                                                  'isEnable', t.is_enable, 'lat', NULL, 'lng', NULL) ORDER BY t.name)
                FROM "guide_town" gt JOIN "town" t ON t.id = gt.town_id LEFT JOIN "department" d ON d.id = t.department_id
                WHERE gt.guide_id = g.id
              ), '[]'::json) AS towns,
              ${taxonomyJson('category', 'guide_category', 'guide_id', 'g')} AS categories,
              ${imagesJson('guide_image', 'guide_id', 'g')} AS images
         FROM "guide" g
         LEFT JOIN "users" u ON u.id = g.user_id
        WHERE ${where.sql}`,
      where.params,
    );
  },

  isVisible: row => (row.status === 'published' && row.is_public) || row.forced_public,

  toRecord(row, ctx: BuildContext): SearchRecord {
    const en = ctx.translations.get(row.id) ?? {};
    const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
    const towns = row.towns ?? [];
    const profilePhoto = row.profile_photo?.url ?? null;

    const record = buildBaseRecord({
      type: 'guide',
      row: { ...row, town: towns[0] ?? null },
      ctx,
      slug: row.slug,
      path: `/guides/${row.slug}`,
      name,
      description: descriptionText(row.biography, en.biography),
      details: localizedBlock([(row.guide_type ?? []).join(', ')], [null]),
      townSlugs: towns.map(t => t.slug).filter((s): s is string => !!s),
      binntuRating: row.rating,
      binntuCount: row.review_count,
      showBinntuReviews: row.show_binntu_reviews,
      points: row.points,
      spokenLanguages: row.languages,
      contact: {
        whatsapp: row.whatsapp ? [row.whatsapp] : [],
        phones: row.phone ? [row.phone] : [],
      },
      image: profilePhoto ?? row.images?.[0] ?? null,
    });

    record.firstName = row.first_name ?? '';
    record.lastName = row.last_name ?? '';
    record.profilePhoto = profilePhoto;
    record.languages = normalizeLanguages(row.languages);
    record.isAvailable = row.is_available !== false;
    record.social = {
      ...(row.instagram ? { instagram: row.instagram } : {}),
      ...(row.facebook ? { facebook: row.facebook } : {}),
      ...(row.youtube ? { youtube: row.youtube } : {}),
      ...(row.tiktok ? { tiktok: row.tiktok } : {}),
    };

    return finalizeRecord(record);
  },
};
