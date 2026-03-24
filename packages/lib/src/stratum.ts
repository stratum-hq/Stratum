import crypto from "node:crypto";
import pg from "pg";
import * as tenantService from "./services/tenant-service.js";
import * as configService from "./services/config-service.js";
import * as permissionService from "./services/permission-service.js";
import * as apiKeyService from "./services/api-key-service.js";
import * as webhookService from "./services/webhook-service.js";
import * as eventService from "./services/event-service.js";
import * as auditService from "./services/audit-service.js";
import * as consentService from "./services/consent-service.js";
import * as retentionService from "./services/retention-service.js";
import * as regionService from "./services/region-service.js";
import * as keyRotationService from "./services/key-rotation-service.js";
import * as roleService from "./services/role-service.js";
import { traced } from "./telemetry.js";
import type {
  TenantNode,
  CreateTenantInput,
  UpdateTenantInput,
  PaginationInput,
  PaginatedResult,
  ConfigEntry,
  SetConfigInput,
  ResolvedConfig,
  ResolvedConfigEntry,
  BatchSetConfigResult,
  PermissionPolicy,
  CreatePermissionInput,
  UpdatePermissionInput,
  ResolvedPermission,
  Webhook,
  CreateWebhookInput,
  UpdateWebhookInput,
  AuditContext,
  AuditEntry,
  AuditLogQuery,
  ConsentRecord,
  GrantConsentInput,
  Region,
  CreateRegionInput,
  UpdateRegionInput,
  TenantContext,
  ConfigDiff,
  ConfigDiffItem,
  ConfigDiffEntry,
  DriftStatus,
  DriftDetail,
  DriftResult,
  BatchDriftResult,
} from "@stratum-hq/core";
import { TenantEvent } from "@stratum-hq/core";

export interface StratumOptions {
  pool: pg.Pool;
  keyPrefix?: string;
}

export class Stratum {
  private readonly pool: pg.Pool;
  private readonly keyPrefix: string;

  constructor(options: StratumOptions) {
    this.pool = options.pool;
    this.keyPrefix = options.keyPrefix ?? "sk_live_";
  }

  // Internal event emission — fire-and-forget, errors are non-fatal
  private emitEvent(
    type: TenantEvent,
    tenantId: string,
    data: Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parentSpan?: any,
  ): void {
    eventService.emitEvent(this.pool, type, tenantId, data).catch((err) => {
      // Record emission failure on the parent span if available, but never throw
      if (parentSpan) {
        try {
          parentSpan.addEvent("stratum.event_emission_failed", {
            "stratum.event_type": type,
            "stratum.error": err instanceof Error ? err.message : String(err),
          });
        } catch {
          // Swallow — telemetry must never affect the primary operation
        }
      }
    });
  }

