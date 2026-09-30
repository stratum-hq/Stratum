import { TenantNotFoundError, UnauthorizedError } from "@stratum-hq/core";
import type { ResolvedTenantContext, TenantNode, CreateTenantInput, UpdateTenantInput, MoveTenantInput, Webhook, CreateWebhookInput, UpdateWebhookInput, Region, CreateRegionInput, UpdateRegionInput } from "@stratum-hq/core";
import { LRUCache } from "./cache.js";

export interface StratumClientOptions {
  controlPlaneUrl: string;
  apiKey: string;
  regionUrl?: string;
  cache?: { enabled?: boolean; ttlMs?: number; maxSize?: number };
}

/**
 * Encode an ID for use as a single URL path segment. Dot segments are refused
 * because URL parsing would resolve them against the surrounding path.
 */
function pathSegment(id: string): string {
  if (id === "" || id === "." || id === "..") {
    throw new Error("Invalid identifier");
  }
  return encodeURIComponent(id);
}

function cacheKey(tenantId: string): string {
  return tenantId.toLowerCase();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check that a /context response is a ResolvedTenantContext for the requested
 * tenant. Anything else fails closed rather than being bound as the request's
 * tenant.
 */
function assertResolvedTenantContext(value: unknown, tenantId: string): asserts value is ResolvedTenantContext {
  const ok =
    isObject(value) &&
    typeof value["tenant_id"] === "string" &&
    value["tenant_id"].toLowerCase() === tenantId.toLowerCase() &&
    typeof value["ancestry_path"] === "string" &&
    typeof value["depth"] === "number" &&
    isObject(value["resolved_config"]) &&
    isObject(value["resolved_permissions"]) &&
    typeof value["isolation_strategy"] === "string";
  if (!ok) {
    throw new Error("Control plane returned an invalid tenant context");
  }
}

export class StratumClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly regionUrl: string | undefined;
  private readonly cache: LRUCache<string, ResolvedTenantContext>;
  private readonly cacheEnabled: boolean;

  constructor(options: StratumClientOptions) {
    this.baseUrl = options.controlPlaneUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.regionUrl = options.regionUrl?.replace(/\/$/, "");
    this.cacheEnabled = options.cache?.enabled !== false;
    this.cache = new LRUCache<string, ResolvedTenantContext>({
      ttlMs: options.cache?.ttlMs,
      maxSize: options.cache?.maxSize,
    });
  }

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await globalThis.fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
        ...(init?.headers as Record<string, string> | undefined),
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new UnauthorizedError("Invalid or missing API key");
      }
      if (response.status === 404) {
        const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
        throw new TenantNotFoundError(body?.error?.message ?? "unknown");
      }
      const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  async resolveTenant(tenantId: string): Promise<ResolvedTenantContext> {
    if (tenantId === "" || tenantId === "." || tenantId === "..") {
      throw new TenantNotFoundError(tenantId);
    }
    const path = `/api/v1/tenants/${pathSegment(tenantId)}/context`;
    if (this.cacheEnabled) {
      const cached = this.cache.get(cacheKey(tenantId));
      if (cached) return cached;
    }

    const context = await this.fetch<unknown>(path);
    assertResolvedTenantContext(context, tenantId);
    if (this.cacheEnabled) {
      this.cache.set(cacheKey(tenantId), context);
    }
    return context;
  }

  async getTenantTree(rootId?: string): Promise<TenantNode[]> {
    if (rootId) {
      return this.fetch<TenantNode[]>(`/api/v1/tenants/${pathSegment(rootId)}/descendants`);
    }
    const result = await this.fetch<{ data: TenantNode[] }>(`/api/v1/tenants`);
    return result.data;
  }

  async createTenant(input: CreateTenantInput): Promise<TenantNode> {
    return this.fetch<TenantNode>("/api/v1/tenants", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async getTenant(tenantId: string): Promise<TenantNode> {
    return this.fetch<TenantNode>(`/api/v1/tenants/${pathSegment(tenantId)}`);
  }

  async updateTenant(tenantId: string, input: UpdateTenantInput): Promise<TenantNode> {
    const node = await this.fetch<TenantNode>(`/api/v1/tenants/${pathSegment(tenantId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    this.cache.invalidate(cacheKey(tenantId));
    return node;
  }

  async moveTenant(tenantId: string, input: MoveTenantInput): Promise<TenantNode> {
    const node = await this.fetch<TenantNode>(`/api/v1/tenants/${pathSegment(tenantId)}/move`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    // Descendants' cached ancestry, config and permissions change with the move.
    this.cache.clear();
    return node;
  }

  async archiveTenant(tenantId: string): Promise<void> {
    await this.fetch<void>(`/api/v1/tenants/${pathSegment(tenantId)}`, {
      method: "DELETE",
    });
    this.cache.invalidate(cacheKey(tenantId));
  }

  /**
   * Archive the tenant. This is a soft delete, and it is identical to `archiveTenant`.
   *
   * The tenant row and its data stay in the database, and the archive is reversible.
   * To remove the tenant data permanently, call `purgeTenant`.
   *
   * @deprecated The name suggests that the data is removed. Use `archiveTenant` for
   * a soft delete, or `purgeTenant` for an irreversible hard delete.
   */
  async deleteTenant(tenantId: string): Promise<void> {
    await this.fetch<void>(`/api/v1/tenants/${pathSegment(tenantId)}`, {
      method: "DELETE",
    });
    this.cache.invalidate(cacheKey(tenantId));
  }

  /**
   * Permanently remove the tenant and its Stratum records (GDPR Article 17). You cannot undo this.
   *
   * The control plane deletes the tenant row and the tenant's records in the Stratum tables:
   * config, permissions, API keys, roles, webhooks, consent records and audit logs.
   * For a tenant with its own schema or database, it also drops that schema or database.
   * For a pending tenant, the purge removes the records and never drops storage.
   * Rows in your own tables that share a database with other tenants stay; delete them yourself.
   * The API key must have the `admin` scope.
   *
   * @param tenantId - The id of the tenant to purge. The tenant must have no children.
   * @returns A promise that rejects when the control plane refuses the purge, for example
   * because the tenant has children or the API key does not have the `admin` scope.
   */
  async purgeTenant(tenantId: string): Promise<void> {
    await this.fetch<void>(`/api/v1/tenants/${pathSegment(tenantId)}/purge`, {
      method: "POST",
      // Fastify rejects the JSON content type with an empty body.
      // TODO(#385): Remove this body when fetch sends the content type only with a body.
      body: "{}",
    });
    this.cache.invalidate(cacheKey(tenantId));
  }

  invalidateCache(tenantId: string): void {
    this.cache.invalidate(cacheKey(tenantId));
  }

  clearCache(): void {
    this.cache.clear();
  }

  async createWebhook(input: CreateWebhookInput): Promise<Webhook> {
    return this.fetch<Webhook>("/api/v1/webhooks", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async listWebhooks(tenantId?: string): Promise<Webhook[]> {
    const path = tenantId
      ? `/api/v1/webhooks?tenant_id=${encodeURIComponent(tenantId)}`
      : "/api/v1/webhooks";
    return this.fetch<Webhook[]>(path);
  }

  async getWebhook(id: string): Promise<Webhook> {
    return this.fetch<Webhook>(`/api/v1/webhooks/${pathSegment(id)}`);
  }

  async updateWebhook(id: string, input: UpdateWebhookInput): Promise<Webhook> {
    return this.fetch<Webhook>(`/api/v1/webhooks/${pathSegment(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.fetch<void>(`/api/v1/webhooks/${pathSegment(id)}`, {
      method: "DELETE",
    });
  }

  async rotateApiKey(keyId: string, name?: string): Promise<{ id: string; plaintext_key: string; tenant_id: string | null; name: string | null }> {
    return this.fetch(`/api/v1/api-keys/${pathSegment(keyId)}/rotate`, {
      method: "POST",
      body: JSON.stringify(name ? { name } : {}),
    });
  }

  async listApiKeys(tenantId?: string): Promise<Array<{ id: string; tenant_id: string | null; name: string | null; created_at: string; last_used_at: string | null; expires_at: string | null }>> {
    const path = tenantId
      ? `/api/v1/api-keys?tenant_id=${encodeURIComponent(tenantId)}`
      : "/api/v1/api-keys";
    return this.fetch(path);
  }

  async listDormantKeys(days?: number): Promise<Array<{ id: string; tenant_id: string | null; name: string | null; last_used_at: string | null }>> {
    const path = days
      ? `/api/v1/api-keys/dormant?days=${days}`
      : "/api/v1/api-keys/dormant";
    return this.fetch(path);
  }

  // Region operations
  async listRegions(): Promise<Region[]> {
    return this.fetch<Region[]>("/api/v1/regions");
  }

  async createRegion(input: CreateRegionInput): Promise<Region> {
    return this.fetch<Region>("/api/v1/regions", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async updateRegion(id: string, input: UpdateRegionInput): Promise<Region> {
    return this.fetch<Region>(`/api/v1/regions/${pathSegment(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  async deleteRegion(id: string): Promise<void> {
    await this.fetch<void>(`/api/v1/regions/${pathSegment(id)}`, {
      method: "DELETE",
    });
  }
}
