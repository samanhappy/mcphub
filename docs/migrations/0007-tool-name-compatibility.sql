-- Required before upgrading with DB_SYNCHRONIZE=false.
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS "normalizeToolNames" boolean;
