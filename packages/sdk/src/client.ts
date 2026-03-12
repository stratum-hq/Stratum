import { TenantNotFoundError, UnauthorizedError } from "@stratum/core";
import type { TenantContext, TenantNode, CreateTenantInput, UpdateTenantInput, MoveTenantInput, Webhook, CreateWebhookInput, UpdateWebhookInput, Region, CreateRegionInput, UpdateRegionInput } from "@stratum/core";
import { LRUCache } from "./cache.js";

export interface StratumClientOptions {
  controlPlaneUrl: string;
  apiKey: string;
  regionUrl?: string;
  cache?: { enabled?: boolean; ttlMs?: number; maxSize?: number };
}

export class StratumClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly regionUrl: string | undefined;
  private readonly cache: LRUCache<string, TenantContext>;
  private readonly cacheEnabled: boolean;

  constructor(options: StratumClientOptions) {
    this.baseUrl = options.controlPlaneUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.regionUrl = options.regionUrl?.replace(/\/$/, "");
    this.cacheEnabled = options.cache?.enabled !== false;
    this.cache = new LRUCache<string, TenantContext>({
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

    return response.json() as Promise<T>;
  }

  async resolveTenant(tenantId: string): Promise<TenantContext> {
    if (this.cacheEnabled) {
      const cached = this.cache.get(tenantId);
      if (cached) return cached;
    }

    const context = await this.fetch<TenantContext>(`/api/v1/tenants/${tenantId}/context`);
    if (this.cacheEnabled) {
      this.cache.set(tenantId, context);
    }
    return context;
  }

  async getTenantTree(rootId?: string): Promise<TenantNode[]> {
    if (rootId) {
      return this.fetch<TenantNode[]>(`/api/v1/tenants/${rootId}/descendants`);
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
    return this.fetch<TenantNode>(`/api/v1/tenants/${tenantId}`);
  }

  async updateTenant(tenantId: string, input: UpdateTenantInput): Promise<TenantNode> {
    const node = await this.fetch<TenantNode>(`/api/v1/tenants/${tenantId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    this.cache.invalidate(tenantId);
    return node;
  }

  async moveTenant(tenantId: string, input: MoveTenantInput): Promise<TenantNode> {
    const node = await this.fetch<TenantNode>(`/api/v1/tenants/${tenantId}/move`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    this.cache.invalidate(tenantId);
    return node;
  }

  async archiveTenant(tenantId: string): Promise<void> {
    await this.fetch<void>(`/api/v1/tenants/${tenantId}`, {
      method: "DELETE",
    });
    this.cache.invalidate(tenantId);
  }

  async deleteTenant(tenantId: string): Promise<void> {
    await this.fetch<void>(`/api/v1/tenants/${tenantId}`, {
      method: "DELETE",
    });
    this.cache.invalidate(tenantId);
  }

  invalidateCache(tenantId: string): void {
    this.cache.invalidate(tenantId);
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
    return this.fetch<Webhook>(`/api/v1/webhooks/${id}`);
  }

  async updateWebhook(id: string, input: UpdateWebhookInput): Promise<Webhook> {
    return this.fetch<Webhook>(`/api/v1/webhooks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.fetch<void>(`/api/v1/webhooks/${id}`, {
      method: "DELETE",
    });
  }

  async rotateApiKey(keyId: string, name?: string): Promise<{ id: string; plaintext_key: string; tenant_id: string | null; name: string | null }> {
    return this.fetch(`/api/v1/api-keys/${keyId}/rotate`, {
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
    return this.fetch<Region>(`/api/v1/regions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  async deleteRegion(id: string): Promise<void> {
    await this.fetch<void>(`/api/v1/regions/${id}`, {
      method: "DELETE",
    });
  }
}