  // Tenant operations
  async createTenant(input: CreateTenantInput, audit?: AuditContext): Promise<TenantNode> {
    return traced("tenant.create", { slug: input.slug ?? "" }, async (span) => {
      const tenant = await tenantService.createTenant(this.pool, input);
      span.setAttribute("stratum.tenant_id", tenant.id);
      this.emitEvent(TenantEvent.TENANT_CREATED, tenant.id, { tenant }, span);
      if (audit) {
        await auditService.createAuditEntry(
          this.pool, audit, "tenant.created", "tenant", tenant.id, tenant.id,
          null, tenant as unknown as Record<string, unknown>,
        );
      }
      return tenant;
    });
  }
  getTenant(id: string, includeArchived?: boolean): Promise<TenantNode> {
    return traced("tenant.get", { tenant_id: id }, async () => {
      return tenantService.getTenant(this.pool, id, includeArchived);
    });
  }
  listTenants(pagination: PaginationInput): Promise<PaginatedResult<TenantNode>> {
    return tenantService.listTenants(this.pool, pagination);
  }
  async updateTenant(id: string, patch: UpdateTenantInput, audit?: AuditContext): Promise<TenantNode> {
    return traced("tenant.update", { tenant_id: id }, async (span) => {
      const tenant = await tenantService.updateTenant(this.pool, id, patch);
      this.emitEvent(TenantEvent.TENANT_UPDATED, tenant.id, { tenant }, span);
      if (audit) {
        await auditService.createAuditEntry(
          this.pool, audit, "tenant.updated", "tenant", id, id,
          null, patch as unknown as Record<string, unknown>,
        );
      }
      return tenant;
    });
  }
  async deleteTenant(id: string, audit?: AuditContext): Promise<void> {
    return traced("tenant.delete", { tenant_id: id }, async (span) => {
      await tenantService.deleteTenant(this.pool, id);
      this.emitEvent(TenantEvent.TENANT_DELETED, id, { tenant_id: id }, span);
      if (audit) {
        await auditService.createAuditEntry(
          this.pool, audit, "tenant.deleted", "tenant", id, id,
        );
      }
    });
  }
  async moveTenant(id: string, newParentId: string, audit?: AuditContext): Promise<TenantNode> {
    return traced("tenant.move", { tenant_id: id, new_parent_id: newParentId }, async (span) => {
      const tenant = await tenantService.moveTenant(this.pool, id, newParentId);
      this.emitEvent(TenantEvent.TENANT_MOVED, tenant.id, { tenant, new_parent_id: newParentId }, span);
      if (audit) {
        await auditService.createAuditEntry(
          this.pool, audit, "tenant.moved", "tenant", id, id,
          null, null, { new_parent_id: newParentId },
        );
      }
      return tenant;
    });
  }
  getAncestors(id: string): Promise<TenantNode[]> {
    return tenantService.getAncestors(this.pool, id);
  }
  getDescendants(id: string): Promise<TenantNode[]> {
    return tenantService.getDescendants(this.pool, id);
  }
  getChildren(id: string): Promise<TenantNode[]> {
    return tenantService.getChildren(this.pool, id);
  }
  async reorderTenant(id: string, position: number, audit?: AuditContext): Promise<TenantNode> {
    return traced("tenant.reorder", { tenant_id: id, position }, async () => {
      const tenant = await tenantService.reorderTenant(this.pool, id, position);
      if (audit) {
        await auditService.createAuditEntry(
          this.pool, audit, "tenant.reordered", "tenant", id, id,
          null, null, { position },
        );
      }
      return tenant;
    });
  }

  // Tenant impersonation context
  async getTenantContext(tenantId: string): Promise<TenantContext> {
    const [tenant, config, permissions, ancestors] = await Promise.all([
      this.getTenant(tenantId),
      this.resolveConfig(tenantId),
      this.resolvePermissions(tenantId),
      this.getAncestors(tenantId),
    ]);
    return { tenant, config, permissions, ancestors };
  }

  // Config operations
  resolveConfig(tenantId: string): Promise<ResolvedConfig> {
    return traced("config.resolve", { tenant_id: tenantId }, async () => {
      return configService.resolveConfig(this.pool, tenantId);
    });
  }
  async setConfig(tenantId: string, key: string, input: SetConfigInput, audit?: AuditContext): Promise<ConfigEntry> {
    return traced("config.set", { tenant_id: tenantId, config_key: key }, async (span) => {
      const entry = await configService.setConfig(this.pool, tenantId, key, input);
      this.emitEvent(TenantEvent.CONFIG_UPDATED, tenantId, { key, entry }, span);
      if (audit) {
        await auditService.createAuditEntry(
          this.pool, audit, "config.updated", "config", key, tenantId,
          null, input as unknown as Record<string, unknown>,
        );
      }
      return entry;
    });
  }
  async deleteConfig(tenantId: string, key: string, audit?: AuditContext): Promise<void> {
    await configService.deleteConfig(this.pool, tenantId, key);
    this.emitEvent(TenantEvent.CONFIG_DELETED, tenantId, { key });
    if (audit) {
      await auditService.createAuditEntry(
        this.pool, audit, "config.deleted", "config", key, tenantId,
      );
    }
  }
  getConfigWithInheritance(tenantId: string): Promise<ResolvedConfig> {
    return configService.getConfigWithInheritance(this.pool, tenantId);
  }

