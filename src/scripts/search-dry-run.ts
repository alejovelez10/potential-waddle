/**
 * Search dry run — builds the Algolia catalog records from the configured database and writes
 * them as JSON to disk. It NEVER talks to Algolia: it is the way to develop and check the record
 * builders locally (the real index is only fed from production).
 *
 * Read-only: only SELECT queries.
 *
 * Run:   pnpm search:dry-run                 (all types)
 *        pnpm search:dry-run --type=lodging  (one type)
 *        pnpm search:dry-run --out=/tmp/x    (output dir; default: OS tmp/binntu-search-dry-run)
 */
import { mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { config as dotenvConfig } from 'dotenv';
import { DataSource } from 'typeorm';

import { SearchRecordBuilderService } from '../modules/search/builders/search-record-builder.service';
import { byteSize } from '../modules/search/builders/base-record';
import { SEARCH_TYPES, SearchType, isSearchType } from '../modules/search/search.constants';
import { EntityTranslation } from '../modules/translations/entities/entity-translation.entity';
import { TranslationResolverService } from '../modules/translations/translation-resolver.service';

dotenvConfig({ path: '.env' });

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(a => a.startsWith(prefix))?.slice(prefix.length);
}

/** Same rules as SubscriptionsService.getPremiumIdSet / VerificationService.getVerifiedIdSet. */
function readOnlyServices(ds: DataSource) {
  const activeIds = async (type: string): Promise<string[]> => {
    const rows: { entity_id: string }[] = await ds.query(
      `SELECT DISTINCT entity_id FROM "subscriptions"
        WHERE entity_type::text = $1 AND status::text = 'active'
          AND (current_period_end IS NULL OR current_period_end > NOW())`,
      [type],
    );
    return rows.map(r => r.entity_id);
  };
  return {
    subscriptions: {
      async getPremiumIdSet(type: string) {
        if (type !== 'experience') return new Set(await activeIds(type));
        const guideIds = await activeIds('guide');
        if (!guideIds.length) return new Set<string>();
        const rows: { id: string }[] = await ds.query('SELECT id FROM "experience" WHERE guide_id = ANY($1::uuid[])', [
          guideIds,
        ]);
        return new Set(rows.map(r => r.id));
      },
    },
    verification: {
      async getVerifiedIdSet(type: string) {
        const sql =
          type === 'experience'
            ? `SELECT e.id AS entity_id FROM "experience" e
                 JOIN "entity_verification" v ON v.entity_type = 'guide' AND v.entity_id = e.guide_id AND v.status = 'verified'`
            : `SELECT entity_id FROM "entity_verification" WHERE entity_type = $1 AND status = 'verified'`;
        const rows: { entity_id: string }[] = await ds.query(sql, type === 'experience' ? [] : [type]);
        return new Set(rows.map(r => r.entity_id));
      },
    },
  };
}

async function main() {
  const onlyType = arg('type');
  if (onlyType && !isSearchType(onlyType))
    throw new Error(`Unknown --type=${onlyType}. Use one of: ${SEARCH_TYPES.join(', ')}`);
  const outDir = arg('out') ?? join(tmpdir(), 'binntu-search-dry-run');

  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    synchronize: false,
    entities: [EntityTranslation],
  });
  await ds.initialize();

  const { subscriptions, verification } = readOnlyServices(ds);
  const builder = new SearchRecordBuilderService(
    ds,
    subscriptions as never,
    verification as never,
    new TranslationResolverService(ds.getRepository(EntityTranslation)),
  );

  mkdirSync(outDir, { recursive: true });
  const types: SearchType[] = onlyType ? [onlyType as SearchType] : [...SEARCH_TYPES];

  console.log(`\nSearch dry run (${process.env.DB_HOST}/${process.env.DB_NAME}) → ${outDir}\n`);
  for (const type of types) {
    const { records } = await builder.build(type);
    writeFileSync(join(outDir, `${type}.json`), JSON.stringify(records, null, 2));
    const sizes = records.map(r => byteSize(r));
    const max = sizes.length ? Math.max(...sizes) : 0;
    const avg = sizes.length ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) : 0;
    const concepts = [...new Set(records.flatMap(r => r.concepts))].slice(0, 12).join(', ');
    console.log(
      `${type.padEnd(11)} ${String(records.length).padStart(4)} records   avg ${avg} B   max ${max} B   concepts: ${concepts || '—'}`,
    );
  }

  await ds.destroy();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
