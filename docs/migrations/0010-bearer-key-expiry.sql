-- Bearer key expiry and isolated usage tracking — schema for deployments with DB_SYNCHRONIZE=false.
--
-- TypeORM creates/updates these objects when synchronization is enabled. When it is
-- disabled, apply this file once before upgrading. Every statement is idempotent.

ALTER TABLE "bearer_keys" ADD COLUMN IF NOT EXISTS "expires_at" timestamptz;

CREATE TABLE IF NOT EXISTS "bearer_key_usage" (
  "key_id" uuid NOT NULL,
  "last_used_at" timestamptz NOT NULL,
  CONSTRAINT "PK_bearer_key_usage" PRIMARY KEY ("key_id"),
  CONSTRAINT "FK_bearer_key_usage_key" FOREIGN KEY ("key_id") REFERENCES "bearer_keys"("id") ON DELETE CASCADE
);
