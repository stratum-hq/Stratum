import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Mock } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import type { Stratum } from "@stratum-hq/lib";
import { errorHandler } from "../middleware/error-handler.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { createAuthorizeMiddleware } from "../middleware/authorize.js";
import { createTenantScopeEnforcer } from "../middleware/tenant-scope.js";
import { createAbacRoutes } from "../routes/abac.js";
import { createConsentRoutes } from "../routes/consent.js";
import { createAuditLogRoutes } from "../routes/audit-logs.js";
import { createMockStratum, authHeaders, setupAdminApiKey, SAMPLE_TENANT } from "./test-helpers.js";

// The service mocks fail the way PostgreSQL does for a value outside the
// column type. A request that reaches them returns 500, so a 400 proves the
// route rejects the value before the database sees it.
function postgresError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

async function buildApp(stratum: Stratum): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.addHook("preHandler", createAuthMiddleware(stratum));
  app.addHook("preHandler", createAuthorizeMiddleware());
  app.addHook("preHandler", createTenantScopeEnforcer(stratum));
  app.setErrorHandler(errorHandler);
  await app.register(createAbacRoutes(stratum), { prefix: "/api/v1/tenants/:tenantId/abac-policies" });
  await app.register(createConsentRoutes(stratum), { prefix: "/api/v1/tenants/:tenantId/consent" });
  await app.register(createAuditLogRoutes(stratum), { prefix: "/api/v1/audit-logs" });
  await app.ready();
  return app;
}

describe("input bounds on ABAC and consent routes", () => {
  let app: FastifyInstance;
  let stratum: Stratum;
  const tenantId = SAMPLE_TENANT.id;

  beforeEach(async () => {
    stratum = createMockStratum();
    setupAdminApiKey(stratum);
    Object.assign(stratum, {
      createAbacPolicy: vi.fn().mockRejectedValue(postgresError("integer out of range", "22003")),
      grantConsent: vi
        .fn()
        .mockRejectedValue(postgresError("invalid input syntax for type timestamp with time zone", "22007")),
      queryAuditLogs: vi.fn().mockRejectedValue(postgresError("date/time field value out of range", "22008")),
    });
    app = await buildApp(stratum);
  });

  afterEach(async () => {
    await app.close();
  });

  const postPolicy = (priority: number) =>
    app.inject({
      method: "POST",
      url: `/api/v1/tenants/${tenantId}/abac-policies`,
      headers: authHeaders(),
      payload: { name: "p", resource_type: "document", action: "read", effect: "allow", conditions: [], priority },
    });

  const postConsent = (expires_at: string) =>
    app.inject({
      method: "POST",
      url: `/api/v1/tenants/${tenantId}/consent`,
      headers: authHeaders(),
      payload: { subject_id: "user-1", purpose: "analytics", expires_at },
    });

  it("returns 400 for an ABAC policy priority above the int4 maximum", async () => {
    const response = await postPolicy(3e9);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
    expect(stratum.createAbacPolicy as Mock).not.toHaveBeenCalled();
  });

  it("returns 400 for an ABAC policy priority below the int4 minimum", async () => {
    const response = await postPolicy(-2147483649);
    expect(response.statusCode).toBe(400);
    expect(stratum.createAbacPolicy as Mock).not.toHaveBeenCalled();
  });

  it("returns 400 for a consent expires_at that is not a datetime", async () => {
    const response = await postConsent("not-a-date");
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
    expect(stratum.grantConsent as Mock).not.toHaveBeenCalled();
  });

  it("returns 400 for a consent expires_at of infinity", async () => {
    const response = await postConsent("infinity");
    expect(response.statusCode).toBe(400);
    expect(stratum.grantConsent as Mock).not.toHaveBeenCalled();
  });

  it("returns 400 for a consent expires_at in year 0000", async () => {
    const response = await postConsent("0000-06-01T00:00:00Z");
    expect(response.statusCode).toBe(400);
    expect(stratum.grantConsent as Mock).not.toHaveBeenCalled();
  });

  it("returns 400 for an audit log query bound in year 0000", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/audit-logs?from=0000-06-01T00:00:00Z",
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(400);
    expect(stratum.queryAuditLogs as Mock).not.toHaveBeenCalled();
  });

  it("passes a valid consent expires_at to the service", async () => {
    (stratum.grantConsent as Mock).mockResolvedValue({ id: "c1" });
    const response = await postConsent("2027-01-01T00:00:00Z");
    expect(response.statusCode).toBe(201);
    expect(stratum.grantConsent as Mock).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ expires_at: "2027-01-01T00:00:00Z" }),
      expect.anything(),
    );
  });
});
