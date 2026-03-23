import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import {
  createMockStratum,
  buildTestApp,
  authHeaders,
  setupAdminApiKey,
  setupReadOnlyApiKey,
  SAMPLE_TENANT,
  SAMPLE_CHILD_TENANT,
} from "./test-helpers.js";
import type { Stratum } from "@stratum-hq/lib";

describe("Tenant Routes", () => {
  let app: FastifyInstance;
  let stratum: Stratum;

  beforeEach(async () => {
    stratum = createMockStratum();
    setupAdminApiKey(stratum);
    app = await buildTestApp(stratum);
  });

  afterEach(async () => {
    await app.close();
  });

  // ── POST /api/v1/tenants ────────────────────────────────────────────

  describe("POST /api/v1/tenants", () => {
    it("creates a tenant and returns 201", async () => {
      const input = { slug: "acme_corp", name: "Acme Corp" };
      (stratum.createTenant as any).mockResolvedValue(SAMPLE_TENANT);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/tenants",
        headers: authHeaders(),
        payload: input,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.id).toBe(SAMPLE_TENANT.id);
      expect(body.slug).toBe("acme_corp");
      expect(stratum.createTenant).toHaveBeenCalledOnce();
      expect((stratum.createTenant as any).mock.calls[0][0]).toMatchObject({ slug: "acme_corp" });
    });

    it("returns 400 for invalid input (missing slug)", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/tenants",
        headers: authHeaders(),
        payload: { name: "No Slug" },
      });

      // Zod validation triggers 400
      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // ── POST /api/v1/tenants/batch ──────────────────────────────────────

  describe("POST /api/v1/tenants/batch", () => {
    it("batch creates tenants and returns 201", async () => {
      const batchResult = {
        created: [SAMPLE_TENANT, SAMPLE_CHILD_TENANT],
        errors: [],
      };
      (stratum.batchCreateTenants as any).mockResolvedValue(batchResult);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/tenants/batch",
        headers: authHeaders(),
        payload: {
          tenants: [
            { slug: "acme_corp", name: "Acme Corp" },
            { slug: "acme_division", name: "Acme Division", parent_id: SAMPLE_TENANT.id },
          ],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.created).toHaveLength(2);
      expect(stratum.batchCreateTenants).toHaveBeenCalledOnce();
    });

    it("returns 400 when tenants array is empty", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/tenants/batch",
        headers: authHeaders(),
        payload: { tenants: [] },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when tenants field is missing", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/tenants/batch",
        headers: authHeaders(),
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ── GET /api/v1/tenants/:id ─────────────────────────────────────────

  describe("GET /api/v1/tenants/:id", () => {
    it("returns the tenant", async () => {
      (stratum.getTenant as any).mockResolvedValue(SAMPLE_TENANT);

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/tenants/${SAMPLE_TENANT.id}`,
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(SAMPLE_TENANT.id);
      expect(body.slug).toBe("acme_corp");
    });

    it("returns 404 when tenant does not exist", async () => {
      const { StratumError, ErrorCode } = await import("@stratum-hq/core");
      (stratum.getTenant as any).mockRejectedValue(
        new StratumError(ErrorCode.TENANT_NOT_FOUND, "Tenant not found", 404),
      );

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/tenants/nonexistent-id",
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe("TENANT_NOT_FOUND");
    });
  });

  // ── PATCH /api/v1/tenants/:id ───────────────────────────────────────

  describe("PATCH /api/v1/tenants/:id", () => {
    it("updates a tenant and returns 200", async () => {
      const updatedTenant = { ...SAMPLE_TENANT, name: "Acme Corp Updated" };
      (stratum.updateTenant as any).mockResolvedValue(updatedTenant);

      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/tenants/${SAMPLE_TENANT.id}`,
        headers: authHeaders(),
        payload: { name: "Acme Corp Updated" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe("Acme Corp Updated");
      expect(stratum.updateTenant).toHaveBeenCalledOnce();
    });
  });

  // ── DELETE /api/v1/tenants/:id ──────────────────────────────────────

  describe("DELETE /api/v1/tenants/:id", () => {
    it("soft deletes and returns 204", async () => {
      (stratum.deleteTenant as any).mockResolvedValue(undefined);

      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/tenants/${SAMPLE_TENANT.id}`,
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe("");
      expect(stratum.deleteTenant).toHaveBeenCalledOnce();
      expect((stratum.deleteTenant as any).mock.calls[0][0]).toBe(SAMPLE_TENANT.id);
    });
  });

  // ── GET /api/v1/tenants/:id/descendants ─────────────────────────────

  describe("GET /api/v1/tenants/:id/descendants", () => {
    it("returns the tenant subtree", async () => {
      const descendants = [SAMPLE_CHILD_TENANT];
      (stratum.getDescendants as any).mockResolvedValue(descendants);

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/tenants/${SAMPLE_TENANT.id}/descendants`,
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe(SAMPLE_CHILD_TENANT.id);
      expect(stratum.getDescendants).toHaveBeenCalledWith(SAMPLE_TENANT.id);
    });
  });

  // ── Authentication required ─────────────────────────────────────────

  describe("Authentication required", () => {
    it("returns 401 without an API key or Bearer token", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/tenants/${SAMPLE_TENANT.id}`,
        // No auth headers
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("returns 401 with an invalid API key", async () => {
      (stratum.validateApiKey as any).mockResolvedValue(null);

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/tenants/${SAMPLE_TENANT.id}`,
        headers: { "x-api-key": "sk_test_invalid" },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ── Authorization ───────────────────────────────────────────────────

  describe("Authorization", () => {
    it("read-scope key cannot POST (write endpoint)", async () => {
      setupReadOnlyApiKey(stratum);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/tenants",
        headers: authHeaders(),
        payload: { slug: "test_tenant", name: "Test" },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });

    it("read-scope key can GET (read endpoint)", async () => {
      setupReadOnlyApiKey(stratum);
      (stratum.getTenant as any).mockResolvedValue(SAMPLE_TENANT);

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/tenants/${SAMPLE_TENANT.id}`,
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
