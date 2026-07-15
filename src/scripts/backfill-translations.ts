/**
 * LOCAL-ONLY translation backfill (Phase 28, MT-01).
 *
 * Seeds EN translations for ALL existing translatable entities that lack them,
 * using Gemini AI (same path as the cron/write pipeline built in 28-02).
 *
 * ── Safety (T-28-09) ────────────────────────────────────────────────────────────
 *  • `assertLocalDb()` refuses to run against a non-local DB_HOST unless
 *    `--allow-remote` is explicitly passed on the CLI.
 *  • Does NOT drop or delete any rows. Does NOT push to git.
 *  • The prod backfill is the operator's deferred step; run this locally first,
 *    verify PARITY: PASS, and only then promote.
 *
 * ── Idempotency (T-28-10) ───────────────────────────────────────────────────────
 *  ON CONFLICT (entity_type, entity_id, field, locale) DO UPDATE guarded by
 *  `WHERE entity_translation.source != 'revisado'` (exact SQL from 28-02).
 *  Re-running the backfill never double-inserts and never clobbers owner edits.
 *
 * ── Revisado safety (T-28-01) ───────────────────────────────────────────────────
 *  Fields with an existing EN row whose source='revisado' are skipped before
 *  the Gemini call (candidate-check), so owner overrides are never re-seeded.
 *
 * ── Pagination (T-28-04) ────────────────────────────────────────────────────────
 *  Candidates are processed in pages of PAGE_SIZE (default 50) to avoid
 *  Gemini saturation. Each entity is wrapped in try/catch so one bad row
 *  does not abort the whole run.
 *
 * Run:          pnpm backfill:translations
 * Dry-run:      pnpm backfill:translations --dry-run
 * Remote:       pnpm backfill:translations --allow-remote
 */

import { createHash } from 'crypto';
import { DataSource } from 'typeorm';

import { connectionSource } from '../config/connection-source';
import { appConfig } from '../config/app-config';
import { generateStructuredAnalysis } from '../modules/ai/lib/gemini/generate-structured-with-fallback';
import { TRANSLATABLE_FIELDS_BY_ENTITY } from '../modules/translations/seeding/translatable-fields.constant';
import { buildTranslationPrompt, buildTranslationSchema } from '../modules/translations/seeding/translation-seeding.schema';
// Re-export assertLocalDb from the whatsapp backfill so they share the same guard implementation.
import { assertLocalDb } from './backfill-whatsapp-clicks';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Entity metadata — maps entityType to the SQL table, display-name columns,
// and translatable content columns (must match TRANSLATABLE_FIELDS_BY_ENTITY).
// ---------------------------------------------------------------------------

interface EntityMeta {
  table: string;
  /** Column(s) used to build the display name shown in the Gemini prompt. */
  displayNameSql: string;
  /** SQL column name -> camelCase field name for each translatable field. */
  fieldColumns: Record<string, string>; // camelCaseField -> sql_column_name
}

const ENTITY_META: Record<string, EntityMeta> = {
  lodging: {
    table: 'lodging',
    displayNameSql: 'name',
    fieldColumns: {
      description: 'description',
      howToGetThere: 'how_to_get_there',
    },
  },
  restaurant: {
    table: 'restaurant',
    displayNameSql: 'name',
    fieldColumns: {
      description: 'description',
      howToGetThere: 'how_to_get_there',
    },
  },
  experience: {
    table: 'experience',
    displayNameSql: 'title',
    fieldColumns: {
      description: 'description',
      departureDescription: 'departure_description',
      arrivalDescription: 'arrival_description',
    },
  },
  place: {
    table: 'place',
    displayNameSql: 'name',
    fieldColumns: {
      description: 'description',
      howToGetThere: 'how_to_get_there',
    },
  },
  guide: {
    table: 'guide',
    displayNameSql: "(first_name || ' ' || last_name)",
    fieldColumns: {
      biography: 'biography',
    },
  },
  commerce: {
    table: 'commerce',
    displayNameSql: 'name',
    fieldColumns: {
      description: 'description',
      howToGetThere: 'how_to_get_there',
    },
  },
  category: {
    table: 'category',
    displayNameSql: 'name',
    fieldColumns: {
      name: 'name',
    },
  },
  facility: {
    table: 'facility',
    displayNameSql: 'name',
    fieldColumns: {
      name: 'name',
    },
  },
  roomType: {
    table: 'lodging_room_type',
    displayNameSql: 'name',
    fieldColumns: {
      name: 'name',
      description: 'description',
    },
  },
};

