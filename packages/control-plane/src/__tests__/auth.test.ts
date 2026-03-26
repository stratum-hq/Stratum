import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import {
  createMockStratum,
  buildTestApp,
  authHeaders,
  jwtHeaders,
  setupAdminApiKey,
  setupReadOnlyApiKey,
  setupWriteApiKey,
  SAMPLE_TENANT,
  TEST_JWT_SECRET,
} from "./test-helpers.js";
import type { Stratum } from "@stratum-hq/lib";

describe("Auth Middleware", () => {
  let app: FastifyInstance;
  let stratum: Stratum;

  beforeEach(async () => {
    stratum = createMockStratum();
    app = await buildTestApp(stratum);
  });

  afterEach(async () => {
    await app.close();
  });

  // ── API Key Authentication ──────────────────────────────────────────

  describe("API Key Authentication", () => {
    it("valid API key authenticates successfully", async () => {
      setupAdminApiKey(stratum);
      (stratum.getTenant as any).mockResolvedValue(SAMPLE_TENANT);

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/tenants/${SAMPLE_TENANT.id}`,
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(200);
      expect(stratum.validateApiKey).toHaveBeenCalledWith("sk_test_valid_key");
    });

    it("invalid API key returns 401", async () => {
      (stratum.validateApiKey as any).mockResolvedValue(null);

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/tenants/${SAMPLE_TENANT.id}`,
        headers: { "x-api-key": "sk_test_bad_key" },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.message).toContain("Invalid or revoked");
    });

    it("expired API key returns 401 (validateApiKey returns null)", async () => {
      // An expired key causes validateApiKey to return null
      (stratum.validateApiKey as any).mockResolvedValue(null);

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/tenants/${SAMPLE_TENANT.id}`,
        headers: { "x-api-key": "sk_test_expired_key" },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ── JWT Authentication ──────────────────────────────────────────────

  describe("JWT Authentication", () => {
    it("valid JWT authenticates successfully", async () => {
      (stratum.getTenant as any).mockResolvedValue(SAMPLE_TENANT);

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/tenants/${SAMPLE_TENANT.id}`,
        headers: jwtHeaders({ scopes: ["read", "write", "admin"] }),
      });

      expect(response.statusCode).toBe(200);
      // validateApiKey should NOT be called for JWT auth
      expect(stratum.validateApiKey).not.toHaveBeenCalled();
    });

    it("invalid JWT returns 401", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/tenants/${SAMPLE_TENANT.id}`,
        headers: { authorization: "Bearer invalid.token.here" },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.message).toContain("Invalid or expired");
    });

    it("expired JWT returns 401", async () => {
      const expiredToken = jwt.sign(
        { sub: "test-user", scopes: ["read"] },
        TEST_JWT_SECRET,
        { algorithm: "HS256", expiresIn: "-1h" },
      );

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/tenants/${SAMPLE_TENANT.id}`,
        headers: { authorization: `Bearer ${expiredToken}` },
      });

      expect(response.statusCode).toBe(401);
    });

    it("JWT signed with wrong secret returns 401", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/tenants/${SAMPLE_TENANT.id}`,
        headers: jwtHeaders({}, "wrong-secret-key"),
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ── No Auth ─────────────────────────────────────────────────────────

  describe("No Auth", () => {
    it("returns 401 when no auth header is provided", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/tenants/${SAMPLE_TENANT.id}`,
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.message).toContain("Authentication required");
    });
  });

  // ── Exempt endpoints ────────────────────────────────────────────────

  describe("Exempt endpoints", () => {
    it("health endpoint skips auth", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/health",
      });

      // Health endpoint tries to query the DB, which will fail in test,
      // but it should NOT return 401
      expect(response.statusCode).not.toBe(401);
      // The response should be 200 (health route handles db errors gracefully)
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe("ok");
    });

    it("swagger docs endpoint skips auth", async () => {
      // We don't register swagger in tests, so the route won't exist,
      // but the auth middleware should NOT fire for /api/docs paths.
      // We can verify by testing that a 404 is returned (not a 401).
      const response = await app.inject({
        method: "GET",
        url: "/api/docs/json",
      });

      // Should be 404 (not registered in test app) rather than 401
      expect(response.statusCode).not.toBe(401);
    });
  });

  // ── Authorization scope enforcement ─────────────────────────────────

  describe("Scope enforcement", () => {
    it("read-scope key cannot access write endpoints", async () => {
      setupReadOnlyApiKey(stratum);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/tenants",
        headers: authHeaders(),
        payload: { slug: "test", name: "Test" },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("FORBIDDEN");
    });

    it("read-scope key cannot DELETE", async () => {
      setupReadOnlyApiKey(stratum);

      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/tenants/${SAMPLE_TENANT.id}`,
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(403);
    });

    it("read-scope key cannot PATCH", async () => {
      setupReadOnlyApiKey(stratum);

      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/tenants/${SAMPLE_TENANT.id}`,
        headers: authHeaders(),
        payload: { name: "Updated" },
      });

      expect(response.statusCode).toBe(403);
    });

    it("admin-scope key can access all endpoints", async () => {
      setupAdminApiKey(stratum);
      (stratum.createTenant as any).mockResolvedValue(SAMPLE_TENANT);
      (stratum.getTenant as any).mockResolvedValue(SAMPLE_TENANT);
      (stratum.listApiKeys as any).mockResolvedValue([]);

      // Test write endpoint
      const postResponse = await app.inject({
        method: "POST",
        url: "/api/v1/tenants",
        headers: authHeaders(),
        payload: { slug: "test", name: "Test" },
      });
      expect(postResponse.statusCode).toBe(201);

      // Test read endpoint
      const getResponse = await app.inject({
        method: "GET",
        url: `/api/v1/tenants/${SAMPLE_TENANT.id}`,
        headers: authHeaders(),
      });
      expect(getResponse.statusCode).toBe(200);

      // Test admin-only endpoint (api-keys)
      const adminResponse = await app.inject({
        method: "GET",
        url: "/api/v1/api-keys",
        headers: authHeaders(),
      });
      expect(adminResponse.statusCode).toBe(200);
    });

    it("write-scope key cannot access admin-only endpoints (api-keys)", async () => {
      setupWriteApiKey(stratum);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/api-keys",
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("FORBIDDEN");
    });

    it("JWT with read-only scopes cannot POST", async () => {
      (stratum.getTenant as any).mockResolvedValue(SAMPLE_TENANT);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/tenants",
        headers: jwtHeaders({ scopes: ["read"] }),
        payload: { slug: "test", name: "Test" },
      });

      expect(response.statusCode).toBe(403);
    });

    it("JWT with admin scopes can access admin-only endpoints", async () => {
      (stratum.getTenant as any).mockResolvedValue(SAMPLE_TENANT);
      (stratum.listApiKeys as any).mockResolvedValue([]);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/api-keys",
        headers: jwtHeaders({ scopes: ["read", "write", "admin"] }),
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
