import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createPolicy,
  dropPolicy,
  enableRLS,
  disableRLS,
  isRLSEnabled,
} from "../rls/manager.js";

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

describe("RLS Manager", () => {
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    client = makeMockClient();
  });

  // -----------------------------------------------------------------------
  // Table name validation
  // -----------------------------------------------------------------------

  describe("table name validation", () => {
    it("rejects names containing SQL injection attempts", async () => {
      await expect(createPolicy(client, "users; DROP TABLE")).rejects.toThrow(
        "Invalid table name",
      );
      await expect(dropPolicy(client, "users; DROP TABLE")).rejects.toThrow(
        "Invalid table name",
      );
      await expect(enableRLS(client, "users; DROP TABLE")).rejects.toThrow(
        "Invalid table name",
      );
      await expect(disableRLS(client, "users; DROP TABLE")).rejects.toThrow(
        "Invalid table name",
      );
    });

    it("rejects names with spaces", async () => {
      await expect(createPolicy(client, "my table")).rejects.toThrow(
        "Invalid table name",
      );
    });

    it("rejects names starting with a digit", async () => {
      await expect(createPolicy(client, "1users")).rejects.toThrow(
        "Invalid table name",
      );
    });

    it("rejects names with hyphens", async () => {
      await expect(createPolicy(client, "my-table")).rejects.toThrow(
        "Invalid table name",
      );
    });

    it("rejects names with parentheses", async () => {
      await expect(createPolicy(client, "users()")).rejects.toThrow(
        "Invalid table name",
      );
    });

    it("rejects empty string", async () => {
      await expect(createPolicy(client, "")).rejects.toThrow(
        "Invalid table name",
      );
    });

    it("accepts simple alphanumeric names", async () => {
      (client.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ count: "0" }],
      });
      await expect(createPolicy(client, "users")).resolves.toBeUndefined();
    });

    it("accepts names with underscores", async () => {
      (client.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ count: "0" }],
      });
      await expect(
        createPolicy(client, "tenant_data"),
      ).resolves.toBeUndefined();
    });

    it("accepts names starting with underscore", async () => {
      (client.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ count: "0" }],
      });
      await expect(createPolicy(client, "_internal")).resolves.toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // createPolicy
  // -----------------------------------------------------------------------

  describe("createPolicy", () => {
    it("checks for existing policy before creating", async () => {
      (client.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ count: "0" }],
      });

      await createPolicy(client, "orders");

      const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(2);

      // First call: check pg_policies
      expect(calls[0][0]).toContain("pg_policies");
      expect(calls[0][0]).toContain("tenant_isolation");
      expect(calls[0][1]).toEqual(["orders"]);

      // Second call: CREATE POLICY
      expect(calls[1][0]).toContain("CREATE POLICY tenant_isolation ON orders");
      expect(calls[1][0]).toContain("current_setting('app.current_tenant_id')");
    });

    it("skips creation when policy already exists", async () => {
      (client.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ count: "1" }],
      });

      await createPolicy(client, "orders");

      const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls;
      // Only the SELECT check, no CREATE POLICY
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toContain("pg_policies");
    });

    it("uses the validated table name in the SQL", async () => {
      (client.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ count: "0" }],
      });

      await createPolicy(client, "user_accounts");

      const createCall = (client.query as ReturnType<typeof vi.fn>).mock
        .calls[1][0];
      expect(createCall).toContain("ON user_accounts USING");
    });
  });

  // -----------------------------------------------------------------------
  // dropPolicy
  // -----------------------------------------------------------------------

  describe("dropPolicy", () => {
    it("generates correct DROP POLICY SQL", async () => {
      await dropPolicy(client, "orders");

      const call = (client.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe(
        "DROP POLICY IF EXISTS tenant_isolation ON orders",
      );
    });

    it("uses the validated table name", async () => {
      await dropPolicy(client, "tenant_invoices");

      const sql = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(sql).toContain("ON tenant_invoices");
    });
  });

  // -----------------------------------------------------------------------
  // enableRLS
  // -----------------------------------------------------------------------

  describe("enableRLS", () => {
    it("generates correct ALTER TABLE statements", async () => {
      await enableRLS(client, "products");

      const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][0]).toBe(
        "ALTER TABLE products ENABLE ROW LEVEL SECURITY",
      );
      expect(calls[1][0]).toBe(
        "ALTER TABLE products FORCE ROW LEVEL SECURITY",
      );
    });
  });

  // -----------------------------------------------------------------------
  // disableRLS
  // -----------------------------------------------------------------------

  describe("disableRLS", () => {
    it("generates correct ALTER TABLE statements for disabling", async () => {
      await disableRLS(client, "products");

      const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][0]).toBe(
        "ALTER TABLE products NO FORCE ROW LEVEL SECURITY",
      );
      expect(calls[1][0]).toBe(
        "ALTER TABLE products DISABLE ROW LEVEL SECURITY",
      );
    });
  });

  // -----------------------------------------------------------------------
  // isRLSEnabled
  // -----------------------------------------------------------------------

  describe("isRLSEnabled", () => {
    it("queries pg_class with the table name as a parameter", async () => {
      (client.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ relrowsecurity: true }],
      });

      await isRLSEnabled(client, "orders");

      const call = (client.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain("pg_class");
      expect(call[0]).toContain("relrowsecurity");
      expect(call[1]).toEqual(["orders"]);
    });

    it("returns true when RLS is enabled", async () => {
      (client.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ relrowsecurity: true }],
      });

      const result = await isRLSEnabled(client, "orders");
      expect(result).toBe(true);
    });

    it("returns false when RLS is disabled", async () => {
      (client.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ relrowsecurity: false }],
      });

      const result = await isRLSEnabled(client, "orders");
      expect(result).toBe(false);
    });

    it("returns false when table does not exist (no rows)", async () => {
      (client.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
      });

      const result = await isRLSEnabled(client, "nonexistent");
      expect(result).toBe(false);
    });
  });
});