// ---------------------------------------------------------------------------
// Hash helper (matches TranslationSeedingService.computeSourceHash)
// ---------------------------------------------------------------------------

function computeSourceHash(esText: string): string {
  return createHash('sha256').update(esText, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Guarded upsert — EXACT SQL from translation-seeding.service.ts (28-02)
// so the `source != 'revisado'` guard is preserved (T-28-01).
// ---------------------------------------------------------------------------

async function upsertAuto(
  ds: DataSource,
  entityType: string,
  entityId: string,
  field: string,
  value: string,
  sourceHashES: string,
): Promise<void> {
  await ds.query(
    `INSERT INTO entity_translation
       (id, entity_type, entity_id, field, locale, value, source, source_hash, updated_at)
     VALUES (gen_random_uuid(), $1, $2::uuid, $3, 'en', $4, 'auto', $5, NOW())
     ON CONFLICT (entity_type, entity_id, field, locale) DO UPDATE
       SET value = EXCLUDED.value,
           source = 'auto',
           source_hash = EXCLUDED.source_hash,
           updated_at = NOW()
       WHERE entity_translation.source != 'revisado'`,
    [entityType, entityId, field, value, sourceHashES],
  );
}

// ---------------------------------------------------------------------------
// Candidate check — returns fields that still need seeding for a given entity.
// Skips fields whose EN row is `revisado` (owner override) or hash-matches
// the current ES value (already seeded with same source text).
// ---------------------------------------------------------------------------

async function getFieldsNeedingSeeding(
  ds: DataSource,
  entityType: string,
  entityId: string,
  fieldsES: Record<string, string>,
): Promise<Record<string, string>> {
  if (!Object.keys(fieldsES).length) return {};

  const existing: { field: string; source_hash: string | null; source: string }[] = await ds.query(
    `SELECT field, source_hash, source
     FROM entity_translation
     WHERE entity_type = $1 AND entity_id = $2::uuid AND locale = 'en'`,
    [entityType, entityId],
  );

  const byField = new Map(existing.map((r) => [r.field, r]));
  const out: Record<string, string> = {};

  for (const [field, esValue] of Object.entries(fieldsES)) {
    const row = byField.get(field);
    // revisado rows are NEVER auto re-seeded
    if (row && row.source === 'revisado') continue;
    // Skip if the existing hash already matches (idempotency)
    if (row && row.source_hash === computeSourceHash(esValue)) continue;
    out[field] = esValue;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Parity report types
// ---------------------------------------------------------------------------

interface EntityParityRow {
  entityType: string;
  total: number;
  seeded: number;
  ok: boolean;
}

interface TranslationParityReport {
  rows: EntityParityRow[];
  parityOk: boolean;
}

// ---------------------------------------------------------------------------
// Parity count — counts entities with ALL expected EN rows vs total with ES text
// ---------------------------------------------------------------------------

async function computeParityReport(ds: DataSource): Promise<TranslationParityReport> {
  const entityTypes = Object.entries(TRANSLATABLE_FIELDS_BY_ENTITY)
    .filter(([, fields]) => fields.length > 0)
    .map(([type]) => type);

  const rows: EntityParityRow[] = [];

  for (const entityType of entityTypes) {
    const meta = ENTITY_META[entityType];
    if (!meta) continue;

    const expectedFieldCount = (TRANSLATABLE_FIELDS_BY_ENTITY[entityType] ?? []).length;

    // Count entities that have at least one non-null translatable ES column
    const totalResult: { count: string }[] = await ds.query(
      `SELECT COUNT(*)::int AS count FROM "${meta.table}" WHERE ${Object.values(meta.fieldColumns)
        .map((col) => `"${col}" IS NOT NULL AND "${col}" != ''`)
        .join(' OR ')}`,
    );
    const total = parseInt(String(totalResult[0]?.count ?? '0'), 10);

    // Count entities that have ALL expected EN rows (one per translatable field)
    // A row with source='revisado' counts as satisfied
    const seededResult: { count: string }[] = await ds.query(
      `SELECT COUNT(*)::int AS count
       FROM "${meta.table}" e
       WHERE (${Object.values(meta.fieldColumns)
         .map((col) => `e."${col}" IS NOT NULL AND e."${col}" != ''`)
         .join(' OR ')})
         AND (
           SELECT COUNT(DISTINCT field)
           FROM entity_translation
           WHERE entity_type = $1
             AND entity_id = e.id
             AND locale = 'en'
         ) >= $2`,
      [entityType, expectedFieldCount],
    );
    const seeded = parseInt(String(seededResult[0]?.count ?? '0'), 10);

    rows.push({ entityType, total, seeded, ok: total === 0 || seeded >= total });
  }

  const parityOk = rows.every((r) => r.ok);
  return { rows, parityOk };
}

// ---------------------------------------------------------------------------
// Print parity report
// ---------------------------------------------------------------------------

function printParityReport(report: TranslationParityReport): void {
  // eslint-disable-next-line no-console
  const log = console.log;
  log('');
  log('═══════════════════════════════════════════════════════════════════════');
  log(' Translation backfill — seeding parity report');
  log('═══════════════════════════════════════════════════════════════════════');
  if (report.rows.length === 0) {
    log(' (no entity types with translatable fields)');
  } else {
    log(' entity_type        total  seeded  ok');
    log(' ─────────────────  ─────  ──────  ──');
    for (const r of report.rows) {
      log(
        ` ${r.entityType.padEnd(17)}  ${String(r.total).padStart(5)}  ${String(r.seeded).padStart(6)}  ${r.ok ? '✓' : '✗'}`,
      );
    }
  }
  log(' ───────────────────────────────────────────────────────────────────');
  log(`\n PARITY: ${report.parityOk ? 'PASS' : 'FAIL'}`);
  log('═══════════════════════════════════════════════════════════════════════\n');
}

// ---------------------------------------------------------------------------
// Seed one entity type — pages through candidates, seeds missing fields
// ---------------------------------------------------------------------------

async function seedEntityType(
  ds: DataSource,
  entityType: string,
  fields: string[],
  dryRun: boolean,
): Promise<{ attempted: number; seeded: number; skipped: number; errors: number }> {
  const meta = ENTITY_META[entityType];
  if (!meta) {
    // eslint-disable-next-line no-console
    console.warn(`[backfill] No ENTITY_META for entityType=${entityType} — skipping`);
    return { attempted: 0, seeded: 0, skipped: 0, errors: 0 };
  }

  const fieldCols = Object.entries(meta.fieldColumns)
    .filter(([camel]) => fields.includes(camel))
    .map(([camel, sql]) => ({ camel, sql }));

  const selectCols = [`id::text AS id`, `(${meta.displayNameSql})::text AS display_name`];
  for (const { camel, sql } of fieldCols) {
    selectCols.push(`"${sql}" AS "${camel}"`);
  }

  // Only select entities with at least one non-null/non-empty translatable field
  const whereClause = fieldCols.map(({ sql }) => `"${sql}" IS NOT NULL AND "${sql}" != ''`).join(' OR ');

  let offset = 0;
  let attempted = 0;
  let seeded = 0;
  let skipped = 0;
  let errors = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows: Record<string, string>[] = await ds.query(
      `SELECT ${selectCols.join(', ')} FROM "${meta.table}" WHERE ${whereClause} LIMIT $1 OFFSET $2`,
      [PAGE_SIZE, offset],
    );

    if (rows.length === 0) break;
    offset += rows.length;
    attempted += rows.length;

    for (const row of rows) {
      try {
        // Build fieldsES from non-null translatable columns
        const fieldsES: Record<string, string> = {};
        for (const { camel } of fieldCols) {
          const val = row[camel];
          if (val != null && val !== '') {
            fieldsES[camel] = val;
          }
        }

        if (dryRun) {
          // In dry-run: just check what would be seeded without calling Gemini
          const needsSeeding = await getFieldsNeedingSeeding(ds, entityType, row['id'], fieldsES);
          if (Object.keys(needsSeeding).length > 0) {
            // eslint-disable-next-line no-console
            console.log(
              `[dry-run] would seed ${entityType}/${row['id']} fields: ${Object.keys(needsSeeding).join(', ')}`,
            );
            seeded++;
          } else {
            skipped++;
          }
          continue;
        }

        // Live run: check what needs seeding
        const needsSeeding = await getFieldsNeedingSeeding(ds, entityType, row['id'], fieldsES);
        if (!Object.keys(needsSeeding).length) {
          skipped++;
          continue;
        }

        // One Gemini call for all missing fields (per MT-01 design)
        const fieldNames = Object.keys(needsSeeding);
        const rawJson = await generateStructuredAnalysis({
          apiKey: appConfig().gemini.apiKey,
          primaryModel: 'gemini-2.5-flash',
          prompt: buildTranslationPrompt(entityType, row['display_name'] ?? entityType, needsSeeding),
          responseSchema: buildTranslationSchema(fieldNames),
          temperature: 0.3,
          maxOutputTokens: 2000,
        });

        const translations: Record<string, string> = JSON.parse(rawJson);

        for (const field of fieldNames) {
          const en = translations[field];
          if (en == null) continue;
          await upsertAuto(ds, entityType, row['id'], field, en, computeSourceHash(needsSeeding[field]));
        }

        seeded++;
        // eslint-disable-next-line no-console
        console.log(`[backfill] seeded ${entityType}/${row['id']} fields: ${fieldNames.join(', ')}`);
      } catch (err) {
        errors++;
        // eslint-disable-next-line no-console
        console.error(`[backfill] error processing ${entityType}/${row['id']}:`, err);
        // Continue — a single bad row must not abort the whole backfill
      }
    }

    if (rows.length < PAGE_SIZE) break;
  }

  return { attempted, seeded, skipped, errors };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');

  assertLocalDb(process.env.DB_HOST, argv);

  // eslint-disable-next-line no-console
  console.log(
    `[backfill] connecting to LOCAL DB host="${process.env.DB_HOST ?? '(default local)'}" ${dryRun ? '[DRY-RUN]' : ''}`,
  );
  await connectionSource.initialize();

  try {
    const entityTypes = Object.entries(TRANSLATABLE_FIELDS_BY_ENTITY).filter(([, fields]) => fields.length > 0);

    // eslint-disable-next-line no-console
    console.log(`[backfill] processing ${entityTypes.length} entity types…`);

    for (const [entityType, fields] of entityTypes) {
      // eslint-disable-next-line no-console
      console.log(`[backfill] seeding ${entityType} (fields: ${fields.join(', ')})…`);
      const stats = await seedEntityType(connectionSource, entityType, fields, dryRun);
      // eslint-disable-next-line no-console
      console.log(
        `[backfill] ${entityType} done — attempted=${stats.attempted} seeded=${stats.seeded} skipped=${stats.skipped} errors=${stats.errors}`,
      );
    }

    // Parity report
    // eslint-disable-next-line no-console
    console.log('[backfill] computing parity report…');
    const report = await computeParityReport(connectionSource);
    printParityReport(report);

    await connectionSource.destroy();

    // In dry-run mode, exit 0 regardless (it's a report, not a gate)
    process.exit(dryRun ? 0 : report.parityOk ? 0 : 1);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[backfill] fatal error:', err);
    await connectionSource.destroy().catch(() => undefined);
    process.exit(1);
  }
}

// Only run when invoked directly (not when imported by tests).
if (require.main === module) {
  void main();
}
