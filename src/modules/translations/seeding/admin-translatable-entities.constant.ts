/**
 * ADMIN_TRANSLATABLE_ENTITY_TYPES (quick 260717-abz, DD-3)
 *
 * Allowlist for the superadmin translation surface (AdminTranslationsController).
 * Category and facility are global entities with NO owner column — the owner-scoped
 * model (assertOwnership) does not apply to them, so they get a separate admin-only
 * path instead of being added to the owner-facing TranslationsController.
 *
 * This allowlist is the blast-radius boundary: it keeps the admin surface from becoming
 * a bypass of the owner-scoped model for lodging/restaurant/experience/guide/commerce.
 */
export const ADMIN_TRANSLATABLE_ENTITY_TYPES = ['category', 'facility'] as const;

export type AdminTranslatableEntityType = (typeof ADMIN_TRANSLATABLE_ENTITY_TYPES)[number];
