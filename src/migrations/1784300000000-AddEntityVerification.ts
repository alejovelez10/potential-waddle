import { MigrationInterface, QueryRunner } from 'typeorm';

/** Freemium (2026-10): "✓ Verificado" seal, independent from Premium. */
export class AddEntityVerification1784300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "entity_verification" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "entity_type" varchar(20) NOT NULL,
        "entity_id" uuid NOT NULL,
        "status" varchar(20) NOT NULL,
        "requested_at" TIMESTAMP WITH TIME ZONE,
        "verified_at" TIMESTAMP WITH TIME ZONE,
        "reviewed_by_id" uuid,
        "reviewed_at" TIMESTAMP WITH TIME ZONE,
        "rejection_reason" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_entity_verification" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_entity_verification_type" CHECK ("entity_type" IN ('lodging', 'restaurant', 'commerce', 'guide', 'transport')),
        CONSTRAINT "CHK_entity_verification_status" CHECK ("status" IN ('requested', 'verified', 'rejected', 'revoked')),
        CONSTRAINT "FK_entity_verification_reviewer" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_entity_verification_entity" ON "entity_verification" ("entity_type", "entity_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_entity_verification_status" ON "entity_verification" ("entity_type", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "entity_verification"`);
  }
}
