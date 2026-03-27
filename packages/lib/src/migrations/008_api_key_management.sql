-- Add expiration and rate limit columns to api_keys
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS rate_limit_max INTEGER;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS rate_limit_window TEXT;

CREATE INDEX idx_api_keys_expires ON api_keys(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_api_keys_last_used ON api_keys(last_used_at);
