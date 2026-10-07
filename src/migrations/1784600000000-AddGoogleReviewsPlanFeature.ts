import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Freemium (2026-10): Google reviews (Google Maps rating on the profile, review sync and AI
 * analysis) became a Premium benefit. Adds the display row to "Premium Negocios" (`pro`) right
 * after the WhatsApp stats feature. Plan features are display-only; the gate lives in the API.
 */
export class AddGoogleReviewsPlanFeature1784600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: { id: string; anchor: number | null }[] = await queryRunner.query(`
      SELECT p."id",
             (SELECT pf."sort_order" FROM "plan_features" pf
               WHERE pf."plan_id" = p."id" AND pf."feature_key" = 'whatsapp_stats') AS "anchor"
      FROM "plans" p
      WHERE p."slug" = 'pro'
        AND NOT EXISTS (
          SELECT 1 FROM "plan_features" pf WHERE pf."plan_id" = p."id" AND pf."feature_key" = 'google_reviews'
        )
    `);
    if (rows.length === 0) return;

    const { id: planId, anchor } = rows[0];
    const sortOrder = (anchor ?? 0) + 1;

    await queryRunner.query(
      `UPDATE "plan_features" SET "sort_order" = "sort_order" + 1 WHERE "plan_id" = $1 AND "sort_order" >= $2`,
      [planId, sortOrder],
    );
    await queryRunner.query(
      `
      INSERT INTO "plan_features" ("id", "plan_id", "feature_key", "feature_name", "feature_value", "is_enabled", "sort_order")
      VALUES (uuid_generate_v4(), $1, 'google_reviews', $2, $3, true, $4)
      `,
      [
        planId,
        'Calificación y reseñas de Google Maps en tu perfil (alojamientos, restaurantes y comercios)',
        JSON.stringify({ enabled: true }),
        sortOrder,
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "plan_features"
      WHERE "feature_key" = 'google_reviews'
        AND "plan_id" IN (SELECT "id" FROM "plans" WHERE "slug" = 'pro')
    `);
  }
}
