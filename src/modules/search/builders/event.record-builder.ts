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
import { imagesJson, TOWN_JSON, whereClause } from './sql-fragments';

interface EventRow extends CommonRow {
  event_name: string;
  slug: string | null;
  description: string | null;
  address: string | null;
  contact: string | null;
  responsible: string | null;
  google_maps_url: string | null;
  price: string | null;
  prices: { name?: string; value?: number | string }[] | null;
  is_active: boolean | null;
  start_ts: number | null;
  end_ts: number | null;
}

// Active events that have not ended yet (end date, or start date when there is no end, end of day COT).
const ENDS_AT = `EXTRACT(EPOCH FROM ((COALESCE(ev.end_date, ev.start_date) + COALESCE(ev.end_time, time '23:59:59')) AT TIME ZONE 'America/Bogota'))`;
const STARTS_AT = `EXTRACT(EPOCH FROM ((ev.start_date + COALESCE(ev.start_time, time '00:00')) AT TIME ZONE 'America/Bogota'))`;
const VISIBLE = `(ev.is_active IS NOT FALSE AND ${ENDS_AT} > EXTRACT(EPOCH FROM NOW()))`;

export const eventRecordBuilder: TypeBuilder<EventRow> = {
  type: 'event',
  translationType: null,

  async load(ds: DataSource, ids?: string[]) {
    const where = whereClause('ev', VISIBLE, ids);
    return ds.query(
      `SELECT ev.id, ev.event_name, ev.slug, ev.description, ev.address, ev.contact, ev.responsible, ev.google_maps_url,
              ev.price, ev.prices, ev.is_active,
              ${STARTS_AT}::bigint AS start_ts, ${ENDS_AT}::bigint AS end_ts,
              ${TOWN_JSON} AS town,
              ${imagesJson('public_event_image', 'public_event_id', 'ev', { orderColumn: 'is_main DESC, i.display_order', hasPublicFlag: false })} AS images
         FROM "public_event" ev
         LEFT JOIN "town" t ON t.id = ev.town_id
         LEFT JOIN "department" d ON d.id = t.department_id
        WHERE ${where.sql}`,
      where.params,
    );
  },

  isVisible: (row, now) => row.is_active !== false && (toNumber(row.end_ts) ?? 0) > now.getTime() / 1000,

  toRecord(row, ctx: BuildContext): SearchRecord {
    const prices = (Array.isArray(row.prices) ? row.prices : [])
      .map(p => ({ name: (p.name ?? '').trim(), value: toNumber(p.value) ?? 0 }))
      .filter(p => p.name);
    const values = [toNumber(row.price), ...prices.map(p => p.value)].filter((v): v is number => v !== undefined);
    const from = values.length ? Math.min(...values) : undefined;
    const endTs = toNumber(row.end_ts);

    const record = buildBaseRecord({
      type: 'event',
      row,
      ctx,
      slug: row.slug,
      path: `/public-events/${row.id}`,
      name: row.event_name,
      description: descriptionText(row.description, null),
      details: localizedBlock([row.address, row.responsible], [null, null]),
      premiumEligible: false,
      price: from !== undefined ? { from, unit: 'entrada' } : {},
      contact: {
        phones: row.contact ? [row.contact] : [],
        address: row.address ?? undefined,
        googleMapsUrl: row.google_maps_url ?? undefined,
      },
      visibleUntil: endTs,
    });

    if (toNumber(row.start_ts)) record.startTs = toNumber(row.start_ts);
    if (endTs) record.endTs = endTs;
    record.eventPrices = prices;

    return finalizeRecord(record);
  },
};
