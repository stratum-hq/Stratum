-- Migration 026: Redact webhook secrets from existing audit rows.
--
-- updateWebhook used to record the raw input, including a rotated plaintext
-- webhook secret, as the audit after_state. New rows are redacted at write
-- time; this scrubs rows written before that change. The rest of each audit
-- row (actor, webhook id, other changed fields, timestamps) is kept.
--
-- Runs under bypass so row-level security (019) does not hide rows from the
-- migration role.
SET LOCAL app.bypass_rls = 'on';

UPDATE audit_logs
SET after_state = jsonb_set(after_state, '{secret}', '"[REDACTED]"'::jsonb)
WHERE resource_type = 'webhook'
  AND action LIKE 'webhook.%'
  AND after_state IS NOT NULL
  AND jsonb_typeof(after_state) = 'object'
  AND after_state ? 'secret'
  AND after_state->'secret' IS DISTINCT FROM '"[REDACTED]"'::jsonb;

UPDATE audit_logs
SET before_state = jsonb_set(before_state, '{secret}', '"[REDACTED]"'::jsonb)
WHERE resource_type = 'webhook'
  AND action LIKE 'webhook.%'
  AND before_state IS NOT NULL
  AND jsonb_typeof(before_state) = 'object'
  AND before_state ? 'secret'
  AND before_state->'secret' IS DISTINCT FROM '"[REDACTED]"'::jsonb;
