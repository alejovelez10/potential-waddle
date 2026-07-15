/**
 * TRANSLATABLE_FIELDS_BY_ENTITY
 *
 * The authoritative list of fields that the AI seeding engine is allowed to auto-translate
 * per entity type. Fields NOT in this list (e.g., name, title, address) are NEVER
 * auto-seeded by Gemini — they are manual-override only (Pitfall 5).
 *
 * Rules:
 *   - 'name' is excluded from ALL business entities (lodging, restaurant, place, commerce,
 *     guide, transport). Business names are proper nouns and must not be auto-translated.
 *   - 'title' is excluded from experience for the same reason.
 *   - 'transport' has no free-text translatable fields; its entry is an empty array so the
 *     seeding loop can skip it cleanly.
 *   - 'category' and 'facility' share a single row per item (no per-business entity_id).
 *   - 'roomType' is included for backfill/cron seeding; the Idiomas UI step is deferred.
 */
export const TRANSLATABLE_FIELDS_BY_ENTITY: Record<string, string[]> = {
  lodging: ['description', 'howToGetThere'], // name: manual-only, NOT here (Pitfall 5)
  restaurant: ['description', 'howToGetThere'],
  experience: ['description', 'departureDescription', 'arrivalDescription'], // title: manual-only
  place: ['description', 'howToGetThere'],
  guide: ['biography'],
  commerce: ['description', 'howToGetThere'],
  transport: [], // no free-text translatable fields; excluded from seeding loop
  category: ['name'], // shared, one row per category
  facility: ['name'], // shared, one row per facility
  roomType: ['name', 'description'], // included in backfill/cron; no owner UI in this phase
};
