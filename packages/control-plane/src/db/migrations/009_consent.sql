CREATE TABLE IF NOT EXISTS consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  granted BOOLEAN NOT NULL DEFAULT true,
  granted_at TIMESTAMPTZ DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, subject_id, purpose)
);

CREATE INDEX IF NOT EXISTS idx_consent_tenant ON consent_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_consent_subject ON consent_records(subject_id);
CREATE INDEX IF NOT EXISTS idx_consent_purpose ON consent_records(purpose);
