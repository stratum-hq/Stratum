-- Migration 030: Redact credentials from URLs in existing audit rows.
--
-- Webhook and region audit rows used to record the full webhook URL and
-- control-plane URL, including any userinfo, query string and fragment. New
-- rows keep only scheme, host and path; this reduces rows written before that
-- change the same way. A URL that does not have the scheme://authority shape is
-- replaced with "[REDACTED]". The rest of each audit row is kept. Running it
-- again changes nothing.
--
-- Runs under bypass so row-level security (019) does not hide rows from the
-- migration role.
SET LOCAL app.bypass_rls = 'on';

UPDATE audit_logs AS a
SET after_state = jsonb_set(a.after_state, '{url}', to_jsonb(r.redacted))
FROM (
  SELECT id,
    CASE
      WHEN after_state->>'url' ~ '^[A-Za-z][A-Za-z0-9+.-]*://'
        THEN regexp_replace(after_state->>'url', '^([A-Za-z][A-Za-z0-9+.-]*://)(?:[^/?#]*@)?([^/?#]*)([^?#]*).*$', '\1\2\3')
      ELSE '[REDACTED]'
    END AS redacted
  FROM audit_logs
  WHERE resource_type = 'webhook'
    AND action LIKE 'webhook.%'
    AND after_state IS NOT NULL
    AND jsonb_typeof(after_state) = 'object'
    AND jsonb_typeof(after_state->'url') = 'string'
) AS r
WHERE a.id = r.id
  AND a.after_state->>'url' IS DISTINCT FROM r.redacted;

UPDATE audit_logs AS a
SET before_state = jsonb_set(a.before_state, '{url}', to_jsonb(r.redacted))
FROM (
  SELECT id,
    CASE
      WHEN before_state->>'url' ~ '^[A-Za-z][A-Za-z0-9+.-]*://'
        THEN regexp_replace(before_state->>'url', '^([A-Za-z][A-Za-z0-9+.-]*://)(?:[^/?#]*@)?([^/?#]*)([^?#]*).*$', '\1\2\3')
      ELSE '[REDACTED]'
    END AS redacted
  FROM audit_logs
  WHERE resource_type = 'webhook'
    AND action LIKE 'webhook.%'
    AND before_state IS NOT NULL
    AND jsonb_typeof(before_state) = 'object'
    AND jsonb_typeof(before_state->'url') = 'string'
) AS r
WHERE a.id = r.id
  AND a.before_state->>'url' IS DISTINCT FROM r.redacted;

UPDATE audit_logs AS a
SET after_state = jsonb_set(a.after_state, '{control_plane_url}', to_jsonb(r.redacted))
FROM (
  SELECT id,
    CASE
      WHEN after_state->>'control_plane_url' ~ '^[A-Za-z][A-Za-z0-9+.-]*://'
        THEN regexp_replace(after_state->>'control_plane_url', '^([A-Za-z][A-Za-z0-9+.-]*://)(?:[^/?#]*@)?([^/?#]*)([^?#]*).*$', '\1\2\3')
      ELSE '[REDACTED]'
    END AS redacted
  FROM audit_logs
  WHERE resource_type = 'region'
    AND action LIKE 'region.%'
    AND after_state IS NOT NULL
    AND jsonb_typeof(after_state) = 'object'
    AND jsonb_typeof(after_state->'control_plane_url') = 'string'
) AS r
WHERE a.id = r.id
  AND a.after_state->>'control_plane_url' IS DISTINCT FROM r.redacted;

UPDATE audit_logs AS a
SET before_state = jsonb_set(a.before_state, '{control_plane_url}', to_jsonb(r.redacted))
FROM (
  SELECT id,
    CASE
      WHEN before_state->>'control_plane_url' ~ '^[A-Za-z][A-Za-z0-9+.-]*://'
        THEN regexp_replace(before_state->>'control_plane_url', '^([A-Za-z][A-Za-z0-9+.-]*://)(?:[^/?#]*@)?([^/?#]*)([^?#]*).*$', '\1\2\3')
      ELSE '[REDACTED]'
    END AS redacted
  FROM audit_logs
  WHERE resource_type = 'region'
    AND action LIKE 'region.%'
    AND before_state IS NOT NULL
    AND jsonb_typeof(before_state) = 'object'
    AND jsonb_typeof(before_state->'control_plane_url') = 'string'
) AS r
WHERE a.id = r.id
  AND a.before_state->>'control_plane_url' IS DISTINCT FROM r.redacted;
