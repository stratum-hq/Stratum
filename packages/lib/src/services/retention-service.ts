import pg from "pg";
import { ErrorCode, StratumError, type TenantNode } from "@stratum-hq/core";
import { dropSchema, dropDatabase } from "@stratum-hq/db-adapters";
import { withClient, withTransaction } from "../pool-helpers.js";

const DEFAULT_RETENTION_DAYS = 90;

/**
 * Hard-delete audit_logs, webhook_events, and webhook_deliveries older than
 * the specified retention period.
 */
export async function purgeExpiredData(
  pool: pg.Pool,
  retentionDays: number = DEFAULT_RETENTION_DAYS,
): Promise<{ deleted_count: number }> {
  return withTransaction(pool, async (client) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffISO = cutoff.toISOString();

    let totalDeleted = 0;

    // Delete old webhook deliveries first (FK references webhook_events)
    const deliveries = await client.query(
      `DELETE FROM webhook_deliveries WHERE created_at < $1`,
      [cutoffISO],
    );
    totalDeleted += deliveries.rowCount ?? 0;

    // Delete old webhook events
    const events = await client.query(
      `DELETE FROM webhook_events WHERE created_at < $1`,
      [cutoffISO],
    );
    totalDeleted += events.rowCount ?? 0;

    // Delete old audit logs
    const audits = await client.query(
      `DELETE FROM audit_logs WHERE created_at < $1`,
      [cutoffISO],
    );
    totalDeleted += audits.rowCount ?? 0;

    return { deleted_count: totalDeleted };
  });
}

type TenantStorage = Pick<TenantNode, "slug" | "isolation_strategy" | "status">;

// Guard: reject if tenant has children (FK RESTRICT would crash otherwise)
async function assertNoChildren(client: pg.PoolClient, tenantId: string): Promise<void> {
  const childCheck = await client.query(
    `SELECT COUNT(*)::int AS count FROM tenants WHERE parent_id = $1`,
    [tenantId],
  );
  const childCount: number = childCheck.rows[0].count;
  if (childCount > 0) {
    throw new StratumError(
      ErrorCode.TENANT_HAS_CHILDREN,
      `Cannot purge tenant ${tenantId}: has ${childCount} child tenant(s). Purge children first.`,
      409,
      { tenant_id: tenantId, child_count: childCount },
    );
  }
}

/**
 * Whether purge drops this tenant's schema or database. Only a tenant that was
 * activated owns storage: a pending tenant's provisioning never completed, and
 * may have failed because something else already held the name. The storage
 * name is derived by the same db-adapters helpers provisioning uses.
 */
function ownsStorage(tenant: TenantStorage | undefined, strategy: TenantNode["isolation_strategy"]): tenant is TenantStorage {
  return tenant !== undefined && tenant.status !== "pending" && tenant.isolation_strategy === strategy;
}

/**
 * GDPR Article 17 — Right to Erasure.
 * Hard-delete ALL data belonging to a specific tenant, in correct FK order,
 * including its own schema (SCHEMA_PER_TENANT) or database (DB_PER_TENANT).
 *
 * The schema is dropped in the same transaction as the rows, so both go or
 * neither does. DROP DATABASE cannot run in a transaction, so the database is
 * dropped first: if that fails nothing has changed, and if removing the rows
 * then fails, purging again completes (the drop is IF EXISTS).
 */
export async function purgeTenant(
  pool: pg.Pool,
  tenantId: string,
): Promise<void> {
  const before = await withClient(pool, async (client) => {
    await assertNoChildren(client, tenantId);
    const res = await client.query<TenantStorage>(
      `SELECT slug, isolation_strategy, status FROM tenants WHERE id = $1`,
      [tenantId],
    );
    return res.rows[0];
  });

  if (ownsStorage(before, "DB_PER_TENANT")) {
    const client = await pool.connect();
    try {
      await dropDatabase(client, before.slug);
    } finally {
      client.release();
    }
  }

  await withTransaction(pool, async (client) => {
    // Lock the row first so a concurrent create under this tenant (which holds
    // it FOR SHARE) finishes and is counted, rather than failing the delete.
    const res = await client.query<TenantStorage>(
      `SELECT slug, isolation_strategy, status FROM tenants WHERE id = $1 FOR UPDATE`,
      [tenantId],
    );
    const tenant = res.rows[0];
    await assertNoChildren(client, tenantId);

    // Delete in FK-safe order (children before parents)
    await client.query(`DELETE FROM config_entries WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM permission_policies WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM permission_policies WHERE source_tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM api_keys WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM roles WHERE tenant_id = $1`, [tenantId]);

    // Webhook deliveries → webhook events → webhooks
    await client.query(
      `DELETE FROM webhook_deliveries WHERE webhook_id IN (SELECT id FROM webhooks WHERE tenant_id = $1)`,
      [tenantId],
    );
    await client.query(
      `DELETE FROM webhook_events WHERE tenant_id = $1`,
      [tenantId],
    );
    await client.query(`DELETE FROM webhooks WHERE tenant_id = $1`, [tenantId]);

    // Consent records
    await client.query(`DELETE FROM consent_records WHERE tenant_id = $1`, [tenantId]);

    // Audit logs
    await client.query(`DELETE FROM audit_logs WHERE tenant_id = $1 OR (resource_type = 'tenant' AND resource_id = $1::text)`, [tenantId]);

    // Finally, the tenant itself
    await client.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);

    if (ownsStorage(tenant, "SCHEMA_PER_TENANT")) {
      await dropSchema(client, tenant.slug);
    }
  });
}

/**
 * GDPR Article 20 — Right to Data Portability.
 * Export all tenant data as a structured JSON object.
 */
export async function exportTenantData(
  pool: pg.Pool,
  tenantId: string,
): Promise<Record<string, unknown>> {
  return withClient(pool, async (client) => {
    const tenant = await client.query(`SELECT * FROM tenants WHERE id = $1`, [tenantId]);
    const configEntries = await client.query(`SELECT * FROM config_entries WHERE tenant_id = $1`, [tenantId]);
    const permissions = await client.query(`SELECT * FROM permission_policies WHERE tenant_id = $1`, [tenantId]);
    const apiKeys = await client.query(`SELECT id, tenant_id, name, created_at, last_used_at, revoked_at, expires_at FROM api_keys WHERE tenant_id = $1`, [tenantId]);
    const webhooks = await client.query(`SELECT id, tenant_id, url, events, active, description, created_at, updated_at FROM webhooks WHERE tenant_id = $1`, [tenantId]);
    const webhookEvents = await client.query(`SELECT * FROM webhook_events WHERE tenant_id = $1`, [tenantId]);
    const webhookDeliveries = await client.query(
      `SELECT wd.* FROM webhook_deliveries wd JOIN webhooks w ON wd.webhook_id = w.id WHERE w.tenant_id = $1`,
      [tenantId],
    );
    const auditLogs = await client.query(`SELECT * FROM audit_logs WHERE tenant_id = $1`, [tenantId]);
    const consentRecords = await client.query(`SELECT * FROM consent_records WHERE tenant_id = $1`, [tenantId]);

    return {
      tenant: tenant.rows[0] ?? null,
      config_entries: configEntries.rows,
      permission_policies: permissions.rows,
      api_keys: apiKeys.rows,
      webhooks: webhooks.rows,
      webhook_events: webhookEvents.rows,
      webhook_deliveries: webhookDeliveries.rows,
      audit_logs: auditLogs.rows,
      consent_records: consentRecords.rows,
    };
  });
}
