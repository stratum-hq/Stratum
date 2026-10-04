import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
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
      (stratum.resolveConfig as Mock).mockResolvedValue(resolvedConfig);

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/tenants/${tenantId}/config`,
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body["feature.dark_mode"].value).toBe(true);
      expect(body["limits.max_users"].value).toBe(100);
      expect(stratum.resolveConfig).toHaveBeenCalledWith(tenantId, {});
    });

    it("returns empty object when tenant has no config", async () => {
      (stratum.resolveConfig as Mock).mockResolvedValue({});

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
      (stratum.setConfig as Mock).mockResolvedValue(configEntry);

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
      (stratum.setConfig as Mock).mockResolvedValue(configEntry);

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

  describe("PUT config passes the sensitive flag only when the request sets it", () => {
    const putConfig = (payload: unknown) =>
      app.inject({
        method: "PUT",
        url: `/api/v1/tenants/${tenantId}/config/api_secret`,
        headers: authHeaders(),
        payload: payload as Record<string, unknown>,
      });

    beforeEach(() => {
      (stratum.setConfig as Mock).mockResolvedValue({ tenant_id: tenantId, key: "api_secret" });
      (stratum.batchSetConfig as Mock).mockResolvedValue({
        results: [{ key: "api_secret", status: "ok" }],
        succeeded: 1,
        failed: 0,
        rolled_back: false,
      });
    });

    it("leaves sensitive out when the request omits it", async () => {
      const response = await putConfig({ value: "v" });
      expect(response.statusCode).toBe(200);
      const input = (stratum.setConfig as Mock).mock.calls[0][2];
      expect(input.sensitive).toBeUndefined();
    });

    it("passes an explicit sensitive: false", async () => {
      await putConfig({ value: "v", sensitive: false });
      expect((stratum.setConfig as Mock).mock.calls[0][2].sensitive).toBe(false);
    });

    it("leaves sensitive out of a batch entry that omits it", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/api/v1/tenants/${tenantId}/config/batch`,
        headers: authHeaders(),
        payload: { entries: [{ key: "api_secret", value: "v" }] },
      });
      expect(response.statusCode).toBe(200);
      const [entry] = (stratum.batchSetConfig as Mock).mock.calls[0][1];
      expect(entry.sensitive).toBeUndefined();
    });
  });

  // ── PUT /api/v1/tenants/:id/config/batch ────────────────────────────

  describe("PUT /api/v1/tenants/:id/config/batch", () => {
    const entryFor = (key: string, value: unknown) => ({
      tenant_id: tenantId,
      key,
      value,
      locked: false,
      sensitive: false,
    });

    function putBatch(entries: unknown[]) {
      return app.inject({
        method: "PUT",
        url: `/api/v1/tenants/${tenantId}/config/batch`,
        headers: authHeaders(),
        payload: { entries },
      });
    }

    it("returns 200 with the per-key result when every entry is written", async () => {
      const batchResult = {
        results: [
          { key: "feature.a", status: "ok", entry: entryFor("feature.a", true) },
          { key: "feature.b", status: "ok", entry: entryFor("feature.b", false) },
        ],
        succeeded: 2,
        failed: 0,
        rolled_back: false,
      };
      (stratum.batchSetConfig as Mock).mockResolvedValue(batchResult);

      const response = await putBatch([
        { key: "feature.a", value: true },
        { key: "feature.b", value: false },
      ]);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(batchResult);
      expect(stratum.batchSetConfig).toHaveBeenCalledOnce();
    });

    it("returns 403 CONFIG_LOCKED with the per-key result when a locked key rolls the batch back", async () => {
      const batchResult = {
        results: [
          { key: "feature.a", status: "error", error: "Not applied: the batch was rolled back because 'feature.b' failed" },
          {
            key: "feature.b",
            status: "error",
            error: "Config 'feature.b' is locked by tenant parent-id and cannot be overridden",
          },
        ],
        succeeded: 0,
        failed: 2,
        rolled_back: true,
      };
      (stratum.batchSetConfig as Mock).mockResolvedValue(batchResult);

      const response = await putBatch([
        { key: "feature.a", value: true },
        { key: "feature.b", value: false },
      ]);

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error.code).toBe("CONFIG_LOCKED");
      expect(body.error.message).toContain("feature.b");
      expect(body.error.details).toEqual(batchResult);
    });

    it("returns 400 VALIDATION_ERROR with the per-key result when the library refuses an entry", async () => {
      const batchResult = {
        results: [
          { key: "feature.a", status: "error", error: "Config 'feature.a' has a value that cannot be stored as JSON" },
        ],
        succeeded: 0,
        failed: 1,
        rolled_back: true,
      };
      (stratum.batchSetConfig as Mock).mockResolvedValue(batchResult);

      const response = await putBatch([{ key: "feature.a", value: 1 }]);

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.details).toMatchObject(batchResult);
      expect(body.error.details.issues).toEqual([
        { path: ["entries", 0], message: "Config 'feature.a' has a value that cannot be stored as JSON", code: "custom" },
      ]);
    });

    it("returns 400 VALIDATION_ERROR for an invalid entry without calling the library", async () => {
      const response = await putBatch([
        { key: "feature.a", value: true },
        { value: 1 },
        { key: "feature.c" },
        { key: "feature.d", value: 1, locked: "yes" },
      ]);

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.details.issues.map((i: { path: unknown[] }) => i.path)).toEqual([
        ["entries", 1, "key"],
        ["entries", 2, "value"],
        ["entries", 3, "locked"],
      ]);
      expect(body.error.details.rolled_back).toBe(true);
      expect(body.error.details.succeeded).toBe(0);
      expect(body.error.details.failed).toBe(4);
      expect(body.error.details.results.map((r: { status: string }) => r.status)).toEqual([
        "error",
        "error",
        "error",
        "error",
      ]);
      expect(stratum.batchSetConfig).not.toHaveBeenCalled();
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
      (stratum.deleteConfig as Mock).mockResolvedValue(undefined);

      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/tenants/${tenantId}/config/feature.dark_mode`,
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe("");
      expect(stratum.deleteConfig).toHaveBeenCalledOnce();
      expect((stratum.deleteConfig as Mock).mock.calls[0][0]).toBe(tenantId);
      expect((stratum.deleteConfig as Mock).mock.calls[0][1]).toBe("feature.dark_mode");
    });
  });

  // ── Locked key error ────────────────────────────────────────────────

  describe("Locked key error", () => {
    it("returns 403 when trying to override a locked config key", async () => {
      const { ConfigLockedError } = await import("@stratum-hq/core");
      (stratum.setConfig as Mock).mockRejectedValue(
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
      (stratum.diffConfig as Mock).mockResolvedValue(diffResult);

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
      expect(stratum.diffConfig).toHaveBeenCalledWith(SAMPLE_TENANT.id, SAMPLE_CHILD_TENANT.id, {});
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