  // Config diff
  async diffConfig(tenantIdA: string, tenantIdB: string): Promise<ConfigDiff> {
    const [tenantA, tenantB, configA, configB] = await Promise.all([
      this.getTenant(tenantIdA),
      this.getTenant(tenantIdB),
      this.resolveConfig(tenantIdA),
      this.resolveConfig(tenantIdB),
    ]);

    const allKeys = new Set<string>([
      ...Object.keys(configA),
      ...Object.keys(configB),
    ]);

    const toDiffEntry = (entry: ResolvedConfigEntry): ConfigDiffEntry => {
      let status: "inherited" | "own" | "locked";
      if (entry.locked) {
        status = "locked";
      } else if (entry.inherited) {
        status = "inherited";
      } else {
        status = "own";
      }
      return {
        value: entry.value,
        status,
        source: entry.source_tenant_id,
      };
    };

    const diff: ConfigDiffItem[] = [];
    for (const key of [...allKeys].sort()) {
      diff.push({
        key,
        tenant_a: configA[key] ? toDiffEntry(configA[key]) : null,
        tenant_b: configB[key] ? toDiffEntry(configB[key]) : null,
      });
    }

    return {
      tenant_a: { id: tenantA.id, name: tenantA.name },
      tenant_b: { id: tenantB.id, name: tenantB.name },
      diff,
    };
  }

  // Config drift
  async computeDrift(parentId: string, childId: string): Promise<DriftResult> {
    return traced("config.compute_drift", { parent_id: parentId, child_id: childId }, async () => {
      const diff = await this.diffConfig(parentId, childId);

      const details: DriftDetail[] = [];
      let overrides = 0;
      let missing = 0;
      let conflicts = 0;

      for (const item of diff.diff) {
        const parentEntry = item.tenant_a;
        const childEntry = item.tenant_b;
        const locked = parentEntry?.status === "locked";

        let status: DriftStatus;

        if (parentEntry === null && childEntry !== null) {
          // Key exists only on child — treat as override
          status = "override";
          overrides++;
        } else if (parentEntry !== null && childEntry === null) {
          // Key exists on parent but not on child
          status = "missing";
          missing++;
        } else if (parentEntry !== null && childEntry !== null) {
          const sameValue = JSON.stringify(parentEntry.value) === JSON.stringify(childEntry.value);
          const childIsInherited = childEntry.status === "inherited";

          if (sameValue || childIsInherited) {
            // Child inherits or has the same value
            status = "ok";
          } else if (locked) {
            // Child has overridden a locked parent value
            status = "conflict";
            conflicts++;
          } else {
            // Child has its own value that differs from parent
            status = "override";
            overrides++;
          }
        } else {
          status = "ok";
        }

        details.push({
          key: item.key,
          status,
          parentValue: parentEntry?.value,
          childValue: childEntry?.value,
          locked,
        });
      }

      // Determine worst status: conflict > missing > override > ok
      const statusRank: Record<DriftStatus, number> = { ok: 0, override: 1, missing: 2, conflict: 3 };
      let worstStatus: DriftStatus = "ok";
      for (const detail of details) {
        if (statusRank[detail.status] > statusRank[worstStatus]) {
          worstStatus = detail.status;
        }
      }

      return {
        tenant_id: diff.tenant_b.id,
        tenant_name: diff.tenant_b.name,
        status: worstStatus,
        overrides,
        missing,
        conflicts,
        details,
      };
    });
  }

  async batchComputeDrift(parentId: string, childIds: string[]): Promise<BatchDriftResult> {
    return traced("config.batch_compute_drift", { parent_id: parentId, child_count: childIds.length }, async () => {
      const parent = await this.getTenant(parentId);
      const results = await Promise.all(childIds.map((childId) => this.computeDrift(parentId, childId)));

      const summary: Record<DriftStatus, number> = { ok: 0, override: 0, missing: 0, conflict: 0 };
      for (const result of results) {
        summary[result.status]++;
      }

      return {
        parent_id: parent.id,
        parent_name: parent.name,
        results,
        summary,
      };
    });
  }

