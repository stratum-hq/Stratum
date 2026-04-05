import { describe, it, expect, vi, beforeEach } from "vitest";
import { DrizzleAdapter, withTenantScope } from "../adapters/drizzle.js";
import type { DrizzleLike } from "../adapters/drizzle.js";
import { BaseAdapter } from "../base-adapter.js";

// ---------------------------------------------------------------------------
// Mock pg
// ---------------------------------------------------------------------------

class MockPool {}

vi.mock("pg", () => {
  return { default: { Pool: MockPool }, Pool: MockPool };
});

// ---------------------------------------------------------------------------
// Mock DrizzleLike factory
// ---------------------------------------------------------------------------

type DrizzleMock = DrizzleLike & {
  executions: { query: unknown }[];
};

function createMockDrizzle(): DrizzleMock {
  const executions: { query: unknown }[] = [];
  return {
    executions,
    execute: async (query: unknown) => {
      executions.push({ query });
      return { rows: [] };
    },
    transaction: async <T>(fn: (tx: DrizzleLike) => Promise<T>) => {
      // Create a nested mock for the transaction context that shares the
      // executions array so tests can inspect what ran inside the tx.
      const txMock: DrizzleLike = {
        execute: async (query: unknown) => {
          executions.push({ query });
          return { rows: [] };
        },
        transaction: async <U>(innerFn: (innerTx: DrizzleLike) => Promise<U>) => innerFn(txMock),
      };
      return fn(txMock);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DrizzleAdapter", () => {
  let pool: MockPool;
  let adapter: DrizzleAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    pool = new MockPool();
    adapter = new DrizzleAdapter(pool as any);
  });

  it("extends BaseAdapter", () => {
    expect(adapter).toBeInstanceOf(BaseAdapter);
  });

  describe("withTenantScope (method)", () => {
    it("returns a new wrapped object, not the original instance", () => {
      const mock = createMockDrizzle();
      const result = adapter.withTenantScope(mock, () => "tenant-1");
      expect(result).not.toBe(mock);
    });

    it("returned object exposes execute and transaction", () => {
      const mock = createMockDrizzle();
      const result = adapter.withTenantScope(mock, () => "tenant-1");
      expect(typeof result.execute).toBe("function");
      expect(typeof result.transaction).toBe("function");
    });

    it("wrapped execute calls transaction() and sets set_config inside it", async () => {
      const mock = createMockDrizzle();
      const transactionSpy = vi.spyOn(mock, "transaction");
      const wrapped = adapter.withTenantScope(mock, () => "tenant-abc");

      await wrapped.execute({ sql: "SELECT 1" });

      expect(transactionSpy).toHaveBeenCalledTimes(1);
      expect(mock.executions).toHaveLength(2);
      expect((mock.executions[0].query as any).sql).toContain("set_config");
      expect((mock.executions[0].query as any).sql).toContain("app.current_tenant_id");
      expect((mock.executions[1].query as any).sql).toBe("SELECT 1");
    });

    it("set_config receives tenant ID as params", async () => {
      const mock = createMockDrizzle();
      const wrapped = adapter.withTenantScope(mock, () => "tenant-xyz");

      await wrapped.execute({ sql: "SELECT 1" });

      expect((mock.executions[0].query as any).params).toEqual(["tenant-xyz"]);
    });

    it("wrapped transaction injects set_config before user callback", async () => {
      const mock = createMockDrizzle();
      const transactionSpy = vi.spyOn(mock, "transaction");
      const wrapped = adapter.withTenantScope(mock, () => "tenant-abc");

      await wrapped.transaction(async (tx) => {
        await tx.execute({ sql: "INSERT INTO foo VALUES (1)" });
      });

      expect(transactionSpy).toHaveBeenCalledTimes(1);
      expect(mock.executions).toHaveLength(2);
      expect((mock.executions[0].query as any).sql).toContain("set_config");
      expect((mock.executions[1].query as any).sql).toBe("INSERT INTO foo VALUES (1)");
    });

    it("reads tenant ID lazily from contextFn on each call", async () => {
      let currentTenant = "tenant-1";
      const mock = createMockDrizzle();
      const wrapped = adapter.withTenantScope(mock, () => currentTenant);

      await wrapped.execute({ sql: "SELECT 1" });
      expect((mock.executions[0].query as any).params).toEqual(["tenant-1"]);

      currentTenant = "tenant-2";
      mock.executions.length = 0;
      await wrapped.execute({ sql: "SELECT 2" });
      expect((mock.executions[0].query as any).params).toEqual(["tenant-2"]);
    });

    it("throws when contextFn returns empty string (execute)", async () => {
      const mock = createMockDrizzle();
      const wrapped = adapter.withTenantScope(mock, () => "");

      await expect(wrapped.execute({ sql: "SELECT 1" })).rejects.toThrow(
        "Tenant context is required for database operations.",
      );
    });

    it("throws when contextFn returns empty string (transaction)", async () => {
      const mock = createMockDrizzle();
      const wrapped = adapter.withTenantScope(mock, () => "");

      await expect(
        wrapped.transaction(async (tx) => {
          await tx.execute({ sql: "SELECT 1" });
        }),
      ).rejects.toThrow("Tenant context is required for database operations.");
    });

    it("propagates errors thrown by set_config (execute path)", async () => {
      const mock = createMockDrizzle();
      // Override transaction to use a tx whose execute throws
      mock.transaction = async <T>(fn: (tx: DrizzleLike) => Promise<T>) => {
        const failTx: DrizzleLike = {
          execute: vi.fn().mockRejectedValueOnce(new Error("set_config failed")),
          transaction: async <U>(innerFn: (innerTx: DrizzleLike) => Promise<U>) => innerFn(failTx),
        };
        return fn(failTx);
      };

      const wrapped = adapter.withTenantScope(mock, () => "tenant-1");

      await expect(wrapped.execute({ sql: "SELECT 1" })).rejects.toThrow("set_config failed");
    });

    it("propagates errors thrown by set_config (transaction path)", async () => {
      const mock = createMockDrizzle();
      mock.transaction = async <T>(fn: (tx: DrizzleLike) => Promise<T>) => {
        const failTx: DrizzleLike = {
          execute: vi.fn().mockRejectedValueOnce(new Error("set_config failed")),
          transaction: async <U>(innerFn: (innerTx: DrizzleLike) => Promise<U>) => innerFn(failTx),
        };
        return fn(failTx);
      };

      const wrapped = adapter.withTenantScope(mock, () => "tenant-1");

      await expect(
        wrapped.transaction(async (tx) => {
          await tx.execute({ sql: "SELECT 1" });
        }),
      ).rejects.toThrow("set_config failed");
    });

    it("throws when execute() called with no tenant", async () => {
      const mock = createMockDrizzle();
      const wrapped = adapter.withTenantScope(mock, () => "");

      const query = { sql: "SELECT 1" };
      await expect(wrapped.execute(query)).rejects.toThrow(
        "Tenant context is required for database operations.",
      );
    });
  });
});

describe("withTenantScope (convenience function)", () => {
  it("returns a new wrapped object, not the original instance", () => {
    const mock = createMockDrizzle();
    const pool = new MockPool();
    const result = withTenantScope(mock, () => "tenant-1", pool as any);
    expect(result).not.toBe(mock);
  });

  it("wrapped execute calls transaction() with set_config", async () => {
    const mock = createMockDrizzle();
    const transactionSpy = vi.spyOn(mock, "transaction");
    const pool = new MockPool();
    const wrapped = withTenantScope(mock, () => "fn-tenant", pool as any);

    await wrapped.execute({ sql: "SELECT 1" });

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect((mock.executions[0].query as any).params).toEqual(["fn-tenant"]);
  });

  it("throws when contextFn returns empty string", async () => {
    const mock = createMockDrizzle();
    const pool = new MockPool();
    const wrapped = withTenantScope(mock, () => "", pool as any);

    await expect(wrapped.execute({ sql: "SELECT 1" })).rejects.toThrow(
      "Tenant context is required for database operations.",
    );
  });
});
