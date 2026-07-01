import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * DATA-01 — Rafa AI agent schema (mono-tenant, single schema authority).
 *
 * Creates the 8 NEW tables consumed by rafa-ai-service (which mirrors them
 * read-only with SQLAlchemy — never runs DDL). Additive-only: the legacy
 * `src/modules/rafa/` / `rafa_*` tables are NOT touched (D-06/D-09).
 *
 * Conventions (match binntu-nest, verified in 1775000000000-AddGoogleReviewSyncLog):
 * - `uuid PRIMARY KEY DEFAULT gen_random_uuid()`
 * - snake_case quoted identifiers, SINGULAR table names (DATA-01)
 * - `varchar(20)` for kind/status/channel (NOT PG enum), `timestamptz` DEFAULT NOW()
 * - FK to the users table is `REFERENCES "users"("id")` (A1 verified: @Entity name 'users')
 * - No tenant_id / owner_type / visibility / metering columns (D-04)
 *
 * Two partial-unique indexes are hand-added (cannot be expressed by entities):
 *   1. anon conversation uniqueness: visitor_key WHERE user_id IS NULL
 *   2. active-skill name uniqueness: name WHERE active
 *
 * down() drops in reverse FK order (children before parents).
 */
export class AddRafaAiAgentTables1775500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. chat_conversation
    await queryRunner.query(`
      CREATE TABLE "chat_conversation" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
        "visitor_key" text,
        "channel" varchar(20) NOT NULL DEFAULT 'web',
        "title" text,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT NOW(),
        "updated_at" timestamptz NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_conversation_user_id" ON "chat_conversation" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_conversation_visitor_key" ON "chat_conversation" ("visitor_key")`,
    );
    // partial-unique: one anonymous conversation per visitor_key (only when not tied to a user)
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_chat_conversation_visitor_key_anon"
      ON "chat_conversation" ("visitor_key") WHERE "user_id" IS NULL
    `);

    // 2. chat_message
    await queryRunner.query(`
      CREATE TABLE "chat_message" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "conversation_id" uuid NOT NULL REFERENCES "chat_conversation"("id") ON DELETE CASCADE,
        "position" integer NOT NULL,
        "kind" varchar(20) NOT NULL,
        "data" jsonb NOT NULL,
        "run_id" text,
        "model_name" text,
        "created_at" timestamptz NOT NULL DEFAULT NOW(),
        CONSTRAINT "UQ_chat_message_conversation_position" UNIQUE ("conversation_id", "position")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_message_conversation_id" ON "chat_message" ("conversation_id")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_chat_message_run_id" ON "chat_message" ("run_id")`);

    // 3. tool (global catalog)
    await queryRunner.query(`
      CREATE TABLE "tool" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" text NOT NULL,
        "description" text,
        "input_schema" jsonb,
        "output_schema" jsonb,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT NOW(),
        CONSTRAINT "UQ_tool_name" UNIQUE ("name")
      )
    `);

    // 4. skill
    await queryRunner.query(`
      CREATE TABLE "skill" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" text NOT NULL,
        "description" text NOT NULL,
        "body" text NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "allowed_tool_patterns" text[] NOT NULL DEFAULT '{}',
        "auto_invoke" boolean NOT NULL DEFAULT true,
        "always_active" boolean NOT NULL DEFAULT false,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT NOW(),
        "updated_at" timestamptz NOT NULL DEFAULT NOW()
      )
    `);
    // partial-unique: skill name unique among ACTIVE rows only
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_skill_name_active"
      ON "skill" ("name") WHERE "active"
    `);

    // 5. skill_resource
    await queryRunner.query(`
      CREATE TABLE "skill_resource" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "skill_id" uuid NOT NULL REFERENCES "skill"("id") ON DELETE CASCADE,
        "filename" text NOT NULL,
        "resource_type" text NOT NULL DEFAULT 'references',
        "content" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT NOW(),
        CONSTRAINT "UQ_skill_resource_skill_filename" UNIQUE ("skill_id", "filename")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_skill_resource_skill_id" ON "skill_resource" ("skill_id")`,
    );

    // 6. skill_allowed_tool (join)
    await queryRunner.query(`
      CREATE TABLE "skill_allowed_tool" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "skill_id" uuid NOT NULL REFERENCES "skill"("id") ON DELETE CASCADE,
        "tool_id" uuid NOT NULL REFERENCES "tool"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_skill_allowed_tool_skill_tool" UNIQUE ("skill_id", "tool_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_skill_allowed_tool_skill_id" ON "skill_allowed_tool" ("skill_id")`,
    );

    // 7. knowledge_source (trimmed to ~13 sync-relevant cols)
    await queryRunner.query(`
      CREATE TABLE "knowledge_source" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" text NOT NULL,
        "description" text,
        "type" text NOT NULL,
        "bigquery_table" text,
        "bigquery_schema_code" text,
        "vertex_data_store_id" text,
        "enable_semantic_search" boolean NOT NULL DEFAULT false,
        "last_sync_at" timestamptz,
        "last_sync_status" text,
        "last_sync_rows" integer,
        "last_sync_error" text,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT NOW(),
        "updated_at" timestamptz NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_source_is_active" ON "knowledge_source" ("is_active")`,
    );

    // 8. knowledge_source_sync_log
    await queryRunner.query(`
      CREATE TABLE "knowledge_source_sync_log" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "knowledge_source_id" uuid NOT NULL REFERENCES "knowledge_source"("id") ON DELETE CASCADE,
        "status" varchar(20) NOT NULL,
        "rows_synced" integer,
        "duration_ms" integer,
        "error" text,
        "triggered_by" text,
        "created_at" timestamptz NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_source_sync_log_source_created" ON "knowledge_source_sync_log" ("knowledge_source_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop in reverse FK order: children before parents.
    await queryRunner.query(`DROP TABLE IF EXISTS "knowledge_source_sync_log"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "knowledge_source"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "skill_allowed_tool"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "skill_resource"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "skill"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tool"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_message"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_conversation"`);
  }
}
