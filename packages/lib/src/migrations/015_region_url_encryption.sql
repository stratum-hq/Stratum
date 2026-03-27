-- Encrypt database_url column in regions table
-- Existing plaintext URLs will need to be migrated via the key rotation service
ALTER TABLE regions RENAME COLUMN database_url TO database_url_encrypted;
-- Add a comment to remind developers this column is encrypted
COMMENT ON COLUMN regions.database_url_encrypted IS 'AES-256-GCM encrypted PostgreSQL connection string. Use encrypt()/decrypt() from @stratum-hq/lib.';
