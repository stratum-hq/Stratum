import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import {
  createMockStratum,
  buildTestApp,
  authHeaders,
  setupAdminApiKey,
  setupWriteApiKey,
  setupReadOnlyApiKey,
} from "./test-helpers.js";
import type { Stratum } from "@stratum-hq/lib";

describe("API Key Routes", () => {
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

  // ── POST /api/v1/api-keys ──────────────────────────────────────────

  describe("POST /api/v1/api-keys", () => {
    it("creates a key and returns plaintext once with 201", async () => {
      const createdKey = {
        id: "key-uuid-1",
        tenant_id: "550e8400-e29b-41d4-a716-446655440000",
        plaintext: "sk_test_abc123def456",
        name: "My API Key",
        created_at: new Date().toISOString(),
      };
      (stratum.createApiKey as any).mockResolvedValue(createdKey);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/api-keys",
        headers: authHeaders(),
        payload: { tenant_id: "550e8400-e29b-41d4-a716-446655440000", name: "My API Key" },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.id).toBe("key-uuid-1");
      expect(body.plaintext).toBe("sk_test_abc123def456");
      expect(stratum.createApiKey).toHaveBeenCalledOnce();
      expect((stratum.createApiKey as any).mock.calls[0][0]).toBe("550e8400-e29b-41d4-a716-446655440000");
    });

    it("returns 400 for missing tenant_id", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/api-keys",
        headers: authHeaders(),
        payload: { name: "No Tenant" },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid tenant_id (not UUID)", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/api-keys",
        headers: authHeaders(),
        payload: { tenant_id: "not-a-uuid", name: "Bad ID" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("creates a key with rate limit options", async () => {
      const createdKey = {
        id: "key-uuid-2",
        tenant_id: "550e8400-e29b-41d4-a716-446655440000",
        plaintext: "sk_test_rate_limited",
        name: "Rate Limited Key",
        created_at: new Date().toISOString(),
      };
      (stratum.createApiKey as any).mockResolvedValue(createdKey);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/api-keys",
        headers: authHeaders(),
        payload: {
          tenant_id: "550e8400-e29b-41d4-a716-446655440000",
          name: "Rate Limited Key",
          rate_limit_max: 500,
          rate_limit_window: "1 minute",
        },
      });

      expect(response.statusCode).toBe(201);
      expect(stratum.createApiKey).toHaveBeenCalledWith("550e8400-e29b-41d4-a716-446655440000", {
        name: "Rate Limited Key",
        rateLimitMax: 500,
        rateLimitWindow: "1 minute",
      });
    });
  });

  // ── GET /api/v1/api-keys ───────────────────────────────────────────

  describe("GET /api/v1/api-keys", () => {
    it("lists keys without plaintext", async () => {
      const keys = [
        {
          id: "key-uuid-1",
          tenant_id: "550e8400-e29b-41d4-a716-446655440000",
          name: "Key 1",
          created_at: new Date().toISOString(),
          last_used_at: null,
          revoked_at: null,
          expires_at: null,
        },
        {
          id: "key-uuid-2",
          tenant_id: "550e8400-e29b-41d4-a716-446655440000",
          name: "Key 2",
          created_at: new Date().toISOString(),
          last_used_at: new Date().toISOString(),
          revoked_at: null,
          expires_at: null,
        },
      ];
      (stratum.listApiKeys as any).mockResolvedValue(keys);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/api-keys",
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveLength(2);
      // Plaintext should never appear in list response
      expect(body[0]).not.toHaveProperty("plaintext");
      expect(body[1]).not.toHaveProperty("plaintext");
      expect(body[0].id).toBe("key-uuid-1");
    });

    it("lists keys filtered by tenant_id query param", async () => {
      (stratum.listApiKeys as any).mockResolvedValue([]);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/api-keys?tenant_id=550e8400-e29b-41d4-a716-446655440000",
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(200);
      // The tenant_id is passed through to listApiKeys
      expect(stratum.listApiKeys).toHaveBeenCalled();
    });
  });

  // ── DELETE /api/v1/api-keys/:id ────────────────────────────────────

  describe("DELETE /api/v1/api-keys/:id", () => {
    it("revokes a key and returns 204", async () => {
      (stratum.revokeApiKey as any).mockResolvedValue(true);

      const response = await app.inject({
        method: "DELETE",
        url: "/api/v1/api-keys/key-uuid-1",
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe("");
      expect(stratum.revokeApiKey).toHaveBeenCalledWith("key-uuid-1");
    });

    it("returns 404 when key does not exist", async () => {
      (stratum.revokeApiKey as any).mockResolvedValue(false);

      const response = await app.inject({
        method: "DELETE",
        url: "/api/v1/api-keys/nonexistent-key",
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  // ── POST /api/v1/api-keys/:id/rotate ──────────────────────────────

  describe("POST /api/v1/api-keys/:id/rotate", () => {
    it("rotates a key and returns new plaintext with 201", async () => {
      const rotatedKey = {
        id: "key-uuid-new",
        tenant_id: "550e8400-e29b-41d4-a716-446655440000",
        plaintext: "sk_test_rotated_xyz789",
        name: "Rotated Key",
        created_at: new Date().toISOString(),
      };
      (stratum.rotateApiKey as any).mockResolvedValue(rotatedKey);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/api-keys/key-uuid-1/rotate",
        headers: authHeaders(),
        payload: {},
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.plaintext).toBe("sk_test_rotated_xyz789");
      expect(stratum.rotateApiKey).toHaveBeenCalledWith("key-uuid-1", undefined);
    });

    it("rotates a key with a new name", async () => {
      const rotatedKey = {
        id: "key-uuid-new",
        tenant_id: "550e8400-e29b-41d4-a716-446655440000",
        plaintext: "sk_test_rotated_abc",
        name: "New Name",
        created_at: new Date().toISOString(),
      };
      (stratum.rotateApiKey as any).mockResolvedValue(rotatedKey);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/api-keys/key-uuid-1/rotate",
        headers: authHeaders(),
        payload: { name: "New Name" },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().name).toBe("New Name");
      expect(stratum.rotateApiKey).toHaveBeenCalledWith("key-uuid-1", "New Name");
    });
  });

  // ── Authorization ───────────────────────────────────────────────────

  describe("Authorization", () => {
    it("api-keys routes require admin scope", async () => {
      setupWriteApiKey(stratum);

      const getResponse = await app.inject({
        method: "GET",
        url: "/api/v1/api-keys",
        headers: authHeaders(),
      });
      expect(getResponse.statusCode).toBe(403);

      const postResponse = await app.inject({
        method: "POST",
        url: "/api/v1/api-keys",
        headers: authHeaders(),
        payload: { tenant_id: "550e8400-e29b-41d4-a716-446655440000" },
      });
      expect(postResponse.statusCode).toBe(403);
    });

    it("read-only key cannot access api-keys routes", async () => {
      setupReadOnlyApiKey(stratum);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/api-keys",
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(403);
    });

    it("returns 401 without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/api-keys",
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
