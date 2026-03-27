-- Add scopes column to api_keys with default read+write
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT '{read,write}';
