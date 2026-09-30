-- Migration 025: Redact sensitive config values from existing audit rows.
--
-- setConfig used to record the raw input, including the plaintext value of a
-- config key written with sensitive = true, as the audit after_state. New rows
-- are redacted at write time; this scrubs rows written before that change. The
-- rest of each audit row (actor, key, flags, timestamps) is kept.
--
-- Runs under bypass so row-level security (019) does not hide rows from the
-- migration role.
SET LOCAL app.bypass_rls = 'on';

UPDATE audit_logs
SET after_state = jsonb_set(after_state, '{value}', '"[REDACTED]"'::jsonb)
WHERE action = 'config.updated'
  AND after_state IS NOT NULL
  AND jsonb_typeof(after_state) = 'object'
  AND after_state->>'sensitive' = 'true'
  AND after_state ? 'value'
  AND after_state->'value' IS DISTINCT FROM '"[REDACTED]"'::jsonb;