  // Permission operations
  resolvePermissions(tenantId: string): Promise<Record<string, ResolvedPermission>> {
    return traced("permissions.resolve", { tenant_id: tenantId }, async () => {
      return permissionService.resolvePermissions(this.pool, tenantId);
    });
  }
  async createPermission(tenantId: string, input: CreatePermissionInput, audit?: AuditContext): Promise<PermissionPolicy> {
    return traced("permission.create", { tenant_id: tenantId }, async (span) => {
      const policy = await permissionService.createPermission(this.pool, tenantId, input);
      this.emitEvent(TenantEvent.PERMISSION_CREATED, tenantId, { policy }, span);
      if (audit) {
        await auditService.createAuditEntry(
          this.pool, audit, "permission.created", "permission", policy.id, tenantId,
          null, policy as unknown as Record<string, unknown>,
        );
      }
      return policy;
    });
  }
  async updatePermission(tenantId: string, policyId: string, input: UpdatePermissionInput, audit?: AuditContext): Promise<PermissionPolicy> {
    const policy = await permissionService.updatePermission(this.pool, tenantId, policyId, input);
    this.emitEvent(TenantEvent.PERMISSION_UPDATED, tenantId, { policy });
    if (audit) {
      await auditService.createAuditEntry(
        this.pool, audit, "permission.updated", "permission", policyId, tenantId,
        null, input as unknown as Record<string, unknown>,
      );
    }
    return policy;
  }
  async deletePermission(tenantId: string, policyId: string, audit?: AuditContext): Promise<void> {
    await permissionService.deletePermission(this.pool, tenantId, policyId);
    this.emitEvent(TenantEvent.PERMISSION_DELETED, tenantId, { policy_id: policyId });
    if (audit) {
      await auditService.createAuditEntry(
        this.pool, audit, "permission.deleted", "permission", policyId, tenantId,
      );
    }
  }

  // API Key operations
  createApiKey(tenantId: string, nameOrOptions?: string | apiKeyService.CreateApiKeyOptions, expiresAt?: Date): Promise<apiKeyService.CreatedApiKey> {
    return traced("api_key.create", { tenant_id: tenantId }, async () => {
      return apiKeyService.createApiKey(this.pool, this.keyPrefix, tenantId, nameOrOptions, expiresAt);
    });
  }
  validateApiKey(key: string): Promise<apiKeyService.ValidatedApiKey | null> {
    return traced("api_key.validate", {}, async () => {
      return apiKeyService.validateApiKey(this.pool, key);
    });
  }
  revokeApiKey(keyId: string): Promise<boolean> {
    return traced("api_key.revoke", { key_id: keyId }, async () => {
      return apiKeyService.revokeApiKey(this.pool, keyId);
    });
  }
  rotateApiKey(keyId: string, newName?: string): Promise<apiKeyService.CreatedApiKey> {
    return apiKeyService.rotateApiKey(this.pool, this.keyPrefix, keyId, newName);
  }
  listApiKeys(tenantId?: string): Promise<Array<{ id: string; tenant_id: string | null; name: string | null; created_at: Date; last_used_at: Date | null; revoked_at: Date | null; expires_at: Date | null }>> {
    return apiKeyService.listApiKeys(this.pool, tenantId);
  }
  listDormantKeys(dormantDays?: number): Promise<Array<{ id: string; tenant_id: string | null; name: string | null; last_used_at: Date | null; created_at: Date }>> {
    return apiKeyService.listDormantKeys(this.pool, dormantDays);
  }

