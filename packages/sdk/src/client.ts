import { TenantNotFoundError, UnauthorizedError } from "@stratum/core";
import type { TenantContext, TenantNode, CreateTenantInput, UpdateTenantInput, MoveTenantInput, Webhook, CreateWebhookInput, UpdateWebhookInput } from "@stratum/core";
import { LRUCache } from "./cache.js";

export interface StratumClientOptions {
  controlPlaneUrl: string;
  apiKey: string;
  cache?: { enabled?: boolean; ttlMs?: number; maxSize?: number };
}

export class StratumClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly cache: LRUCache<string, TenantContext>;
  private readonly cacheEnabled: boolean;

  constructor(options: StratumClientOptions) {
    this.baseUrl = options.controlPlaneUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
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
    const path = rootId
      ? `/api/v1/tenants/${rootId}/descendants`
      : `/api/v1/tenants`;
    return this.fetch<TenantNode[]>(path);
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

  async archiveTenant(tenantId: string): Promise<TenantNode> {
    const node = await this.fetch<TenantNode>(`/api/v1/tenants/${tenantId}/archive`, {
      method: "POST",
    });
    this.cache.invalidate(tenantId);
    return node;
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
}
