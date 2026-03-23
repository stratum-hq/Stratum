import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import {
  createMockStratum,
  buildTestApp,
  authHeaders,
  setupAdminApiKey,
  SAMPLE_TENANT,
  SAMPLE_CHILD_TENANT,
} from "./test-helpers.js";
import type { Stratum } from "@stratum-hq/lib";

describe("Config Routes", () => {
  let app: FastifyInstance;
  let stratum: Stratum;
  const tenantId = SAMPLE_TENANT.id;

  beforeEach(async () => {
    stratum = createMockStratum();
    setupAdminApiKey(stratum);
    app = await buildTestApp(stratum);
  });

  afterEach(async () => {
    await app.close();
  });

  // ── GET /api/v1/tenants/:id/config ──────────────────────────────────

  describe("GET /api/v1/tenants/:id/config", () => {
    it("returns resolved config for the tenant", async () => {
      const resolvedConfig = {
        "feature.dark_mode": {
          value: true,
          source_tenant_id: tenantId,
          locked: false,
          sensitive: false,
        },
        "limits.max_users": {
          value: 100,
          source_tenant_id: tenantId,
          locked: false,
          sensitive: false,
        },
      };
      (stratum.resolveConfig as any).mockResolvedValue(resolvedConfig);

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/tenants/${tenantId}/config`,
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body["feature.dark_mode"].value).toBe(true);
      expect(body["limits.max_users"].value).toBe(100);
      expect(stratum.resolveConfig).toHaveBeenCalledWith(tenantId);
    });

    it("returns empty object when tenant has no config", async () => {
      (stratum.resolveConfig as any).mockResolvedValue({});

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/tenants/${tenantId}/config`,
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({});
    });
  });

  // ── PUT /api/v1/tenants/:id/config/:key ─────────────────────────────

  describe("PUT /api/v1/tenants/:id/config/:key", () => {
    it("sets a config value and returns the entry", async () => {
      const configEntry = {
        tenant_id: tenantId,
        key: "feature.dark_mode",
        value: true,
        locked: false,
        sensitive: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      (stratum.setConfig as any).mockResolvedValue(configEntry);

      const response = await app.inject({
        method: "PUT",
        url: `/api/v1/tenants/${tenantId}/config/feature.dark_mode`,
        headers: authHeaders(),
        payload: { value: true },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.key).toBe("feature.dark_mode");
      expect(body.value).toBe(true);
      expect(stratum.setConfig).toHaveBeenCalledOnce();
    });

    it("sets a locked config value", async () => {
      const configEntry = {
        tenant_id: tenantId,
        key: "branding.logo_url",
        value: "https://example.com/logo.png",
        locked: true,
        sensitive: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      (stratum.setConfig as any).mockResolvedValue(configEntry);

      const response = await app.inject({
        method: "PUT",
        url: `/api/v1/tenants/${tenantId}/config/branding.logo_url`,
        headers: authHeaders(),
        payload: { value: "https://example.com/logo.png", locked: true },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().locked).toBe(true);
    });
  });

  // ── PUT /api/v1/tenants/:id/config/batch ────────────────────────────

  describe("PUT /api/v1/tenants/:id/config/batch", () => {
    it("batch sets config with partial success", async () => {
      const batchResult = {
        results: [
          {
            key: "feature.a",
            status: "ok",
            entry: {
              tenant_id: tenantId,
              key: "feature.a",
              value: true,
              locked: false,
              sensitive: false,
            },
          },
          {
            key: "feature.b",
            status: "error",
            error: "CONFIG_LOCKED",
            message: "Config 'feature.b' is locked by tenant parent-id and cannot be overridden",
          },
        ],
        succeeded: 1,
        failed: 1,
      };
      (stratum.batchSetConfig as any).mockResolvedValue(batchResult);

      const response = await app.inject({
        method: "PUT",
        url: `/api/v1/tenants/${tenantId}/config/batch`,
        headers: authHeaders(),
        payload: {
          entries: [
            { key: "feature.a", value: true },
            { key: "feature.b", value: false },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.succeeded).toBe(1);
      expect(body.failed).toBe(1);
      expect(body.results).toHaveLength(2);
      expect(stratum.batchSetConfig).toHaveBeenCalledOnce();
    });

    it("returns 400 for empty entries array", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/api/v1/tenants/${tenantId}/config/batch`,
        headers: authHeaders(),
        payload: { entries: [] },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when entries field is missing", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/api/v1/tenants/${tenantId}/config/batch`,
        headers: authHeaders(),
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ── DELETE /api/v1/tenants/:id/config/:key ──────────────────────────

  describe("DELETE /api/v1/tenants/:id/config/:key", () => {
    it("deletes a config override and returns 204", async () => {
      (stratum.deleteConfig as any).mockResolvedValue(undefined);

      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/tenants/${tenantId}/config/feature.dark_mode`,
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe("");
      expect(stratum.deleteConfig).toHaveBeenCalledOnce();
      expect((stratum.deleteConfig as any).mock.calls[0][0]).toBe(tenantId);
      expect((stratum.deleteConfig as any).mock.calls[0][1]).toBe("feature.dark_mode");
    });
  });

  // ── Locked key error ────────────────────────────────────────────────

  describe("Locked key error", () => {
    it("returns 403 when trying to override a locked config key", async () => {
      const { ConfigLockedError } = await import("@stratum-hq/core");
      (stratum.setConfig as any).mockRejectedValue(
        new ConfigLockedError("feature.locked_key", "parent-tenant-id"),
      );

      const response = await app.inject({
        method: "PUT",
        url: `/api/v1/tenants/${tenantId}/config/feature.locked_key`,
        headers: authHeaders(),
        payload: { value: "anything" },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error.code).toBe("CONFIG_LOCKED");
    });
  });

  // ── GET /api/v1/config/diff ─────────────────────────────────────────

  describe("GET /api/v1/config/diff", () => {
    it("returns diff between two tenants", async () => {
      const diffResult = {
        tenant_a: { id: SAMPLE_TENANT.id, name: SAMPLE_TENANT.name },
        tenant_b: { id: SAMPLE_CHILD_TENANT.id, name: SAMPLE_CHILD_TENANT.name },
        diff: [
          {
            key: "feature.dark_mode",
            tenant_a: { value: true, status: "own", source: SAMPLE_TENANT.id },
            tenant_b: { value: true, status: "inherited", source: SAMPLE_TENANT.id },
          },
          {
            key: "limits.max_users",
            tenant_a: { value: 100, status: "locked", source: SAMPLE_TENANT.id },
            tenant_b: null,
          },
        ],
      };
      (stratum.diffConfig as any).mockResolvedValue(diffResult);

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/config/diff?tenant_a=${SAMPLE_TENANT.id}&tenant_b=${SAMPLE_CHILD_TENANT.id}`,
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.tenant_a.id).toBe(SAMPLE_TENANT.id);
      expect(body.tenant_b.id).toBe(SAMPLE_CHILD_TENANT.id);
      expect(body.diff).toHaveLength(2);
      expect(body.diff[0].key).toBe("feature.dark_mode");
      expect(body.diff[0].tenant_a.status).toBe("own");
      expect(body.diff[0].tenant_b.status).toBe("inherited");
      expect(body.diff[1].tenant_b).toBeNull();
      expect(stratum.diffConfig).toHaveBeenCalledWith(SAMPLE_TENANT.id, SAMPLE_CHILD_TENANT.id);
    });

    it("returns 400 when tenant_a is missing", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/config/diff?tenant_b=${SAMPLE_CHILD_TENANT.id}`,
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when both tenants are the same", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/config/diff?tenant_a=${SAMPLE_TENANT.id}&tenant_b=${SAMPLE_TENANT.id}`,
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
    });
  });
});
