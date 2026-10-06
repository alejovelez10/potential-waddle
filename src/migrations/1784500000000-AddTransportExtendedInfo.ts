import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Freemium (2026-10): "Información ampliada" for Premium transport — vehicle model, capacity,
 * offered services and coverage zones (towns). Shown publicly only while the transport is Premium.
 */
export class AddTransportExtendedInfo1784500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "transport"
        ADD COLUMN IF NOT EXISTS "vehicle_model" varchar(120),
        ADD COLUMN IF NOT EXISTS "capacity" integer,
        ADD COLUMN IF NOT EXISTS "services" text
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "transport_coverage_town" (
        "transport_id" uuid NOT NULL,
        "town_id" uuid NOT NULL,
        CONSTRAINT "PK_transport_coverage_town" PRIMARY KEY ("transport_id", "town_id"),
        CONSTRAINT "FK_transport_coverage_town_transport" FOREIGN KEY ("transport_id") REFERENCES "transport"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_transport_coverage_town_town" FOREIGN KEY ("town_id") REFERENCES "town"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_transport_coverage_town_town" ON "transport_coverage_town" ("town_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "transport_coverage_town"`);
    await queryRunner.query(`
      ALTER TABLE "transport"
        DROP COLUMN IF EXISTS "services",
        DROP COLUMN IF EXISTS "capacity",
        DROP COLUMN IF EXISTS "vehicle_model"
    `);
  }
}