  // Webhook operations
  async createWebhook(input: CreateWebhookInput, audit?: AuditContext): Promise<Webhook> {
    this.validateWebhookUrl(input.url);
    const webhook = await webhookService.createWebhook(this.pool, input);
    if (audit) {
      await auditService.createAuditEntry(
        this.pool, audit, "webhook.created", "webhook", webhook.id, input.tenant_id ?? null,
        null, { url: webhook.url, events: webhook.events } as Record<string, unknown>,
      );
    }
    return webhook;
  }
  getWebhook(id: string): Promise<Webhook> {
    return webhookService.getWebhook(this.pool, id);
  }
  listWebhooks(tenantId?: string): Promise<Webhook[]> {
    return webhookService.listWebhooks(this.pool, tenantId);
  }
  async updateWebhook(id: string, input: UpdateWebhookInput, audit?: AuditContext): Promise<Webhook> {
    if (input.url !== undefined) {
      this.validateWebhookUrl(input.url);
    }
    const webhook = await webhookService.updateWebhook(this.pool, id, input);
    if (audit) {
      await auditService.createAuditEntry(
        this.pool, audit, "webhook.updated", "webhook", id, webhook.tenant_id,
        null, input as unknown as Record<string, unknown>,
      );
    }
    return webhook;
  }
  async deleteWebhook(id: string, audit?: AuditContext): Promise<void> {
    if (audit) {
      const webhook = await webhookService.getWebhook(this.pool, id);
      await webhookService.deleteWebhook(this.pool, id);
      await auditService.createAuditEntry(
        this.pool, audit, "webhook.deleted", "webhook", id, webhook.tenant_id,
      );
    } else {
      await webhookService.deleteWebhook(this.pool, id);
    }
  }
  listWebhookDeliveries(webhookId: string): Promise<Record<string, unknown>[]> {
    return webhookService.listWebhookDeliveries(this.pool, webhookId);
  }
  async testWebhook(id: string): Promise<{ success: boolean; response_code: number | null; error?: string }> {
    const webhook = await webhookService.getWebhook(this.pool, id);

    // SSRF protection
    this.validateWebhookUrl(webhook.url);

    const testPayload = JSON.stringify({
      id: crypto.randomUUID(),
      type: "webhook.test",
      tenant_id: webhook.tenant_id ?? "00000000-0000-0000-0000-000000000000",
      data: { message: "This is a test delivery from Stratum" },
      created_at: new Date().toISOString(),
    });

    // Sign with the actual secret (decrypted)
    const rawSecret = webhookService.decryptSecret(webhook.secret_hash);
    const signature =
      "sha256=" +
      crypto.createHmac("sha256", rawSecret).update(testPayload).digest("hex");
    const timestamp = new Date().toISOString();

    try {
      const response = await globalThis.fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Stratum-Event": "webhook.test",
          "X-Stratum-Signature": signature,
          "X-Stratum-Delivery-ID": crypto.randomUUID(),
          "X-Stratum-Timestamp": timestamp,
        },
        body: testPayload,
        signal: AbortSignal.timeout(10_000),
      });
      return { success: response.ok, response_code: response.status };
    } catch (err) {
      return {
        success: false,
        response_code: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Webhook delivery operations
  listFailedDeliveries(limit?: number, tenantId?: string): Promise<Record<string, unknown>[]> {
    return eventService.listFailedDeliveries(this.pool, limit, tenantId);
  }
  retryDelivery(deliveryId: string): Promise<boolean> {
    return eventService.retryDelivery(this.pool, deliveryId);
  }
  retryFailedDeliveries(tenantId?: string): Promise<number> {
    return eventService.retryFailedDeliveries(this.pool, tenantId);
  }
  getDeliveryStats(tenantId?: string): Promise<eventService.DeliveryStats> {
    return eventService.getDeliveryStats(this.pool, tenantId);
  }

  // Audit log operations
  queryAuditLogs(query: AuditLogQuery): Promise<AuditEntry[]> {
    return auditService.queryAuditLogs(this.pool, query);
  }
  getAuditEntry(id: string): Promise<AuditEntry | null> {
    return auditService.getAuditEntry(this.pool, id);
  }

  // Consent operations
  async grantConsent(tenantId: string, input: GrantConsentInput, audit?: AuditContext): Promise<ConsentRecord> {
    const record = await consentService.grantConsent(this.pool, tenantId, input);
    if (audit) {
      await auditService.createAuditEntry(
        this.pool, audit, "consent.granted", "consent", record.id, tenantId,
        null, { subject_id: input.subject_id, purpose: input.purpose } as Record<string, unknown>,
      );
    }
    return record;
  }
  async revokeConsent(tenantId: string, subjectId: string, purpose: string, audit?: AuditContext): Promise<boolean> {
    const result = await consentService.revokeConsent(this.pool, tenantId, subjectId, purpose);
    if (audit) {
      await auditService.createAuditEntry(
        this.pool, audit, "consent.revoked", "consent", purpose, tenantId,
      );
    }
    return result;
  }
  listConsent(tenantId: string, subjectId?: string): Promise<ConsentRecord[]> {
    return consentService.listConsent(this.pool, tenantId, subjectId);
  }
  getActiveConsent(tenantId: string, subjectId: string, purpose: string): Promise<ConsentRecord | null> {
    return consentService.getActiveConsent(this.pool, tenantId, subjectId, purpose);
  }

  // Data retention & GDPR operations
  async purgeExpiredData(retentionDays?: number): Promise<{ deleted_count: number }> {
    return retentionService.purgeExpiredData(this.pool, retentionDays);
  }
  async purgeTenant(tenantId: string, audit?: AuditContext): Promise<void> {
    await retentionService.purgeTenant(this.pool, tenantId);
    // Write audit entry AFTER purge with null tenant_id so it survives the purge
    if (audit) {
      await auditService.createAuditEntry(
        this.pool, audit, "tenant.purged", "tenant", tenantId, null,
        null, null, { purged_tenant_id: tenantId },
      );
    }
  }
  async exportTenantData(tenantId: string): Promise<Record<string, unknown>> {
    return retentionService.exportTenantData(this.pool, tenantId);
  }

  // Region operations
  async createRegion(input: CreateRegionInput, audit?: AuditContext): Promise<Region> {
    const region = await regionService.createRegion(this.pool, input);
    if (audit) {
      await auditService.createAuditEntry(
        this.pool, audit, "region.created", "region", region.id, null,
        null, input as unknown as Record<string, unknown>,
      );
    }
    return region;
  }
  getRegion(id: string): Promise<Region> {
    return regionService.getRegion(this.pool, id);
  }
  listRegions(): Promise<Region[]> {
    return regionService.listRegions(this.pool);
  }
  async updateRegion(id: string, input: UpdateRegionInput, audit?: AuditContext): Promise<Region> {
    const region = await regionService.updateRegion(this.pool, id, input);
    if (audit) {
      await auditService.createAuditEntry(
        this.pool, audit, "region.updated", "region", id, null,
        null, input as unknown as Record<string, unknown>,
      );
    }
    return region;
  }
  async deleteRegion(id: string, audit?: AuditContext): Promise<void> {
    await regionService.deleteRegion(this.pool, id);
    if (audit) {
      await auditService.createAuditEntry(
        this.pool, audit, "region.deleted", "region", id, null,
      );
    }
  }
  async migrateRegion(tenantId: string, newRegionId: string, audit?: AuditContext): Promise<void> {
    await regionService.migrateRegion(this.pool, tenantId, newRegionId);
    if (audit) {
      await auditService.createAuditEntry(
        this.pool, audit, "tenant.region_migrated", "tenant", tenantId, tenantId,
        null, null, { new_region_id: newRegionId },
      );
    }
  }

  // Role operations (RBAC)
  async createRole(input: roleService.CreateRoleInput, audit?: AuditContext): Promise<roleService.Role> {
    const role = await roleService.createRole(this.pool, input);
    if (audit) {
      await auditService.createAuditEntry(
        this.pool, audit, "role.created", "role", role.id, input.tenant_id ?? null,
        null, { name: role.name, scopes: role.scopes } as Record<string, unknown>,
      );
    }
    return role;
  }
  getRole(id: string): Promise<roleService.Role | null> {
    return roleService.getRole(this.pool, id);
  }
  listRoles(tenantId?: string): Promise<roleService.Role[]> {
    return roleService.listRoles(this.pool, tenantId);
  }
  async updateRole(id: string, input: roleService.UpdateRoleInput, audit?: AuditContext): Promise<roleService.Role | null> {
    const role = await roleService.updateRole(this.pool, id, input);
    if (audit && role) {
      await auditService.createAuditEntry(
        this.pool, audit, "role.updated", "role", id, role.tenant_id,
        null, input as unknown as Record<string, unknown>,
      );
    }
    return role;
  }
  async deleteRole(id: string, audit?: AuditContext): Promise<boolean> {
    const deleted = await roleService.deleteRole(this.pool, id);
    if (audit && deleted) {
      await auditService.createAuditEntry(
        this.pool, audit, "role.deleted", "role", id, null,
      );
    }
    return deleted;
  }
  assignRoleToKey(keyId: string, roleId: string): Promise<boolean> {
    return roleService.assignRoleToKey(this.pool, keyId, roleId);
  }
  removeRoleFromKey(keyId: string): Promise<boolean> {
    return roleService.removeRoleFromKey(this.pool, keyId);
  }
  resolveKeyScopes(keyId: string): Promise<string[]> {
    return roleService.resolveKeyScopes(this.pool, keyId);
  }

  // Batch operations
  async batchCreateTenants(inputs: CreateTenantInput[], audit?: AuditContext): Promise<tenantService.BatchCreateResult> {
    const result = await tenantService.batchCreateTenants(this.pool, inputs);
    for (const tenant of result.created) {
      this.emitEvent(TenantEvent.TENANT_CREATED, tenant.id, { tenant });
    }
    if (audit && result.created.length > 0) {
      await auditService.createAuditEntry(
        this.pool, audit, "tenant.batch_created", "tenant", result.created[0].id, null,
        null, { count: result.created.length, slugs: result.created.map((t) => t.slug) } as Record<string, unknown>,
      );
    }
    return result;
  }
  async batchSetConfig(
    tenantId: string,
    entries: Array<{ key: string; value: unknown; locked?: boolean; sensitive?: boolean }>,
    audit?: AuditContext,
  ): Promise<BatchSetConfigResult> {
    return traced("config.batch_set", { tenant_id: tenantId, entry_count: entries.length }, async (span) => {
      const batchResult = await configService.batchSetConfig(this.pool, tenantId, entries);
      const succeededResults = batchResult.results.filter((r) => r.status === "ok" && r.entry);
      for (const r of succeededResults) {
        this.emitEvent(TenantEvent.CONFIG_UPDATED, tenantId, { key: r.key, entry: r.entry }, span);
      }
      if (audit && succeededResults.length > 0) {
        await auditService.createAuditEntry(
          this.pool, audit, "config.batch_updated", "config", succeededResults[0].key, tenantId,
          null, {
            count: succeededResults.length,
            keys: succeededResults.map((r) => r.key),
            failed: batchResult.failed,
          } as Record<string, unknown>,
        );
      }
      return batchResult;
    });
  }

  // Encryption key rotation
  async rotateEncryptionKey(
    oldKeyMaterial: string,
    newKeyMaterial: string,
    audit?: AuditContext,
  ): Promise<keyRotationService.KeyRotationResult> {
    const result = await keyRotationService.rotateEncryptionKey(this.pool, oldKeyMaterial, newKeyMaterial);
    if (audit) {
      await auditService.createAuditEntry(
        this.pool, audit, "encryption.key_rotated", "system", "encryption_key", null,
        null, { config_entries_rotated: result.config_entries_rotated, webhooks_rotated: result.webhooks_rotated } as Record<string, unknown>,
      );
    }
    return result;
  }

  /** Validates that a webhook URL does not target internal/private networks. */
  private validateWebhookUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid webhook URL: ${url}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Webhook URL must use http or https: ${url}`);
    }
    const hostname = parsed.hostname.toLowerCase();
    const blocked = ["localhost", "localhost.localdomain", "metadata.google.internal"];
    if (blocked.includes(hostname)) {
      throw new Error(`Webhook URL targets a blocked host: ${hostname}`);
    }
    const privatePatterns = [
      /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
      /^169\.254\./, /^0\./, /^::1$/, /^fc00:/, /^fe80:/,
    ];
    for (const pattern of privatePatterns) {
      if (pattern.test(hostname)) {
        throw new Error(`Webhook URL targets a private/reserved IP range: ${hostname}`);
      }
    }
  }
}
