import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Freemium (2026-10): every business is visible for free; an active subscription = Premium.
 *
 *  - `pro`        → "Premium Negocios"   $99.900 COP / año (lodging, restaurant, commerce, guide)
 *  - `transport`  → "Premium Transporte" $39.900 COP / año (transport)
 *  - `lodging-free` (legacy lifetime grants) → renamed "Premium Fundadores (vitalicio)", kept
 *    inactive for sale. Its active subscriptions keep counting as Premium (user decision).
 *  - `basico` (legacy, if present) → inactive for sale. Existing subscriptions are untouched.
 *
 * Plan features are display-only rows; they are replaced with the freemium benefit list.
 * Upserts by slug so it works whether or not the plans were created by hand in the admin.
 */
const BUSINESS_FEATURES: Array<[key: string, name: string, value: object]> = [
  ['visibility', 'Mayor exposición dentro de Binntu', { enabled: true }],
  ['featured', 'Perfil destacado en secciones de Binntu', { enabled: true }],
  ['max_photos', 'Hasta 30 fotografías', { limit: 30 }],
  ['promotions', 'Publicación de promociones', { enabled: true }],
  ['campaigns', 'Participación en campañas especiales de Binntu', { enabled: true }],
  ['analytics', 'Estadísticas de visitas e interacción', { enabled: true }],
  ['whatsapp_stats', 'Estadísticas de clics hacia WhatsApp', { enabled: true }],
  ['premium_badge', 'Sello Premium en tu perfil', { enabled: true }],
  ['assistance', 'Acompañamiento para completar y optimizar tu perfil', { enabled: true }],
  ['verification_assistance', 'Acompañamiento para solicitar la verificación', { enabled: true }],
];

const TRANSPORT_FEATURES: Array<[key: string, name: string, value: object]> = [
  ['visibility', 'Mayor visibilidad dentro de Binntu', { enabled: true }],
  ['extended_info', 'Información ampliada: vehículo, capacidad y zonas de cobertura', { enabled: true }],
  ['analytics', 'Estadísticas de visitas e interacción', { enabled: true }],
  ['whatsapp_stats', 'Estadísticas de clics hacia WhatsApp', { enabled: true }],
  ['premium_badge', 'Sello Premium en tu perfil', { enabled: true }],
  ['assistance', 'Acompañamiento para completar tu perfil', { enabled: true }],
  ['verification_assistance', 'Acompañamiento para solicitar la verificación', { enabled: true }],
];

export class FreemiumPremiumPlans1784200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.upsertPlan(queryRunner, {
      slug: 'pro',
      name: 'Premium Negocios',
      description: 'Mayor visibilidad, herramientas y acompañamiento para tu negocio.',
      priceInCents: 9990000,
      entityTypes: ['lodging', 'restaurant', 'commerce', 'guide'],
      sortOrder: 1,
      features: BUSINESS_FEATURES,
    });

    await this.upsertPlan(queryRunner, {
      slug: 'transport',
      name: 'Premium Transporte',
      description: 'Mayor visibilidad, información ampliada y acompañamiento para transportadores.',
      priceInCents: 3990000,
      entityTypes: ['transport'],
      sortOrder: 2,
      features: TRANSPORT_FEATURES,
    });

    await queryRunner.query(`
      UPDATE "plans"
      SET "name" = 'Premium Fundadores (vitalicio)',
          "description" = 'Premium vitalicio otorgado a los primeros negocios de Binntu.',
          "is_active" = false,
          "updated_at" = NOW()
      WHERE "slug" = 'lodging-free'
    `);

    await queryRunner.query(`UPDATE "plans" SET "is_active" = false, "updated_at" = NOW() WHERE "slug" = 'basico'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Data migration: restore the previous names/prices; features are not restored.
    await queryRunner.query(`
      UPDATE "plans" SET "name" = 'Negocios', "price_in_cents" = 9990000, "updated_at" = NOW() WHERE "slug" = 'pro'
    `);
    await queryRunner.query(`
      UPDATE "plans" SET "name" = 'Transporte', "price_in_cents" = 6990000, "updated_at" = NOW() WHERE "slug" = 'transport'
    `);
    await queryRunner.query(`
      UPDATE "plans" SET "name" = 'Plan Free Lodging', "description" = 'Plan gratuito perpetuo para alojamientos',
        "updated_at" = NOW()
      WHERE "slug" = 'lodging-free'
    `);
  }

  private async upsertPlan(
    queryRunner: QueryRunner,
    plan: {
      slug: string;
      name: string;
      description: string;
      priceInCents: number;
      entityTypes: string[];
      sortOrder: number;
      features: Array<[string, string, object]>;
    },
  ): Promise<void> {
    const rows: { id: string }[] = await queryRunner.query(
      `
      INSERT INTO "plans" (
        "id", "name", "slug", "description", "price_in_cents", "currency",
        "billing_interval", "is_active", "sort_order", "entity_types", "created_at", "updated_at"
      ) VALUES (
        uuid_generate_v4(), $1, $2, $3, $4, 'COP', 'yearly', true, $5, $6, NOW(), NOW()
      )
      ON CONFLICT ("slug") DO UPDATE SET
        "name" = EXCLUDED."name",
        "description" = EXCLUDED."description",
        "price_in_cents" = EXCLUDED."price_in_cents",
        "currency" = 'COP',
        "billing_interval" = 'yearly',
        "is_active" = true,
        "sort_order" = EXCLUDED."sort_order",
        "entity_types" = EXCLUDED."entity_types",
        "updated_at" = NOW()
      RETURNING "id"
      `,
      [plan.name, plan.slug, plan.description, plan.priceInCents, plan.sortOrder, plan.entityTypes],
    );
    const planId = rows[0].id;

    await queryRunner.query(`DELETE FROM "plan_features" WHERE "plan_id" = $1`, [planId]);
    for (const [index, [key, name, value]] of plan.features.entries()) {
      await queryRunner.query(
        `
        INSERT INTO "plan_features" ("id", "plan_id", "feature_key", "feature_name", "feature_value", "is_enabled", "sort_order")
        VALUES (uuid_generate_v4(), $1, $2, $3, $4, true, $5)
        `,
        [planId, key, name, JSON.stringify(value), index + 1],
      );
    }
  }
}
