/**
 * Freemium limits (2026-10). Free businesses are fully visible; Premium adds capacity.
 * Kept in code (not in plan_features) so the rule is the same for every Premium plan,
 * including admin-granted and legacy lifetime subscriptions.
 */
export const PLAN_LIMITS = {
  free: { maxPhotos: 10 },
  premium: { maxPhotos: 30 },
} as const;
