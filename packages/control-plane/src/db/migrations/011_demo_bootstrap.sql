-- Insert a bootstrap API key for the demo seed script.
-- Plaintext key: sk_live_demo_key
-- SHA-256 hash computed via: node -e "console.log(require('crypto').createHash('sha256').update('sk_live_demo_key').digest('hex'))"
INSERT INTO api_keys (id, tenant_id, key_hash, key_prefix, name, scopes)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  NULL,
  '4ce0f9725485398b04b656849919e252167d33adb12b8f0addd7d8b1a7f43e48',
  'sk_live_demo_',
  'Demo Bootstrap Key',
  '{read,write,admin}'
)
ON CONFLICT DO NOTHING;
