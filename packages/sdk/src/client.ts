import {
  ErrorCode,
  ForbiddenError,
  RegionInUseError,
  RegionNotActiveError,
  RegionNotFoundError,
  TenantArchivedError,
  TenantNotFoundError,
  TenantSuspendedError,
  UnauthorizedError,
  ValidationError,
  WebhookNotFoundError,
} from "@stratum-hq/core";
import type { ResolvedTenantContext, TenantNode, CreateTenantInput, UpdateTenantInput, MoveTenantInput, Webhook, CreateWebhookInput, UpdateWebhookInput, Region, CreateRegionInput, UpdateRegionInput } from "@stratum-hq/core";
import { LRUCache } from "./cache.js";

export interface StratumClientOptions {
  controlPlaneUrl: string;
  apiKey: string;
  regionUrl?: string;
  cache?: { enabled?: boolean; ttlMs?: number; maxSize?: number };
  /**
   * Time limit in milliseconds for each control plane request, including the
   * response body. A request that exceeds it rejects with a `TimeoutError`
   * DOMException. Default: 10000.
   *
   * The value must be an integer from 1 to 4294967295, or `Infinity`.
   * `Infinity` turns the time limit off. Any other value makes the
   * constructor throw a `RangeError`.
   */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
// The largest delay that AbortSignal.timeout accepts.
const MAX_TIMEOUT_MS = 4_294_967_295;

function validTimeoutMs(value: number): number {
  if (value === Number.POSITIVE_INFINITY) return value;
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw new RangeError(
      `timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}, or Infinity to turn the time limit off. Received ${value}`,
    );
  }
  return value;
}

interface ErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: { tenant_id?: unknown; region_id?: unknown; issues?: unknown };
    /** Deprecated copy of `details.issues`. An older control plane sends only this field. */
    issues?: unknown;
  };
}

/**
 * Give a typed error the control plane's own message. The core error
 * constructors add a prefix, and the control plane message already has it.
 */
function withMessage<E extends Error>(err: E, message: string | undefined): E {
  if (message) err.message = message;
  return err;
}

/**
 * Map a failed control plane response to the core error class for its status
 * and error code. A response without a typed error becomes a plain Error.
 */
function responseError(status: number, body: ErrorBody): Error {
  // Fastify's default 404 body has a string `error`, so it has no code.
  const error = typeof body.error === "object" && body.error !== null ? body.error : undefined;
  const code = error?.code;
  const message = error?.message;
  const rawTenantId = error?.details?.tenant_id;
  const tenantId = typeof rawTenantId === "string" ? rawTenantId : "unknown";
  const rawRegionId = error?.details?.region_id;
  const regionId = typeof rawRegionId === "string" ? rawRegionId : "unknown";
  if (status === 400 && code === ErrorCode.VALIDATION_ERROR) {
    const details = isObject(error?.details) ? error.details : undefined;
    const legacyIssues = error?.issues;
    // An older control plane sends the issues only in the deprecated error.issues field.
    if (!Array.isArray(details?.issues) && Array.isArray(legacyIssues)) {
      return new ValidationError(message ?? "Validation failed", { ...details, issues: legacyIssues });
    }
    return new ValidationError(message ?? "Validation failed", details);
  }
  // Every route can answer 404, so only the error code tells what is missing.
  if (status === 404 && code === ErrorCode.TENANT_NOT_FOUND) {
    return withMessage(new TenantNotFoundError(tenantId), message);
  }
  if (status === 404 && code === ErrorCode.WEBHOOK_NOT_FOUND) {
    return withMessage(new WebhookNotFoundError("unknown"), message);
  }
  if (status === 404 && code === ErrorCode.REGION_NOT_FOUND) {
    return withMessage(new RegionNotFoundError(regionId), message);
  }
  if (status === 409 && code === ErrorCode.REGION_IN_USE) {
    return withMessage(new RegionInUseError(regionId), message);
  }
  if (status === 409 && code === ErrorCode.REGION_NOT_ACTIVE) {
    return withMessage(new RegionNotActiveError(regionId), message);
  }
  if (status === 403) {
    return code === ErrorCode.TENANT_SUSPENDED
      ? withMessage(new TenantSuspendedError(tenantId), message)
      : new ForbiddenError(message);
  }
  if (status === 410 && code === ErrorCode.TENANT_ARCHIVED) {
    return withMessage(new TenantArchivedError(tenantId), message);
  }
  return new Error(message ?? `HTTP ${status}`);
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
  private readonly timeoutMs: number;

  constructor(options: StratumClientOptions) {
    this.baseUrl = options.controlPlaneUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.regionUrl = options.regionUrl?.replace(/\/$/, "");
    this.cacheEnabled = options.cache?.enabled !== false;
    this.timeoutMs = validTimeoutMs(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.cache = new LRUCache<string, ResolvedTenantContext>({
      ttlMs: options.cache?.ttlMs,
      maxSize: options.cache?.maxSize,
    });
  }

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await globalThis.fetch(url, {
      ...init,
      signal: this.timeoutMs === Number.POSITIVE_INFINITY ? undefined : AbortSignal.timeout(this.timeoutMs),
      headers: {
        // The control plane rejects the JSON content type on an empty body.
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
        "X-API-Key": this.apiKey,
        ...(init?.headers as Record<string, string> | undefined),
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new UnauthorizedError("Invalid or missing API key");
      }
      const body = await response.json().catch(() => ({})) as ErrorBody | null;
      throw responseError(response.status, body ?? {});
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
   * because the tenant has children, or with `ForbiddenError` because the API key does not
   * have the `admin` scope. A rejection with a `TimeoutError` does not mean that the purge
   * failed: the control plane can complete it after the client stops waiting. Call
   * `getTenant` to find out whether the tenant still exists.
   */
  async purgeTenant(tenantId: string): Promise<void> {
    try {
      await this.fetch<void>(`/api/v1/tenants/${pathSegment(tenantId)}/purge`, {
        method: "POST",
      });
    } finally {
      // A failed request can still have purged the tenant, so the cached context goes either way.
      this.cache.invalidate(cacheKey(tenantId));
    }
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
