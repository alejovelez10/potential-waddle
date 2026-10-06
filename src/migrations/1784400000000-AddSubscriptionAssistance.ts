import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Freemium (2026-10): every Premium purchase includes accompaniment from the Binntu team.
 *  - assistance_status: none | pending | contacted | completed (follow-up queue in the admin)
 *  - assisted_onboarding: bought through "Registro asistido" (paid while the business was a draft)
 */
export class AddSubscriptionAssistance1784400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
        ADD COLUMN IF NOT EXISTS "assistance_status" varchar(20) NOT NULL DEFAULT 'none',
        ADD COLUMN IF NOT EXISTS "assisted_onboarding" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "assistance_notes" text,
        ADD COLUMN IF NOT EXISTS "assisted_by_id" uuid,
        ADD COLUMN IF NOT EXISTS "assistance_updated_at" TIMESTAMP WITH TIME ZONE
    `);
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
        ADD CONSTRAINT "CHK_subscriptions_assistance_status"
        CHECK ("assistance_status" IN ('none', 'pending', 'contacted', 'completed'))
    `);
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
        ADD CONSTRAINT "FK_subscriptions_assisted_by" FOREIGN KEY ("assisted_by_id") REFERENCES "users"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_subscriptions_assistance_status" ON "subscriptions" ("assistance_status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_subscriptions_assistance_status"`);
    await queryRunner.query(`ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "FK_subscriptions_assisted_by"`);
    await queryRunner.query(
      `ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "CHK_subscriptions_assistance_status"`,
    );
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
        DROP COLUMN IF EXISTS "assistance_updated_at",
        DROP COLUMN IF EXISTS "assisted_by_id",
        DROP COLUMN IF EXISTS "assistance_notes",
        DROP COLUMN IF EXISTS "assisted_onboarding",
        DROP COLUMN IF EXISTS "assistance_status"
    `);
  }
}
