import crypto from "node:crypto";
import pg from "pg";
import * as tenantService from "./services/tenant-service.js";
import * as configService from "./services/config-service.js";
import * as permissionService from "./services/permission-service.js";
import * as apiKeyService from "./services/api-key-service.js";
import * as webhookService from "./services/webhook-service.js";
import * as eventService from "./services/event-service.js";
import type {
  TenantNode,
  CreateTenantInput,
  UpdateTenantInput,
  PaginationInput,
  PaginatedResult,
  ConfigEntry,
  SetConfigInput,
  ResolvedConfig,
  PermissionPolicy,
  CreatePermissionInput,
  UpdatePermissionInput,
  ResolvedPermission,
  Webhook,
  CreateWebhookInput,
  UpdateWebhookInput,
} from "@stratum/core";
import { TenantEvent } from "@stratum/core";

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
  ): void {
    eventService.emitEvent(this.pool, type, tenantId, data).catch(() => {
      // Non-critical: event emission failures do not affect the primary operation
    });
  }

  // Tenant operations
  async createTenant(input: CreateTenantInput): Promise<TenantNode> {
    const tenant = await tenantService.createTenant(this.pool, input);
    this.emitEvent(TenantEvent.TENANT_CREATED, tenant.id, { tenant });
    return tenant;
  }
  getTenant(id: string, includeArchived?: boolean): Promise<TenantNode> {
    return tenantService.getTenant(this.pool, id, includeArchived);
  }
  listTenants(pagination: PaginationInput): Promise<PaginatedResult<TenantNode>> {
    return tenantService.listTenants(this.pool, pagination);
  }
  async updateTenant(id: string, patch: UpdateTenantInput): Promise<TenantNode> {
    const tenant = await tenantService.updateTenant(this.pool, id, patch);
    this.emitEvent(TenantEvent.TENANT_UPDATED, tenant.id, { tenant });
    return tenant;
  }
  async deleteTenant(id: string): Promise<void> {
    await tenantService.deleteTenant(this.pool, id);
    this.emitEvent(TenantEvent.TENANT_DELETED, id, { tenant_id: id });
  }
  async moveTenant(id: string, newParentId: string): Promise<TenantNode> {
    const tenant = await tenantService.moveTenant(this.pool, id, newParentId);
    this.emitEvent(TenantEvent.TENANT_MOVED, tenant.id, { tenant, new_parent_id: newParentId });
    return tenant;
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

  // Config operations
  resolveConfig(tenantId: string): Promise<ResolvedConfig> {
    return configService.resolveConfig(this.pool, tenantId);
  }
  async setConfig(tenantId: string, key: string, input: SetConfigInput): Promise<ConfigEntry> {
    const entry = await configService.setConfig(this.pool, tenantId, key, input);
    this.emitEvent(TenantEvent.CONFIG_UPDATED, tenantId, { key, entry });
    return entry;
  }
  async deleteConfig(tenantId: string, key: string): Promise<void> {
    await configService.deleteConfig(this.pool, tenantId, key);
    this.emitEvent(TenantEvent.CONFIG_DELETED, tenantId, { key });
  }
  getConfigWithInheritance(tenantId: string): Promise<ResolvedConfig> {
    return configService.getConfigWithInheritance(this.pool, tenantId);
  }

  // Permission operations
  resolvePermissions(tenantId: string): Promise<Record<string, ResolvedPermission>> {
    return permissionService.resolvePermissions(this.pool, tenantId);
  }
  async createPermission(tenantId: string, input: CreatePermissionInput): Promise<PermissionPolicy> {
    const policy = await permissionService.createPermission(this.pool, tenantId, input);
    this.emitEvent(TenantEvent.PERMISSION_CREATED, tenantId, { policy });
    return policy;
  }
  async updatePermission(tenantId: string, policyId: string, input: UpdatePermissionInput): Promise<PermissionPolicy> {
    const policy = await permissionService.updatePermission(this.pool, tenantId, policyId, input);
    this.emitEvent(TenantEvent.PERMISSION_UPDATED, tenantId, { policy });
    return policy;
  }
  async deletePermission(tenantId: string, policyId: string): Promise<void> {
    await permissionService.deletePermission(this.pool, tenantId, policyId);
    this.emitEvent(TenantEvent.PERMISSION_DELETED, tenantId, { policy_id: policyId });
  }

  // API Key operations
  createApiKey(tenantId: string, name?: string): Promise<apiKeyService.CreatedApiKey> {
    return apiKeyService.createApiKey(this.pool, this.keyPrefix, tenantId, name);
  }
  validateApiKey(key: string): Promise<{ tenant_id: string | null; key_id: string } | null> {
    return apiKeyService.validateApiKey(this.pool, key);
  }
  revokeApiKey(keyId: string): Promise<boolean> {
    return apiKeyService.revokeApiKey(this.pool, keyId);
  }

  // Webhook operations
  createWebhook(input: CreateWebhookInput): Promise<Webhook> {
    return webhookService.createWebhook(this.pool, input);
  }
  getWebhook(id: string): Promise<Webhook> {
    return webhookService.getWebhook(this.pool, id);
  }
  listWebhooks(tenantId?: string): Promise<Webhook[]> {
    return webhookService.listWebhooks(this.pool, tenantId);
  }
  updateWebhook(id: string, input: UpdateWebhookInput): Promise<Webhook> {
    return webhookService.updateWebhook(this.pool, id, input);
  }
  deleteWebhook(id: string): Promise<void> {
    return webhookService.deleteWebhook(this.pool, id);
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
