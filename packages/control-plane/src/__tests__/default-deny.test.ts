import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import type { Stratum } from "@stratum-hq/lib";
import { createAuthMiddleware } from "../middleware/auth.js";
import { createAuthorizeMiddleware } from "../middleware/authorize.js";
import {
  createTenantScopeEnforcer,
  declareTenantScope,
  fromParamId,
} from "../middleware/tenant-scope.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createMockStratum, authHeaders } from "./test-helpers.js";

/**
 * Control-plane authorization must be default-deny: a route that does not
 * declare a tenant scope is refused, so a route added without a guard fails
 * closed instead of silently serving data.
 */

const SCOPED_TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";

let stratum: Stratum;

beforeEach(() => {
  stratum = createMockStratum();
  (stratum.validateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
    key_id: "scoped-key",
    tenant_id: SCOPED_TENANT,
    scopes: ["read", "write", "admin"],
    rate_limit_max: null,
    rate_limit_window: null,
  });
  // Both tenants are roots (empty ancestry), so neither is a descendant of the
  // other: a scoped key may reach only its own.
  (stratum.getTenant as ReturnType<typeof vi.fn>).mockImplementation(
    async (id: string) => ({ id, ancestry_path: "", status: "active" }),
  );
});

/**
 * Build an app wired exactly like the production control plane: authenticate,
 * authorize by scope, then enforce tenant scope. The caller registers routes.
 */
async function buildApp(
  register: (app: FastifyInstance) => void | Promise<void>,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.addHook("preHandler", createAuthMiddleware(stratum));
  app.addHook("preHandler", createAuthorizeMiddleware());
  app.addHook("preHandler", createTenantScopeEnforcer(stratum));
  app.setErrorHandler(errorHandler);
  await register(app);
  await app.ready();
  return app;
}

describe("default-deny authorization", () => {
  it("denies a route that declares no tenant scope", async () => {
    const app = await buildApp((app) => {
      // A control-plane route that ships without any tenant-scope declaration.
      app.get<{ Params: { id: string } }>(
        "/api/v1/unguarded/:id",
        async (_req, reply) => reply.status(200).send({ reached: true }),
      );
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/unguarded/${OTHER_TENANT}`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(403);
  });

  it("admits a route explicitly declared as global", async () => {
    const app = await buildApp((app) => {
      declareTenantScope(app, "global");
      app.get("/api/v1/ops", async (_req, reply) =>
        reply.status(200).send({ ok: true }),
      );
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/ops",
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
  });

  it("enforces a declared extractor: own tenant allowed, others denied", async () => {
    const app = await buildApp((app) => {
      declareTenantScope(app, fromParamId);
      app.get<{ Params: { id: string } }>(
        "/api/v1/tenants/:id/thing",
        async (_req, reply) => reply.status(200).send({ ok: true }),
      );
    });

    const own = await app.inject({
      method: "GET",
      url: `/api/v1/tenants/${SCOPED_TENANT}/thing`,
      headers: authHeaders(),
    });
    const other = await app.inject({
      method: "GET",
      url: `/api/v1/tenants/${OTHER_TENANT}/thing`,
      headers: authHeaders(),
    });

    expect(own.statusCode).toBe(200);
    expect(other.statusCode).toBe(403);
  });
});
