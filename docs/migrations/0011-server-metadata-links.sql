-- Server repository/documentation links (#1495) — schema for deployments with
-- DB_SYNCHRONIZE=false.
--
-- TypeORM creates these columns itself when synchronization is enabled. When it
-- is disabled, apply this file once before upgrading. Every statement is
-- idempotent.
--
-- Column names follow TypeORM's default naming strategy: a camelCase property
-- keeps its case and must be quoted, exactly as the entity declares it.

ALTER TABLE servers ADD COLUMN IF NOT EXISTS "repositoryUrl" text;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS "documentationUrl" text;
