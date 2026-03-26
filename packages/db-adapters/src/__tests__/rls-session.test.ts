import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  setTenantContext,
  resetTenantContext,
  getCurrentTenantId,
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
        "SELECT set_config('app.current_tenant_id', $1, false)",
      );
      expect(call[1]).toEqual(["tenant-abc-123"]);
    });

    it("passes the tenant ID as a parameterized value", async () => {
      await setTenantContext(client, "f47ac10b-58cc-4372-a567-0e02b2c3d479");

      const params = (client.query as ReturnType<typeof vi.fn>).mock
        .calls[0][1];
      expect(params).toEqual(["f47ac10b-58cc-4372-a567-0e02b2c3d479"]);
    });

    it("uses session-level scope (third arg false)", async () => {
      await setTenantContext(client, "any-tenant");

      const sql = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
      // The third argument to set_config is `false`, meaning session-level
      // (not transaction-local) so context persists even without a transaction
      expect(sql).toContain("false");
    });
  });

  // -----------------------------------------------------------------------
  // resetTenantContext
  // -----------------------------------------------------------------------

  describe("resetTenantContext", () => {
    it("resets the session variable via set_config with empty string", async () => {
      await resetTenantContext(client);

      const call = (client.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe("SELECT set_config('app.current_tenant_id', '', false)");
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
