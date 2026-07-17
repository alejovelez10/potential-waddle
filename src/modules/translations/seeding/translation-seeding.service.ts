import { BadRequestException, ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { createHash } from 'crypto';

import { appConfig } from 'src/config/app-config';
import { generateStructuredAnalysis } from 'src/modules/ai/lib/gemini/generate-structured-with-fallback';
import { EntityTranslation } from '../entities/entity-translation.entity';
import { TRANSLATABLE_FIELDS_BY_ENTITY } from './translatable-fields.constant';
import { ENTITY_SOURCE_META } from './entity-source-meta.constant';
import { buildTranslationPrompt, buildTranslationSchema } from './translation-seeding.schema';

@Injectable()
export class TranslationSeedingService {
  private readonly logger = new Logger(TranslationSeedingService.name);

  constructor(
    @InjectRepository(EntityTranslation)
    private readonly repo: Repository<EntityTranslation>,

    // Injected for sweepPending: SELECT-only raw queries against base entity tables
    // to load ES source values without importing feature modules.
    @InjectDataSource()
    private readonly dataSource: DataSource,

    // String-token injections so that TranslationsModule does not need to import
    // LodgingsModule / ExperiencesModule (circular-dep risk). 28-03 wires these tokens
    // in the module; the test suite provides mock factories under the same tokens.
    @Inject('LodgingRepository')
    private readonly lodgingRepo: { findOne: (opts: unknown) => Promise<{ id: string; user?: { id: string } } | null> },

    @Inject('ExperienceRepository')
    private readonly experienceRepo: { findOne: (opts: unknown) => Promise<{ id: string; guide?: { user?: { id: string } } } | null> },
  ) {}

  // ---------------------------------------------------------------------------
  // Hash helpers (MT-03 Pitfall 3 — hash the ES source, NOT the EN value)
  // ---------------------------------------------------------------------------

  computeSourceHash(esText: string): string {
    return createHash('sha256').update(esText, 'utf8').digest('hex');
  }

  // ---------------------------------------------------------------------------
  // Internal: filter incoming fieldsES down to the entity's allowed fields
  // Drops 'name', 'title', addresses, etc. (Pitfall 5)
  // ---------------------------------------------------------------------------

  private translatableSubset(entityType: string, fieldsES: Record<string, string>): Record<string, string> {
    const allowed = TRANSLATABLE_FIELDS_BY_ENTITY[entityType] ?? [];
    const out: Record<string, string> = {};
    for (const f of allowed) {
      if (fieldsES[f] != null && fieldsES[f] !== '') {
        out[f] = fieldsES[f];
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // translateAndUpsert — the ONE place Gemini is called from inside this service
  // (quick 260717-abz refactor, DD-4). ONE Gemini call for ALL requested fields,
  // then one upsert per field.
  //   opts.force=false (default) → upsertTranslation (guarded: WHERE source != 'revisado')
  //   opts.force=true            → upsertForceAuto (bypasses the revisado guard —
  //                                 ONLY for explicit per-field owner/admin force requests)
  // No-op (no Gemini call) when subset is empty.
  // ---------------------------------------------------------------------------

  private async translateAndUpsert(
    entityType: string,
    entityId: string,
    displayName: string,
    subset: Record<string, string>,
    opts?: { force?: boolean },
  ): Promise<void> {
    const fieldNames = Object.keys(subset);

    // e.g. transport has no translatable fields — skip cleanly
    if (!fieldNames.length) return;

    // Single Gemini call for ALL fields (MT-01, Pitfall 2 analogous cost guard)
    const rawJson = await generateStructuredAnalysis({
      apiKey: appConfig().gemini.apiKey,
      primaryModel: 'gemini-3.1-flash-lite', // translation: flash-lite suffices; supports new binntu project key
      prompt: buildTranslationPrompt(entityType, displayName, subset),
      responseSchema: buildTranslationSchema(fieldNames),
      temperature: 0.3, // low temperature = faithful, not creative
      maxOutputTokens: 8192,
    });

    const translations: Record<string, string> = JSON.parse(rawJson);

    for (const field of fieldNames) {
      const en = translations[field];
      if (en == null) continue;
      const sourceHash = this.computeSourceHash(subset[field]);
      if (opts?.force) {
        await this.upsertForceAuto(entityType, entityId, field, en, sourceHash);
      } else {
        await this.upsertTranslation(entityType, entityId, field, en, sourceHash);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // seedEntity — MT-01: ONE Gemini call per entity, upserts all EN rows
  // ---------------------------------------------------------------------------

  async seedEntity(
    entityType: string,
    entityId: string,
    entityName: string,
    fieldsES: Record<string, string>,
  ): Promise<void> {
    const subset = this.translatableSubset(entityType, fieldsES);
    await this.translateAndUpsert(entityType, entityId, entityName, subset, { force: false });
  }

  // ---------------------------------------------------------------------------
  // upsertTranslation — Pitfall 1: DO UPDATE guarded by WHERE source != 'revisado'
  // ---------------------------------------------------------------------------

  async upsertTranslation(
    entityType: string,
    entityId: string,
    field: string,
    value: string,
    sourceHashES: string,
  ): Promise<void> {
    await this.repo.query(
      `INSERT INTO entity_translation
         (id, entity_type, entity_id, field, locale, value, source, source_hash, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'en', $4, 'auto', $5, NOW())
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
  // needsSeeding — MT-03: returns fields whose EN row is missing or stale
  // ---------------------------------------------------------------------------

  async needsSeeding(
    entityType: string,
    entityId: string,
    fieldsES: Record<string, string>,
  ): Promise<Record<string, string>> {
    const subset = this.translatableSubset(entityType, fieldsES);

    const existing = await this.repo.find({
      where: { entityType, entityId, locale: 'en' },
      select: ['field', 'sourceHash', 'source'],
    });

    const byField = new Map(existing.map((r) => [r.field, r]));
    const out: Record<string, string> = {};

    for (const [field, es] of Object.entries(subset)) {
      const row = byField.get(field);
      // revisado rows are NEVER auto re-seeded (D-05) — skip them
      if (row && row.source === 'revisado') continue;
      // Include if: row missing OR stored hash doesn't match current ES hash
      if (!row || row.sourceHash !== this.computeSourceHash(es)) {
        out[field] = es;
      }
    }

    return out;
  }

  // ---------------------------------------------------------------------------
  // overrideTranslation — MT-02: owner-override with IDOR guard
  //
  // Note: the controller/endpoint wiring is added in 28-03 (TranslationsController).
  // This method is implemented here because the seeding spec (28-01) asserts it.
  //
  // IDOR guard strategy (Pitfall 7):
  //   - lodging: entity.user.id === userId
  //   - experience: entity.guide.user.id === userId (ownership via guide — NOT direct user)
  //   - Other entity types: entity.user.id === userId (default pattern)
  // ---------------------------------------------------------------------------

  async overrideTranslation(
    entityType: string,
    entityId: string,
    fields: Record<string, string>,
    userId: string,
    isSuperUser = false,
  ): Promise<{ fields: Record<string, { source: 'auto' | 'revisado'; value: string | null; sourceStale: boolean; updatedAt: string | null }> }> {
    await this.assertOwnership(entityType, entityId, userId, isSuperUser);

    // Load the current ES source values so each revisado row stores the hash of the
    // ES it was based on. Without this the row's source_hash stays NULL and the field
    // is reported as stale immediately after saving (badge 'revisar' instead of
    // 'revisado'). A field only becomes 'revisar' once the ES actually changes later.
    const loaded = await this.loadEntityES(entityType, entityId);
    const esValues = loaded?.fieldsES ?? {};

    for (const [field, value] of Object.entries(fields)) {
      const es = esValues[field];
      const sourceHash = es != null && es !== '' ? this.computeSourceHash(es) : null;
      await this.upsertRevisadoRow(entityType, entityId, field, value, sourceHash);
    }

    return this.getTranslationState(entityType, entityId);
  }

  /**
   * Upserts a translation row with source='revisado' (owner override).
   * Does NOT apply the source != 'revisado' WHERE guard here — the owner IS explicitly
   * overriding their own revisado row (e.g. editing a previously revisado translation).
   */
  private async upsertRevisadoRow(
    entityType: string,
    entityId: string,
    field: string,
    value: string,
    sourceHash: string | null,
  ): Promise<void> {
    await this.repo.query(
      `INSERT INTO entity_translation
         (id, entity_type, entity_id, field, locale, value, source, source_hash, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'en', $4, $5, $6, NOW())
       ON CONFLICT (entity_type, entity_id, field, locale) DO UPDATE
         SET value = EXCLUDED.value,
             source = $5,
             source_hash = $6,
             updated_at = NOW()`,
      [entityType, entityId, field, value, 'revisado', sourceHash],
    );
  }

  /**
   * Asserts that the authenticated user may manage the given entity's translations.
   * Superadmins bypass the ownership check entirely (they manage every business from the
   * admin onboarding wizard); everyone else must be the literal owner (IDOR guard intact).
   * Throws ForbiddenException if neither condition holds.
   */
  private async assertOwnership(
    entityType: string,
    entityId: string,
    userId: string,
    isSuperUser = false,
  ): Promise<void> {
    // Superadmin bypass: they edit businesses they don't own via the admin wizard.
    if (isSuperUser) return;

    if (entityType === 'experience') {
      // Pitfall 7: experience ownership is via guide.user.id, NOT experience.user.id
      const experience = await this.experienceRepo.findOne({
        where: { id: entityId },
        relations: { guide: { user: true } },
      });
      if (!experience || experience.guide?.user?.id !== userId) {
        throw new ForbiddenException('Not your experience');
      }
      return;
    }

    // Default: entity.user.id (lodging, restaurant, guide, commerce, transport, etc.)
    const entity = await this.lodgingRepo.findOne({
      where: { id: entityId },
      relations: ['user'],
    });
    if (!entity || entity.user?.id !== userId) {
      throw new ForbiddenException(`Not your ${entityType}`);
    }
  }

  // ---------------------------------------------------------------------------
  // getTranslationState — read helper for the owner panel (Phase 28.1 consumes this)
  // Returns { fields: Record<field, { source, value, sourceStale, updatedAt }> }
  // matching the frontend ApiEntityTranslations contract exactly.
  //
  // Field set = UNION of:
  //   - TRANSLATABLE_FIELDS_BY_ENTITY[entityType] (auto-translatable; appear as null when unseeded)
  //   - Fields present in EN rows (covers manual-override-only fields like name/title)
  //
  // sourceStale = true when the stored EN row's sourceHash no longer matches sha256(current ES value).
  // updatedAt is serialized as ISO string (or null when the field has never been seeded).
  // ES base-table access is SELECT-only via loadEntityES.
  // ---------------------------------------------------------------------------

  async getTranslationState(
    entityType: string,
    entityId: string,
  ): Promise<{ fields: Record<string, { source: 'auto' | 'revisado'; value: string | null; sourceStale: boolean; updatedAt: string | null }> }> {
    // 1. Load all EN rows for this entity (need sourceHash for staleness)
    const enRows = await this.repo.find({
      where: { entityType, entityId, locale: 'en' },
    });

    // 2. Load current ES source values (SELECT-only; never writes to base tables)
    const loaded = await this.loadEntityES(entityType, entityId);
    const esValues: Record<string, string> = loaded?.fieldsES ?? {};

    return { fields: this.buildFieldsState(entityType, enRows, esValues) };
  }

  /**
   * buildFieldsState (quick 260717-abz) — extracted from getTranslationState so
   * batchStateForIds can derive the same { source, value, sourceStale, updatedAt }
   * shape per entity without re-deriving the badge logic.
   *
   * fields = UNION of TRANSLATABLE_FIELDS_BY_ENTITY[entityType] (auto-translatable;
   * appear as null when unseeded) and field names present in enRows (covers
   * manual-override-only fields like name/title).
   */
  private buildFieldsState(
    entityType: string,
    enRows: EntityTranslation[],
    esValues: Record<string, string>,
  ): Record<string, { source: 'auto' | 'revisado'; value: string | null; sourceStale: boolean; updatedAt: string | null }> {
    const translatableFields: string[] = TRANSLATABLE_FIELDS_BY_ENTITY[entityType] ?? [];
    const enRowFields: string[] = enRows.map((r) => r.field);
    const allFields = Array.from(new Set([...translatableFields, ...enRowFields]));

    const fields: Record<string, { source: 'auto' | 'revisado'; value: string | null; sourceStale: boolean; updatedAt: string | null }> = {};

    for (const field of allFields) {
      const row = enRows.find((r) => r.field === field);
      const value = row?.value ?? null;
      const source = (row?.source as 'auto' | 'revisado') ?? 'auto';
      const updatedAt = row?.updatedAt ? row.updatedAt.toISOString() : null;
      // sourceStale: true when the row exists, the current ES value is known,
      // and the stored sourceHash no longer matches the current ES hash.
      const sourceStale =
        !!row && esValues[field] != null && row.sourceHash !== this.computeSourceHash(esValues[field]);

      fields[field] = { source, value, sourceStale, updatedAt };
    }

    return fields;
  }

  // ---------------------------------------------------------------------------
  // seedOnDemand — POST on-demand seed: owner forces a re-seed of auto/empty fields,
  // OR force-translates a specific field list (bypassing the revisado guard).
  // IDOR-guarded (ownership verified before seeding). Synchronous, single Gemini call.
  // Acceptable because it is owner-initiated, not on the traveler read path (Pitfall 4).
  //
  // opts.fields (per-field FORCE path):
  //   When present, ONLY the requested fields are translated. For each requested field
  //   with non-empty ES source, a single Gemini call is made and the result is upserted
  //   via upsertForceAuto — which bypasses the WHERE source != 'revisado' guard.
  //   This is the ONLY place the revisado guard is bypassed, and ONLY for fields the
  //   owner explicitly requested. The bulk path and the cron are unchanged.
  //
  // opts.fields absent (bulk path):
  //   Falls through to the existing needsSeeding → seedEntity logic (no revisado bypass).
  // ---------------------------------------------------------------------------

  async seedOnDemand(
    entityType: string,
    entityId: string,
    userId: string,
    opts?: { fields?: string[]; isSuperUser?: boolean },
  ): Promise<{ fields: Record<string, { source: 'auto' | 'revisado'; value: string | null; sourceStale: boolean; updatedAt: string | null }> }> {
    await this.assertOwnership(entityType, entityId, userId, opts?.isSuperUser);
    const loaded = await this.loadEntityES(entityType, entityId);
    const esValues = loaded?.fieldsES ?? {};

    if (opts?.fields?.length) {
      // PER-FIELD FORCE path: translate only the requested fields, bypassing revisado guard.
      const subset: Record<string, string> = {};
      for (const field of opts.fields) {
        const esText = esValues[field];
        if (esText != null && esText !== '') {
          subset[field] = esText;
        }
      }

      await this.translateAndUpsert(entityType, entityId, loaded?.displayName ?? entityType, subset, { force: true });
    } else {
      // BULK path: skip revisado and already-fresh fields (existing behaviour unchanged).
      if (loaded) {
        await this.seedEntity(entityType, entityId, loaded.displayName, loaded.fieldsES);
      }
    }

    return this.getTranslationState(entityType, entityId);
  }

  // ---------------------------------------------------------------------------
  // upsertForceAuto — owner-initiated FORCE upsert that bypasses the revisado guard.
  //
  // Identical to upsertTranslation EXCEPT the ON CONFLICT DO UPDATE has no
  // WHERE source != 'revisado' condition — this is intentional and the ONLY
  // place that revisado rows may be overwritten (only via an explicit per-field
  // owner request through seedOnDemand's force path).
  // Sets source back to 'auto' so the row re-enters the normal review cycle.
  // ---------------------------------------------------------------------------

  private async upsertForceAuto(
    entityType: string,
    entityId: string,
    field: string,
    value: string,
    sourceHashES: string,
  ): Promise<void> {
    await this.repo.query(
      `INSERT INTO entity_translation
         (id, entity_type, entity_id, field, locale, value, source, source_hash, updated_at)
       VALUES (gen_random_uuid(), $1, $2::uuid, $3, 'en', $4, 'auto', $5, NOW())
       ON CONFLICT (entity_type, entity_id, field, locale) DO UPDATE
         SET value = EXCLUDED.value,
             source = 'auto',
             source_hash = EXCLUDED.source_hash,
             updated_at = NOW()`,
      [entityType, entityId, field, value, sourceHashES],
    );
  }

  // ---------------------------------------------------------------------------
  // loadEntityES — SELECT-only helper: fetches ES source values for a single
  // entity from its base table. Reads ONLY; no writes/updates/deletes to base tables.
  // Returns { displayName, fieldsES } or null if entity not found.
  // ---------------------------------------------------------------------------

  private async loadEntityES(
    entityType: string,
    entityId: string,
  ): Promise<{ displayName: string; fieldsES: Record<string, string> } | null> {
    const meta = ENTITY_SOURCE_META[entityType];
    if (!meta) return null;

    const fieldEntries = Object.entries(meta.fieldColumns);
    const selectCols = [
      `(${meta.displayNameSql})::text AS display_name`,
      ...fieldEntries.map(([camel, sql]) => `"${sql}" AS "${camel}"`),
    ];

    const rows: Record<string, string | null>[] = await this.dataSource.query(
      `SELECT ${selectCols.join(', ')} FROM "${meta.table}" WHERE id = $1::uuid LIMIT 1`,
      [entityId],
    );

    if (!rows.length) return null;

    const row = rows[0];
    const displayName = row['display_name'] ?? entityType;
    const fieldsES: Record<string, string> = {};

    for (const [camel] of fieldEntries) {
      const val = row[camel];
      if (val != null && val !== '') {
        fieldsES[camel] = val;
      }
    }

    return { displayName, fieldsES };
  }

  // ---------------------------------------------------------------------------
  // sweepPending — Pitfall 2: bounded batch; processes at most batchSize entities
  //
  // For each entity type with translatable fields:
  //   1. Find entity IDs that have NO 'en' row at all (via entity_translation subquery).
  //   2. Load the ES source values from the base entity table (SELECT-only).
  //   3. Call seedEntity to generate and upsert EN translations via Gemini.
  //
  // Revisado-skip is guaranteed by the upsert WHERE source != 'revisado' inside seedEntity.
  // Each entity is wrapped in try/catch so one failure does not abort the sweep.
  // ---------------------------------------------------------------------------

  async sweepPending(opts: { batchSize: number }): Promise<void> {
    let remaining = opts.batchSize;
    this.logger.log(`(translation-sweep) sweepPending started — batchSize=${opts.batchSize}`);

    const entityTypes = Object.entries(TRANSLATABLE_FIELDS_BY_ENTITY)
      .filter(([, fields]) => fields.length > 0)
      .map(([type]) => type);

    for (const entityType of entityTypes) {
      if (remaining <= 0) break;

      // Skip entity types with no source meta (cannot load ES values)
      if (!ENTITY_SOURCE_META[entityType]) {
        this.logger.warn(`(translation-sweep) No ENTITY_SOURCE_META for entityType=${entityType} — skipping`);
        continue;
      }

      try {
        // Find entity IDs of this type that have NO 'en' rows at all.
        // Pure SELECT against entity_translation — no cross-module dependency.
        const rows: { entity_id: string }[] = await this.repo.query(
          `SELECT DISTINCT et.entity_id
           FROM entity_translation et
           WHERE et.entity_type = $1
             AND et.locale != 'en'
             AND et.entity_id NOT IN (
               SELECT entity_id FROM entity_translation
               WHERE entity_type = $1 AND locale = 'en'
             )
           LIMIT $2`,
          [entityType, remaining],
        );

        for (const row of rows) {
          if (remaining <= 0) break;
          try {
            // Load ES source values from the base entity table (SELECT-only)
            const entityData = await this.loadEntityES(entityType, row.entity_id);

            if (!entityData || !Object.keys(entityData.fieldsES).length) {
              this.logger.warn(
                `(translation-sweep) No ES source data for ${entityType}/${row.entity_id} — skipping`,
              );
              remaining--;
              continue;
            }

            this.logger.log(
              `(translation-sweep) Seeding ${entityType}/${row.entity_id} fields: ${Object.keys(entityData.fieldsES).join(', ')}`,
            );

            // Call seedEntity — this calls Gemini and upserts EN rows.
            // The upsert SQL inside seedEntity guards revisado rows (WHERE source != 'revisado').
            await this.seedEntity(entityType, row.entity_id, entityData.displayName, entityData.fieldsES);

            remaining--;
          } catch (err) {
            this.logger.error(`(translation-sweep) Failed to seed ${entityType}/${row.entity_id}`, err);
            remaining--;
          }
        }
      } catch (err) {
        this.logger.error(`(translation-sweep) Failed to query pending entities for ${entityType}`, err);
      }
    }

    this.logger.log(`(translation-sweep) sweepPending done — processed up to ${opts.batchSize - remaining} entities`);
  }

  // ===========================================================================
  // Admin translation surface (quick 260717-abz) — category/facility, NO owner.
  // These methods deliberately skip assertOwnership: category/facility have no
  // `user` column, so the owner-scoped model does not apply to them. Authorization
  // lives in AdminTranslationsController's @SuperAdmin() guard, not here.
  // The allowlist (ADMIN_TRANSLATABLE_ENTITY_TYPES) is enforced by the controller;
  // these methods additionally guard against an unknown entityType via ENTITY_SOURCE_META
  // so a raw request never reaches string-interpolated SQL with an unmapped table name.
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // seedAdminEntity — per-row ✨ button. opts.force=true bypasses the revisado
  // guard (DD-5 — explicit admin action); opts.force=false/absent respects it.
  // ---------------------------------------------------------------------------

  async seedAdminEntity(
    entityType: string,
    entityId: string,
    opts?: { force?: boolean },
  ): Promise<{ fields: Record<string, { source: 'auto' | 'revisado'; value: string | null; sourceStale: boolean; updatedAt: string | null }> }> {
    const loaded = await this.loadEntityES(entityType, entityId);
    const esValues = loaded?.fieldsES ?? {};
    const subset = this.translatableSubset(entityType, esValues);

    await this.translateAndUpsert(entityType, entityId, loaded?.displayName ?? entityType, subset, {
      force: opts?.force,
    });

    return this.getTranslationState(entityType, entityId);
  }

  // ---------------------------------------------------------------------------
  // overrideAdmin — manual EN edit from the inline cell. Same body as
  // overrideTranslation (MT-02) minus assertOwnership: category/facility have
  // no owner to assert against. Reuses upsertRevisadoRow — no duplication.
  // ---------------------------------------------------------------------------

  async overrideAdmin(
    entityType: string,
    entityId: string,
    fields: Record<string, string>,
  ): Promise<{ fields: Record<string, { source: 'auto' | 'revisado'; value: string | null; sourceStale: boolean; updatedAt: string | null }> }> {
    const loaded = await this.loadEntityES(entityType, entityId);
    const esValues = loaded?.fieldsES ?? {};

    for (const [field, value] of Object.entries(fields)) {
      const es = esValues[field];
      const sourceHash = es != null && es !== '' ? this.computeSourceHash(es) : null;
      await this.upsertRevisadoRow(entityType, entityId, field, value, sourceHash);
    }

    return this.getTranslationState(entityType, entityId);
  }

  // ---------------------------------------------------------------------------
  // batchStateForIds — one translation-state lookup per admin list page.
  // ONE query against entity_translation for all ids, then one loadEntityES
  // (SELECT-only, base table) per id for staleness. Reuses buildFieldsState —
  // no re-derivation of the badge logic that getTranslationState already owns.
  // ---------------------------------------------------------------------------

  async batchStateForIds(
    entityType: string,
    ids: string[],
  ): Promise<
    Record<string, { fields: Record<string, { source: 'auto' | 'revisado'; value: string | null; sourceStale: boolean; updatedAt: string | null }> }>
  > {
    if (!ids.length) return {};

    const meta = ENTITY_SOURCE_META[entityType];
    if (!meta) throw new BadRequestException(`Unsupported entityType: ${entityType}`);

    const enRows = await this.repo.find({
      where: { entityType, entityId: In(ids), locale: 'en' },
    });

    const rowsByEntity = new Map<string, EntityTranslation[]>();
    for (const row of enRows) {
      const list = rowsByEntity.get(row.entityId) ?? [];
      list.push(row);
      rowsByEntity.set(row.entityId, list);
    }

    const result: Record<
      string,
      { fields: Record<string, { source: 'auto' | 'revisado'; value: string | null; sourceStale: boolean; updatedAt: string | null }> }
    > = {};

    for (const id of ids) {
      const loaded = await this.loadEntityES(entityType, id);
      const esValues = loaded?.fieldsES ?? {};
      const rows = rowsByEntity.get(id) ?? [];
      result[id] = { fields: this.buildFieldsState(entityType, rows, esValues) };
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // countMissingForType — count of base-table rows with a non-empty translatable
  // value but NO 'en' row at all. category/facility each have exactly ONE
  // translatable field ('name'), so meta.fieldColumns[0] is used directly.
  // ---------------------------------------------------------------------------

  async countMissingForType(entityType: string): Promise<number> {
    const meta = ENTITY_SOURCE_META[entityType];
    if (!meta) throw new BadRequestException(`Unsupported entityType: ${entityType}`);

    const [camel, col] = Object.entries(meta.fieldColumns)[0];

    const rows: { count: number }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM "${meta.table}" b
       WHERE (b."${col}" IS NOT NULL AND b."${col}" != '')
         AND NOT EXISTS (
           SELECT 1 FROM entity_translation et
           WHERE et.entity_type = $1 AND et.entity_id = b.id AND et.locale = 'en' AND et.field = $2
         )`,
      [entityType, camel],
    );

    return rows[0]?.count ?? 0;
  }

  // ---------------------------------------------------------------------------
  // seedMissingForType — "Traducir faltantes (N)" bulk button.
  //
  // CRITICAL: paginates the BASE table (e.g. "category"), exactly the pattern
  // in src/scripts/backfill-translations.ts:340-343 — NOT entity_translation.
  // sweepPending's bug is querying entity_translation for candidates while
  // filtering `locale != 'en'`, a locale that is NEVER stored (only 'en' is) —
  // that query always returns 0 rows. This method never repeats that mistake.
  //
  // Bounded by batchSize (default 50): at most batchSize entities are attempted
  // (Gemini call only for those that actually needsSeeding). One failure does
  // not abort the batch (try/catch per entity, counted in `failed`).
  // ---------------------------------------------------------------------------

  async seedMissingForType(
    entityType: string,
    batchSize = 50,
  ): Promise<{ processed: number; failed: number; remaining: number }> {
    const meta = ENTITY_SOURCE_META[entityType];
    if (!meta) throw new BadRequestException(`Unsupported entityType: ${entityType}`);

    const fieldEntries = Object.entries(meta.fieldColumns);
    const selectCols = [
      `id::text AS id`,
      `(${meta.displayNameSql})::text AS display_name`,
      ...fieldEntries.map(([camel, sql]) => `"${sql}" AS "${camel}"`),
    ];
    const whereClause = fieldEntries.map(([, sql]) => `"${sql}" IS NOT NULL AND "${sql}" != ''`).join(' OR ');

    let processed = 0;
    let failed = 0;
    let attempted = 0;
    let offset = 0;

    while (attempted < batchSize) {
      const rows: Record<string, string>[] = await this.dataSource.query(
        `SELECT ${selectCols.join(', ')} FROM "${meta.table}" WHERE ${whereClause} LIMIT $1 OFFSET $2`,
        [batchSize, offset],
      );

      if (!rows.length) break;
      offset += rows.length;

      for (const row of rows) {
        if (attempted >= batchSize) break;
        attempted++;

        const fieldsES: Record<string, string> = {};
        for (const [camel] of fieldEntries) {
          const val = row[camel];
          if (val != null && val !== '') fieldsES[camel] = val;
        }

        try {
          const needsSeeding = await this.needsSeeding(entityType, row['id'], fieldsES);
          if (!Object.keys(needsSeeding).length) continue;

          await this.translateAndUpsert(entityType, row['id'], row['display_name'] ?? entityType, needsSeeding, {
            force: false,
          });
          processed++;
        } catch (err) {
          this.logger.error(`(seedMissingForType) Failed to seed ${entityType}/${row['id']}`, err);
          failed++;
        }
      }

      // Fewer rows than requested means we've reached the end of the table.
      if (rows.length < batchSize) break;
    }

    const remaining = await this.countMissingForType(entityType);
    return { processed, failed, remaining };
  }
}
