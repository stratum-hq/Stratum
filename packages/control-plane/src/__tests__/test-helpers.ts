import Fastify, { FastifyInstance } from "fastify";
import { vi } from "vitest";
import jwt from "jsonwebtoken";
import { errorHandler } from "../middleware/error-handler.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { createAuthorizeMiddleware } from "../middleware/authorize.js";
import { healthRoutes } from "../routes/health.js";
import { createTenantRoutes } from "../routes/tenants.js";
import { createConfigRoutes } from "../routes/config.js";
import { createApiKeyRoutes } from "../routes/api-keys.js";
import type { Stratum } from "@stratum-hq/lib";

// The JWT secret used in dev mode (from config.ts fallback)
export const TEST_JWT_SECRET = "dev-secret-change-in-production";

/**
 * Create a mock Stratum instance with all methods stubbed via vi.fn().
 * Tests override individual method implementations as needed.
 */
export function createMockStratum(): Stratum {
  return {
    // Tenant methods
    createTenant: vi.fn(),
    getTenant: vi.fn(),
    listTenants: vi.fn(),
    updateTenant: vi.fn(),
    deleteTenant: vi.fn(),
    batchCreateTenants: vi.fn(),
    moveTenant: vi.fn(),
    getAncestors: vi.fn(),
    getDescendants: vi.fn(),
    getChildren: vi.fn(),
    purgeTenant: vi.fn(),
    exportTenantData: vi.fn(),
    migrateRegion: vi.fn(),

    // Config methods
    resolveConfig: vi.fn(),
    setConfig: vi.fn(),
    deleteConfig: vi.fn(),
    batchSetConfig: vi.fn(),
    getConfigWithInheritance: vi.fn(),

    // Permission methods
    resolvePermissions: vi.fn(),

    // API key methods
    createApiKey: vi.fn(),
    validateApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    rotateApiKey: vi.fn(),
    listApiKeys: vi.fn(),
    listDormantKeys: vi.fn(),
  } as unknown as Stratum;
}

/**
 * Build a test Fastify app with routes registered and middleware wired up.
 * Uses the provided mock Stratum instance.
 *
 * We skip OpenAPI/swagger, helmet, cors, and rate-limit plugins to keep tests fast
 * and focused on the HTTP/route/middleware layer.
 */
export async function buildTestApp(stratum: Stratum): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Wire up the same middleware chain as the real app
  app.addHook("preHandler", createAuthMiddleware(stratum));
  app.addHook("preHandler", createAuthorizeMiddleware());
  app.setErrorHandler(errorHandler);

  // Register routes (pass a stub Redis health checker — Redis is not used in tests)
  const noopRedisHealth = async () => "not_configured" as const;
  await app.register(healthRoutes(noopRedisHealth));
  await app.register(createTenantRoutes(stratum), { prefix: "/api/v1/tenants" });
  await app.register(createConfigRoutes(stratum), { prefix: "/api/v1/tenants/:id/config" });
  await app.register(createApiKeyRoutes(stratum), { prefix: "/api/v1/api-keys" });

  await app.ready();
  return app;
}

/**
 * Helper: returns headers object with a valid API key authentication.
 * The mock stratum.validateApiKey must be configured to accept this key.
 */
export function authHeaders(apiKey: string = "sk_test_valid_key"): Record<string, string> {
  return { "x-api-key": apiKey };
}

/**
 * Helper: returns headers object with a valid JWT Bearer token.
 */
export function jwtHeaders(
  payload: Record<string, unknown> = {},
  secret: string = TEST_JWT_SECRET,
): Record<string, string> {
  const token = jwt.sign(
    {
      sub: "test-user-id",
      scopes: ["read", "write", "admin"],
      ...payload,
    },
    secret,
    { algorithm: "HS256", expiresIn: "1h" },
  );
  return { authorization: `Bearer ${token}` };
}

/**
 * Configure the mock stratum to accept the default test API key
 * with admin scopes (read + write + admin). This is the common case.
 */
export function setupAdminApiKey(stratum: Stratum): void {
  (stratum.validateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
    key_id: "test-key-id",
    tenant_id: null,
    scopes: ["read", "write", "admin"],
    rate_limit_max: null,
    rate_limit_window: null,
  });
}

/**
 * Configure the mock stratum to accept the default test API key
 * with read-only scope.
 */
export function setupReadOnlyApiKey(stratum: Stratum): void {
  (stratum.validateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
    key_id: "test-key-id-readonly",
    tenant_id: null,
    scopes: ["read"],
    rate_limit_max: null,
    rate_limit_window: null,
  });
}

/**
 * Configure the mock stratum to accept the default test API key
 * with write scope (read + write but not admin).
 */
export function setupWriteApiKey(stratum: Stratum): void {
  (stratum.validateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
    key_id: "test-key-id-write",
    tenant_id: null,
    scopes: ["read", "write"],
    rate_limit_max: null,
    rate_limit_window: null,
  });
}

/** A sample tenant object for test assertions */
export const SAMPLE_TENANT = {
  id: "t-uuid-1",
  slug: "acme-corp",
  name: "Acme Corp",
  parent_id: null,
  ancestry_path: "/t-uuid-1",
  depth: 0,
  metadata: {},
  isolation_strategy: "SHARED_RLS",
  region_id: null,
  created_at: new Date("2025-01-01").toISOString(),
  updated_at: new Date("2025-01-01").toISOString(),
  deleted_at: null,
};

/** A second sample tenant (child) */
export const SAMPLE_CHILD_TENANT = {
  id: "t-uuid-2",
  slug: "acme-division",
  name: "Acme Division",
  parent_id: "t-uuid-1",
  ancestry_path: "/t-uuid-1/t-uuid-2",
  depth: 1,
  metadata: {},
  isolation_strategy: "SHARED_RLS",
  region_id: null,
  created_at: new Date("2025-01-02").toISOString(),
  updated_at: new Date("2025-01-02").toISOString(),
  deleted_at: null,
};
