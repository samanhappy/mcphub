-- Passkey sign-in — schema for deployments with DB_SYNCHRONIZE=false.
--
-- TypeORM creates this table itself when synchronization is enabled. When it is
-- disabled, apply this file once before upgrading. Every statement is idempotent.
--
-- Column names follow TypeORM's default naming strategy: a camelCase property
-- keeps its case and must be quoted, exactly as the entity declares it.

CREATE TABLE IF NOT EXISTS "user_passkeys" (
  "id" uuid NOT NULL,
  "username" character varying(255) NOT NULL,
  "credentialId" text NOT NULL,
  "publicKey" text NOT NULL,
  "counter" bigint NOT NULL DEFAULT 0,
  "transports" text,
  "userHandle" character varying(128) NOT NULL,
  "rpId" character varying(255) NOT NULL,
  "sessionVersion" character varying(64) NOT NULL,
  "name" character varying(255) NOT NULL,
  "deviceType" character varying(32) NOT NULL,
  "backedUp" boolean NOT NULL DEFAULT false,
  "createdAt" character varying(30) NOT NULL,
  "lastUsedAt" character varying(30),
  CONSTRAINT "PK_user_passkeys" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "IDX_user_passkeys_username" ON "user_passkeys" ("username");
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_user_passkeys_credential" ON "user_passkeys" ("credentialId");
