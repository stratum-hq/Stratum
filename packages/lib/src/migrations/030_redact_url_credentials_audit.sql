-- Migration 030: Redact URLs in existing webhook and region audit rows.
--
-- Webhook and region audit rows used to record the full webhook URL and
-- control-plane URL. Userinfo, query string and fragment can carry access
-- tokens, and some providers put the secret in the path. New rows record
-- `scheme://host/` when the path is empty or "/", and otherwise
-- `scheme://host/#fp=<first 12 hex characters of sha256(path)>`, so rows for
-- different endpoints stay distinguishable. A URL without a host (for example
-- `mailto:`) is recorded as "[REDACTED]". This migration applies the same
-- reduction to rows written before that change, using the same expression as
-- the write path, and leaves values already in that form unchanged, so running
-- it again changes nothing. The rest of each audit row is kept.
--
-- Runs under bypass so row-level security (019) does not hide rows from the
-- migration role.
SET LOCAL app.bypass_rls = 'on';

UPDATE audit_logs AS a
SET after_state = jsonb_set(a.after_state, '{url}', to_jsonb(r.redacted))
FROM (
  SELECT id,
    CASE
      WHEN v ~ '^[A-Za-z][A-Za-z0-9+.-]*://[^/?#@]+/#fp=[0-9a-f]{12}$' THEN v
      WHEN m IS NULL OR m[2] = '' THEN '[REDACTED]'
      WHEN m[3] IN ('', '/') THEN m[1] || m[2] || '/'
      ELSE m[1] || m[2] || '/#fp=' || left(encode(sha256(convert_to(m[3], 'UTF8')), 'hex'), 12)
    END AS redacted
  FROM (
    SELECT id, after_state->>'url' AS v,
      regexp_match(after_state->>'url', '^([A-Za-z][A-Za-z0-9+.-]*://)(?:[^/?#]*@)?([^/?#]*)([^?#]*)') AS m
    FROM audit_logs
    WHERE resource_type = 'webhook'
      AND action LIKE 'webhook.%'
      AND after_state IS NOT NULL
      AND jsonb_typeof(after_state) = 'object'
      AND jsonb_typeof(after_state->'url') = 'string'
  ) AS s
) AS r
WHERE a.id = r.id
  AND a.after_state->>'url' IS DISTINCT FROM r.redacted;

UPDATE audit_logs AS a
SET before_state = jsonb_set(a.before_state, '{url}', to_jsonb(r.redacted))
FROM (
  SELECT id,
    CASE
      WHEN v ~ '^[A-Za-z][A-Za-z0-9+.-]*://[^/?#@]+/#fp=[0-9a-f]{12}$' THEN v
      WHEN m IS NULL OR m[2] = '' THEN '[REDACTED]'
      WHEN m[3] IN ('', '/') THEN m[1] || m[2] || '/'
      ELSE m[1] || m[2] || '/#fp=' || left(encode(sha256(convert_to(m[3], 'UTF8')), 'hex'), 12)
    END AS redacted
  FROM (
    SELECT id, before_state->>'url' AS v,
      regexp_match(before_state->>'url', '^([A-Za-z][A-Za-z0-9+.-]*://)(?:[^/?#]*@)?([^/?#]*)([^?#]*)') AS m
    FROM audit_logs
    WHERE resource_type = 'webhook'
      AND action LIKE 'webhook.%'
      AND before_state IS NOT NULL
      AND jsonb_typeof(before_state) = 'object'
      AND jsonb_typeof(before_state->'url') = 'string'
  ) AS s
) AS r
WHERE a.id = r.id
  AND a.before_state->>'url' IS DISTINCT FROM r.redacted;

UPDATE audit_logs AS a
SET after_state = jsonb_set(a.after_state, '{control_plane_url}', to_jsonb(r.redacted))
FROM (
  SELECT id,
    CASE
      WHEN v ~ '^[A-Za-z][A-Za-z0-9+.-]*://[^/?#@]+/#fp=[0-9a-f]{12}$' THEN v
      WHEN m IS NULL OR m[2] = '' THEN '[REDACTED]'
      WHEN m[3] IN ('', '/') THEN m[1] || m[2] || '/'
      ELSE m[1] || m[2] || '/#fp=' || left(encode(sha256(convert_to(m[3], 'UTF8')), 'hex'), 12)
    END AS redacted
  FROM (
    SELECT id, after_state->>'control_plane_url' AS v,
      regexp_match(after_state->>'control_plane_url', '^([A-Za-z][A-Za-z0-9+.-]*://)(?:[^/?#]*@)?([^/?#]*)([^?#]*)') AS m
    FROM audit_logs
    WHERE resource_type = 'region'
      AND action LIKE 'region.%'
      AND after_state IS NOT NULL
      AND jsonb_typeof(after_state) = 'object'
      AND jsonb_typeof(after_state->'control_plane_url') = 'string'
  ) AS s
) AS r
WHERE a.id = r.id
  AND a.after_state->>'control_plane_url' IS DISTINCT FROM r.redacted;

UPDATE audit_logs AS a
SET before_state = jsonb_set(a.before_state, '{control_plane_url}', to_jsonb(r.redacted))
FROM (
  SELECT id,
    CASE
      WHEN v ~ '^[A-Za-z][A-Za-z0-9+.-]*://[^/?#@]+/#fp=[0-9a-f]{12}$' THEN v
      WHEN m IS NULL OR m[2] = '' THEN '[REDACTED]'
      WHEN m[3] IN ('', '/') THEN m[1] || m[2] || '/'
      ELSE m[1] || m[2] || '/#fp=' || left(encode(sha256(convert_to(m[3], 'UTF8')), 'hex'), 12)
    END AS redacted
  FROM (
    SELECT id, before_state->>'control_plane_url' AS v,
      regexp_match(before_state->>'control_plane_url', '^([A-Za-z][A-Za-z0-9+.-]*://)(?:[^/?#]*@)?([^/?#]*)([^?#]*)') AS m
    FROM audit_logs
    WHERE resource_type = 'region'
      AND action LIKE 'region.%'
      AND before_state IS NOT NULL
      AND jsonb_typeof(before_state) = 'object'
      AND jsonb_typeof(before_state->'control_plane_url') = 'string'
  ) AS s
) AS r
WHERE a.id = r.id
  AND a.before_state->>'control_plane_url' IS DISTINCT FROM r.redacted;
