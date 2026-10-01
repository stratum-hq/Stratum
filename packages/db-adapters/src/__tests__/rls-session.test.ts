import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  setTenantContext,
  resetTenantContext,
  withTenantContext,
  getCurrentTenantId,
  type TenantScope,
} from "../rls/session.js";

// ---------------------------------------------------------------------------
// Mock pg.PoolClient
// ---------------------------------------------------------------------------

function makeMockClient() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  } as unknown as import("pg").PoolClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RLS Session", () => {
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    client = makeMockClient();
  });

  // -----------------------------------------------------------------------
  // setTenantContext
  // -----------------------------------------------------------------------

  describe("setTenantContext", () => {
    it("sets the correct session variable via set_config", async () => {
      await setTenantContext(client, "tenant-abc-123");

      const call = (client.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe(
        "SELECT set_config('app.current_tenant_id', $1, true), set_config('app.tenant_scope', $2, true)",
      );
      expect(call[1]).toEqual(["tenant-abc-123", ""]);
    });

    it("passes the tenant ID as a parameterized value", async () => {
      await setTenantContext(client, "f47ac10b-58cc-4372-a567-0e02b2c3d479");

      const params = (client.query as ReturnType<typeof vi.fn>).mock
        .calls[0][1];
      expect(params[0]).toBe("f47ac10b-58cc-4372-a567-0e02b2c3d479");
    });

    it("uses transaction-scoped scope (third arg true)", async () => {
      await setTenantContext(client, "any-tenant");

      const sql = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
      // The third argument to set_config is `true`, meaning transaction-scoped
      // so context is automatically cleared when the transaction ends
      expect(sql).toContain("true");
    });

    it("sets app.tenant_scope to 'subtree' for the subtree scope", async () => {
      await setTenantContext(client, "tenant-1", { scope: "subtree" });

      const call = (client.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toEqual(["tenant-1", "subtree"]);
    });

    it("clears app.tenant_scope for the exact scope", async () => {
      await setTenantContext(client, "tenant-1", { scope: "exact" });

      const call = (client.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toEqual(["tenant-1", ""]);
    });

    it("rejects an unknown scope without a query", async () => {
      await expect(
        setTenantContext(client, "tenant-1", { scope: "SUBTREE" as TenantScope }),
      ).rejects.toThrow(/Unknown tenant scope/);
      expect((client.query as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });
  });

  describe("withTenantContext", () => {
    it("rejects an unknown scope before it takes a connection", async () => {
      const pool = { connect: vi.fn() } as unknown as import("pg").Pool;
      await expect(
        withTenantContext(pool, "tenant-1", async () => 1, { scope: "all" as TenantScope }),
      ).rejects.toThrow(/Unknown tenant scope/);
      expect((pool.connect as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // resetTenantContext
  // -----------------------------------------------------------------------

  describe("resetTenantContext", () => {
    it("resets the session variable via set_config with empty string", async () => {
      await resetTenantContext(client);

      const call = (client.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe(
        "SELECT set_config('app.current_tenant_id', '', true), set_config('app.tenant_scope', '', true)",
      );
    });
  });

  // -----------------------------------------------------------------------
  // getCurrentTenantId
  // -----------------------------------------------------------------------

  describe("getCurrentTenantId", () => {
    it("reads the session variable via current_setting", async () => {
      (client.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ current_setting: "tenant-xyz" }],
      });

      await getCurrentTenantId(client);

      const sql = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(sql).toContain("current_setting('app.current_tenant_id'");
    });

    it("returns the tenant ID when set", async () => {
      (client.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ current_setting: "tenant-xyz" }],
      });

      const result = await getCurrentTenantId(client);
      expect(result).toBe("tenant-xyz");
    });

    it("returns null when the setting is empty string", async () => {
      (client.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ current_setting: "" }],
      });

      const result = await getCurrentTenantId(client);
      expect(result).toBeNull();
    });

    it("returns null when rows are empty", async () => {
      (client.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
      });

      const result = await getCurrentTenantId(client);
      expect(result).toBeNull();
    });

    it("returns null when current_setting is null", async () => {
      (client.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ current_setting: null }],
      });

      const result = await getCurrentTenantId(client);
      expect(result).toBeNull();
    });
  });
});
