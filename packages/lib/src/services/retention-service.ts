import pg from "pg";
import { ErrorCode, StratumError } from "@stratum/core";
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

/**
 * GDPR Article 17 — Right to Erasure.
 * Hard-delete ALL data belonging to a specific tenant, in correct FK order.
 */
export async function purgeTenant(
  pool: pg.Pool,
  tenantId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    // Guard: reject if tenant has children (FK RESTRICT would crash otherwise)
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

    // Delete in FK-safe order (children before parents)
    await client.query(`DELETE FROM config_entries WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM permission_policies WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM api_keys WHERE tenant_id = $1`, [tenantId]);

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
    await client.query(`DELETE FROM audit_logs WHERE tenant_id = $1`, [tenantId]);

    // Finally, the tenant itself
    await client.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
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
