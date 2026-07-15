import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * DATA-01 / DATA-04 — generic EAV translations table (greenfield, no `_en` migration, D-12).
 * Conventions: SINGULAR table, uuid PK gen_random_uuid(), snake_case, timestamptz DEFAULT NOW().
 * source/source_hash exist for Phase 28 (AI seed + staleness) — unused this phase.
 */
export class AddEntityTranslationTable1784100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "entity_translation" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "entity_type" varchar(50) NOT NULL,
        "entity_id" uuid NOT NULL,
        "field" varchar(100) NOT NULL,
        "locale" varchar(10) NOT NULL,
        "value" text NOT NULL,
        "source" varchar(20) NOT NULL DEFAULT 'auto',
        "source_hash" varchar(64),
        "updated_at" timestamptz NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "entity_translation"
      ADD CONSTRAINT "UQ_entity_translation_type_id_field_locale"
      UNIQUE ("entity_type", "entity_id", "field", "locale")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_entity_translation_type_id_locale"
      ON "entity_translation" ("entity_type", "entity_id", "locale")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "entity_translation"`);
  }
}
