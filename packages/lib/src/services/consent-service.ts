import pg from "pg";
import { withClient, withTransaction } from "../pool-helpers.js";
import type { ConsentRecord, GrantConsentInput } from "@stratum/core";

export async function grantConsent(
  pool: pg.Pool,
  tenantId: string,
  input: GrantConsentInput,
): Promise<ConsentRecord> {
  return withTransaction(pool, async (client) => {
    const res = await client.query<ConsentRecord>(
      `INSERT INTO consent_records (tenant_id, subject_id, purpose, granted, granted_at, revoked_at, expires_at, metadata)
       VALUES ($1, $2, $3, true, now(), NULL, $4, $5)
       ON CONFLICT (tenant_id, subject_id, purpose)
       DO UPDATE SET granted = true, granted_at = now(), revoked_at = NULL,
                     expires_at = EXCLUDED.expires_at, metadata = EXCLUDED.metadata,
                     updated_at = now()
       RETURNING id, tenant_id, subject_id, purpose, granted,
                 granted_at::text as granted_at, revoked_at::text as revoked_at,
                 expires_at::text as expires_at, metadata,
                 created_at::text as created_at, updated_at::text as updated_at`,
      [
        tenantId,
        input.subject_id,
        input.purpose,
        input.expires_at ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return res.rows[0];
  });
}

export async function revokeConsent(
  pool: pg.Pool,
  tenantId: string,
  subjectId: string,
  purpose: string,
): Promise<boolean> {
  return withClient(pool, async (client) => {
    const res = await client.query(
      `UPDATE consent_records
       SET granted = false, revoked_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND subject_id = $2 AND purpose = $3
       RETURNING id`,
      [tenantId, subjectId, purpose],
    );
    return res.rowCount !== null && res.rowCount > 0;
  });
}

export async function listConsent(
  pool: pg.Pool,
  tenantId: string,
  subjectId?: string,
): Promise<ConsentRecord[]> {
  return withClient(pool, async (client) => {
    const conditions: string[] = ["tenant_id = $1"];
    const values: unknown[] = [tenantId];

    if (subjectId !== undefined) {
      conditions.push("subject_id = $2");
      values.push(subjectId);
    }

    const where = conditions.join(" AND ");
    const res = await client.query<ConsentRecord>(
      `SELECT id, tenant_id, subject_id, purpose, granted,
              granted_at::text as granted_at, revoked_at::text as revoked_at,
              expires_at::text as expires_at, metadata,
              created_at::text as created_at, updated_at::text as updated_at
       FROM consent_records
       WHERE ${where}
       ORDER BY created_at DESC`,
      values,
    );
    return res.rows;
  });
}

export async function getActiveConsent(
  pool: pg.Pool,
  tenantId: string,
  subjectId: string,
  purpose: string,
): Promise<ConsentRecord | null> {
  return withClient(pool, async (client) => {
    const res = await client.query<ConsentRecord>(
      `SELECT id, tenant_id, subject_id, purpose, granted,
              granted_at::text as granted_at, revoked_at::text as revoked_at,
              expires_at::text as expires_at, metadata,
              created_at::text as created_at, updated_at::text as updated_at
       FROM consent_records
       WHERE tenant_id = $1 AND subject_id = $2 AND purpose = $3
             AND granted = true
             AND (expires_at IS NULL OR expires_at > now())`,
      [tenantId, subjectId, purpose],
    );
    return res.rows[0] ?? null;
  });
}
