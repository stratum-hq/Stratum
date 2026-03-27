import { describe, it, expect, vi, beforeEach } from "vitest";
import { SequelizeAdapter, withTenantScope } from "../adapters/sequelize.js";
import { BaseAdapter } from "../base-adapter.js";

// ---------------------------------------------------------------------------
// Mock pg
// ---------------------------------------------------------------------------

class MockPool {}

vi.mock("pg", () => {
  return { default: { Pool: MockPool }, Pool: MockPool };
});

// ---------------------------------------------------------------------------
// Mock SequelizeLike factory
// ---------------------------------------------------------------------------

type SequelizeMock = {
  queries: { sql: string; options?: Record<string, unknown> }[];
  query: (sql: string, options?: Record<string, unknown>) => Promise<unknown>;
  transaction: <T>(fn: (t: unknown) => Promise<T>) => Promise<T>;
  addHook: (name: string, fn: (...args: unknown[]) => void | Promise<void>) => void;
};

function createMockSequelize(): SequelizeMock {
  const queries: { sql: string; options?: Record<string, unknown> }[] = [];
  return {
    queries,
    query: async (sql: string, options?: Record<string, unknown>) => {
      queries.push({ sql, options });
      return [[], 0];
    },
    transaction: async <T>(fn: (t: unknown) => Promise<T>) => fn({}),
    addHook: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SequelizeAdapter", () => {
  let pool: MockPool;
  let adapter: SequelizeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    pool = new MockPool();
    adapter = new SequelizeAdapter(pool as any);
  });

  it("extends BaseAdapter", () => {
    expect(adapter).toBeInstanceOf(BaseAdapter);
  });

  describe("withTenantScope (method)", () => {
    it("returns a new wrapped object, not the original instance", () => {
      const mock = createMockSequelize();
      const result = adapter.withTenantScope(mock, () => "tenant-1");
      expect(result).not.toBe(mock);
    });

    it("returned object exposes query, transaction, and addHook", () => {
      const mock = createMockSequelize();
      const result = adapter.withTenantScope(mock, () => "tenant-1");
      expect(typeof result.query).toBe("function");
      expect(typeof result.transaction).toBe("function");
      expect(typeof result.addHook).toBe("function");
    });

    it("wrapped query calls transaction() and sets set_config inside it", async () => {
      const mock = createMockSequelize();
      const transactionSpy = vi.spyOn(mock, "transaction");
      const wrapped = adapter.withTenantScope(mock, () => "tenant-abc");

      await wrapped.query("SELECT 1");

      expect(transactionSpy).toHaveBeenCalledTimes(1);
      expect(mock.queries).toHaveLength(2);
      expect(mock.queries[0].sql).toContain("set_config");
      expect(mock.queries[0].sql).toContain("app.current_tenant_id");
      expect(mock.queries[1].sql).toBe("SELECT 1");
    });

    it("set_config receives tenant ID as bind parameter", async () => {
      const mock = createMockSequelize();
      const wrapped = adapter.withTenantScope(mock, () => "tenant-xyz");

      await wrapped.query("SELECT 1");

      expect(mock.queries[0].options).toMatchObject({ bind: ["tenant-xyz"] });
    });

    it("passes transaction handle to both set_config and the actual query", async () => {
      const fakeT = { id: "fake-transaction" };
      const mock = createMockSequelize();
      mock.transaction = async <T>(fn: (t: unknown) => Promise<T>) => fn(fakeT);

      const wrapped = adapter.withTenantScope(mock, () => "tenant-1");
      await wrapped.query("SELECT 1");

      expect(mock.queries[0].options).toMatchObject({ transaction: fakeT });
      expect(mock.queries[1].options).toMatchObject({ transaction: fakeT });
    });

    it("merges caller-supplied options with transaction handle", async () => {
      const mock = createMockSequelize();
      const wrapped = adapter.withTenantScope(mock, () => "tenant-1");

      await wrapped.query("SELECT 1", { type: "SELECT" });

      // The actual query (index 1) should carry both caller options and transaction
      expect(mock.queries[1].options).toMatchObject({ type: "SELECT" });
      expect(mock.queries[1].options).toHaveProperty("transaction");
    });

    it("reads tenant ID lazily from contextFn on each query call", async () => {
      let currentTenant = "tenant-1";
      const mock = createMockSequelize();
      const wrapped = adapter.withTenantScope(mock, () => currentTenant);

      await wrapped.query("SELECT 1");
      expect(mock.queries[0].options).toMatchObject({ bind: ["tenant-1"] });

      currentTenant = "tenant-2";
      mock.queries.length = 0;
      await wrapped.query("SELECT 2");
      expect(mock.queries[0].options).toMatchObject({ bind: ["tenant-2"] });
    });

    it("skips transaction wrapper when contextFn returns empty string", async () => {
      const mock = createMockSequelize();
      const transactionSpy = vi.spyOn(mock, "transaction");
      const wrapped = adapter.withTenantScope(mock, () => "");

      await wrapped.query("SELECT 1");

      expect(transactionSpy).not.toHaveBeenCalled();
      expect(mock.queries).toHaveLength(1);
      expect(mock.queries[0].sql).toBe("SELECT 1");
    });

    it("propagates errors thrown by set_config", async () => {
      const mock = createMockSequelize();
      mock.transaction = async <T>(fn: (t: unknown) => Promise<T>) => fn({});
      mock.query = vi.fn().mockRejectedValueOnce(new Error("set_config failed"));

      const wrapped = adapter.withTenantScope(mock, () => "tenant-1");

      await expect(wrapped.query("SELECT 1")).rejects.toThrow("set_config failed");
    });

    it("delegates transaction() to the original instance", async () => {
      const mock = createMockSequelize();
      const transactionSpy = vi.spyOn(mock, "transaction");
      const wrapped = adapter.withTenantScope(mock, () => "tenant-1");

      const fn = async (_t: unknown) => "result";
      await wrapped.transaction(fn);

      expect(transactionSpy).toHaveBeenCalledWith(fn);
    });

    it("delegates addHook() to the original instance", () => {
      const mock = createMockSequelize();
      const wrapped = adapter.withTenantScope(mock, () => "tenant-1");
      const hookFn = vi.fn();

      wrapped.addHook("beforeFind", hookFn);

      expect(mock.addHook).toHaveBeenCalledWith("beforeFind", hookFn);
    });
  });
});

describe("withTenantScope (convenience function)", () => {
  it("returns a new wrapped object, not the original instance", () => {
    const mock = createMockSequelize();
    const pool = new MockPool();
    const result = withTenantScope(mock, () => "tenant-1", pool as any);
    expect(result).not.toBe(mock);
  });

  it("wrapped query calls transaction() with set_config", async () => {
    const mock = createMockSequelize();
    const transactionSpy = vi.spyOn(mock, "transaction");
    const pool = new MockPool();
    const wrapped = withTenantScope(mock, () => "fn-tenant", pool as any);

    await wrapped.query("SELECT 1");

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(mock.queries[0].options).toMatchObject({ bind: ["fn-tenant"] });
  });

  it("skips transaction when contextFn returns empty string", async () => {
    const mock = createMockSequelize();
    const transactionSpy = vi.spyOn(mock, "transaction");
    const pool = new MockPool();
    const wrapped = withTenantScope(mock, () => "", pool as any);

    await wrapped.query("SELECT 1");

    expect(transactionSpy).not.toHaveBeenCalled();
    expect(mock.queries).toHaveLength(1);
  });
});
