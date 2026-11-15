-- File staging (#1056) — schema for deployments with DB_SYNCHRONIZE=false.
--
-- TypeORM creates these objects itself when synchronization is enabled. When it
-- is disabled the hub must not start against a schema missing them, so apply
-- this file once before upgrading. Every statement is idempotent.
--
-- Column names follow TypeORM's default naming strategy: a camelCase property
-- keeps its case and must be quoted, exactly as the entities declare it.

ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "staging" text;

ALTER TABLE "system_config" ADD COLUMN IF NOT EXISTS "fileStaging" text;

CREATE TABLE IF NOT EXISTS "file_staging_refs" (
  "ref" character varying(64) NOT NULL,
  "id" character varying(36) NOT NULL,
  "ownerHash" character varying(64) NOT NULL,
  "serverId" character varying(64) NOT NULL,
  "serverName" character varying(255) NOT NULL,
  "toolName" character varying(255),
  "filename" character varying(255),
  "state" character varying(16) NOT NULL,
  "size" integer NOT NULL DEFAULT 0,
  "sha256" character varying(64),
  "version" integer NOT NULL DEFAULT 0,
  "allowZeroByte" boolean NOT NULL DEFAULT false,
  "reservedBytes" integer,
  "createdAt" timestamp NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "leaseId" character varying(64),
  "leaseUntil" timestamp,
  "pinCount" integer NOT NULL DEFAULT 0,
  "pinUntil" timestamp,
  CONSTRAINT "PK_file_staging_refs" PRIMARY KEY ("ref")
);

CREATE INDEX IF NOT EXISTS "IDX_file_staging_refs_owner" ON "file_staging_refs" ("ownerHash");
CREATE INDEX IF NOT EXISTS "IDX_file_staging_refs_expires" ON "file_staging_refs" ("expiresAt");
CREATE INDEX IF NOT EXISTS "IDX_file_staging_refs_lease" ON "file_staging_refs" ("leaseId");

CREATE TABLE IF NOT EXISTS "file_staging_tokens" (
  "tokenHash" character varying(64) NOT NULL,
  "kind" character varying(16) NOT NULL,
  "ref" character varying(64) NOT NULL,
  "ownerHash" character varying(64) NOT NULL,
  "version" integer NOT NULL DEFAULT 0,
  "contentHash" character varying(64) NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "usedAt" timestamp,
  CONSTRAINT "PK_file_staging_tokens" PRIMARY KEY ("tokenHash")
);

CREATE INDEX IF NOT EXISTS "IDX_file_staging_tokens_ref" ON "file_staging_tokens" ("ref");
CREATE INDEX IF NOT EXISTS "IDX_file_staging_tokens_expires" ON "file_staging_tokens" ("expiresAt");
