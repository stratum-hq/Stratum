-- Add hash_version column to distinguish SHA-256 (legacy) from HMAC-SHA256 hashes.
-- 1 = SHA-256 (legacy), 2 = HMAC-SHA256 (current).
-- Existing keys default to version 1; new keys will be created with version 2.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS hash_version SMALLINT NOT NULL DEFAULT 1;
