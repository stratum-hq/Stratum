import pg from "pg";
import { withClient } from "../pool-helpers.js";
import type { AuditContext, AuditEntry, AuditLogQuery } from "@stratum/core";

export async function createAuditEntry(
  pool: pg.Pool,
  context: AuditContext,
  action: string,
  resourceType: string,
  resourceId: string | null,
  tenantId: string | null,
  beforeState?: Record<string, unknown> | null,
  afterState?: Record<string, unknown> | null,
  metadata?: Record<string, unknown>,
): Promise<AuditEntry> {
  return withClient(pool, async (client) => {
    const res = await client.query<AuditEntry>(
      `INSERT INTO audit_logs (actor_id, actor_type, action, resource_type, resource_id, tenant_id, source_ip, request_id, before_state, after_state, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, actor_id, actor_type, action, resource_type, resource_id, tenant_id,
                 source_ip::text as source_ip, request_id, before_state, after_state, metadata,
                 created_at::text as created_at`,
      [
        context.actor_id,
        context.actor_type,
        action,
        resourceType,
        resourceId,
        tenantId,
        context.source_ip ?? null,
        context.request_id ?? null,
        beforeState ? JSON.stringify(beforeState) : null,
        afterState ? JSON.stringify(afterState) : null,
        JSON.stringify(metadata ?? {}),
      ],
    );
    return res.rows[0];
  });
}

export async function queryAuditLogs(
  pool: pg.Pool,
  query: AuditLogQuery,
): Promise<AuditEntry[]> {
  return withClient(pool, async (client) => {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (query.tenant_id !== undefined) {
      conditions.push(`tenant_id = $${idx++}`);
      values.push(query.tenant_id);
    }
    if (query.action !== undefined) {
      conditions.push(`action = $${idx++}`);
      values.push(query.action);
    }
    if (query.resource_type !== undefined) {
      conditions.push(`resource_type = $${idx++}`);
      values.push(query.resource_type);
    }
    if (query.actor_id !== undefined) {
      conditions.push(`actor_id = $${idx++}`);
      values.push(query.actor_id);
    }
    if (query.from !== undefined) {
      conditions.push(`created_at >= $${idx++}`);
      values.push(query.from);
    }
    if (query.to !== undefined) {
      conditions.push(`created_at <= $${idx++}`);
      values.push(query.to);
    }
    if (query.cursor !== undefined) {
      conditions.push(`id < $${idx++}`);
      values.push(query.cursor);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    values.push(query.limit);

    const res = await client.query<AuditEntry>(
      `SELECT id, actor_id, actor_type, action, resource_type, resource_id, tenant_id,
              source_ip::text as source_ip, request_id, before_state, after_state, metadata,
              created_at::text as created_at
       FROM audit_logs
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${idx}`,
      values,
    );
    return res.rows;
  });
}

export async function getAuditEntry(
  pool: pg.Pool,
  id: string,
): Promise<AuditEntry | null> {
  return withClient(pool, async (client) => {
    const res = await client.query<AuditEntry>(
      `SELECT id, actor_id, actor_type, action, resource_type, resource_id, tenant_id,
              source_ip::text as source_ip, request_id, before_state, after_state, metadata,
              created_at::text as created_at
       FROM audit_logs
       WHERE id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  });
}
