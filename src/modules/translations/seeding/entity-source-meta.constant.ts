/**
 * ENTITY_SOURCE_META — maps entity type names to their source (ES) DB table metadata.
 *
 * Used by sweepPending in TranslationSeedingService to load Spanish source values
 * from the base entity tables (SELECT-only) so they can be passed to seedEntity.
 *
 * This constant mirrors the ENTITY_META in scripts/backfill-translations.ts.
 * The backfill script is standalone (no NestJS DI); this file is the in-process version.
 *
 * Rules:
 *   - All reads from these tables must be SELECT-only. NO writes, updates, or deletes.
 *   - fieldColumns maps camelCase field name -> SQL column name (matches TRANSLATABLE_FIELDS_BY_ENTITY).
 *   - displayNameSql is used to build the entity display name for the Gemini prompt.
 */

export interface EntitySourceMeta {
  /** SQL table name for the base entity */
  table: string;
  /** SQL expression for the display name used in Gemini prompts */
  displayNameSql: string;
  /** camelCaseField -> sql_column_name for each translatable field */
  fieldColumns: Record<string, string>;
}

export const ENTITY_SOURCE_META: Record<string, EntitySourceMeta> = {
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
