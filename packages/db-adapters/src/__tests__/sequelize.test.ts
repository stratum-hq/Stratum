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
  hooks: Map<string, ((...args: unknown[]) => void | Promise<void>)[]>;
  queries: string[];
  query: (sql: string, options?: Record<string, unknown>) => Promise<unknown>;
  transaction: <T>(fn: (t: unknown) => Promise<T>) => Promise<T>;
  addHook: (name: string, fn: (...args: unknown[]) => void | Promise<void>) => void;
};

function createMockSequelize(): SequelizeMock {
  const hooks = new Map<string, ((...args: unknown[]) => void | Promise<void>)[]>();
  const queries: string[] = [];
  return {
    hooks,
    queries,
    query: async (sql: string) => {
      queries.push(sql);
      return [[], 0];
    },
    transaction: async <T>(fn: (t: unknown) => Promise<T>) => fn({}),
    addHook: (name: string, fn: (...args: unknown[]) => void | Promise<void>) => {
      if (!hooks.has(name)) hooks.set(name, []);
      hooks.get(name)!.push(fn);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const EXPECTED_HOOKS = [
  "beforeFind",
  "beforeCreate",
  "beforeUpdate",
  "beforeDestroy",
  "beforeBulkCreate",
  "beforeBulkUpdate",
  "beforeBulkDestroy",
];

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
    it("returns the same sequelize instance", () => {
      const mock = createMockSequelize();
      const result = adapter.withTenantScope(mock, () => "tenant-1");
      expect(result).toBe(mock);
    });

    it("registers hooks for all expected lifecycle events", () => {
      const mock = createMockSequelize();
      adapter.withTenantScope(mock, () => "tenant-1");

      for (const hookName of EXPECTED_HOOKS) {
        expect(mock.hooks.has(hookName)).toBe(true);
        expect(mock.hooks.get(hookName)!.length).toBe(1);
      }
    });

    it("registers exactly the expected hooks — no extras", () => {
      const mock = createMockSequelize();
      adapter.withTenantScope(mock, () => "tenant-1");
      expect([...mock.hooks.keys()].sort()).toEqual([...EXPECTED_HOOKS].sort());
    });

    it("hook calls set_config with tenant ID from contextFn", async () => {
      const mock = createMockSequelize();
      adapter.withTenantScope(mock, () => "tenant-abc");

      // Trigger the beforeFind hook
      const [hookFn] = mock.hooks.get("beforeFind")!;
      await hookFn();

      expect(mock.queries).toHaveLength(1);
      expect(mock.queries[0]).toContain("set_config");
      expect(mock.queries[0]).toContain("app.current_tenant_id");
    });

    it("hook passes tenant ID as bind parameter", async () => {
      const querySpy = vi.fn().mockResolvedValue([[], 0]);
      const mock = createMockSequelize();
      mock.query = querySpy;

      adapter.withTenantScope(mock, () => "tenant-xyz");

      const [hookFn] = mock.hooks.get("beforeCreate")!;
      await hookFn();

      expect(querySpy).toHaveBeenCalledWith(
        `SELECT set_config('app.current_tenant_id', $1, true)`,
        { bind: ["tenant-xyz"] },
      );
    });

    it("hook reads tenant ID lazily from contextFn each time", async () => {
      let currentTenant = "tenant-1";
      const mock = createMockSequelize();
      const querySpy = vi.fn().mockResolvedValue([[], 0]);
      mock.query = querySpy;

      adapter.withTenantScope(mock, () => currentTenant);

      const [hookFn] = mock.hooks.get("beforeUpdate")!;

      await hookFn();
      expect(querySpy).toHaveBeenLastCalledWith(
        expect.any(String),
        { bind: ["tenant-1"] },
      );

      currentTenant = "tenant-2";
      await hookFn();
      expect(querySpy).toHaveBeenLastCalledWith(
        expect.any(String),
        { bind: ["tenant-2"] },
      );
    });

    it("hook does NOT call set_config when contextFn returns empty string", async () => {
      const mock = createMockSequelize();
      adapter.withTenantScope(mock, () => "");

      const [hookFn] = mock.hooks.get("beforeFind")!;
      await hookFn();

      expect(mock.queries).toHaveLength(0);
    });

    it("all registered hooks share the same behavior", async () => {
      const mock = createMockSequelize();
      const querySpy = vi.fn().mockResolvedValue([[], 0]);
      mock.query = querySpy;

      adapter.withTenantScope(mock, () => "shared-tenant");

      for (const hookName of EXPECTED_HOOKS) {
        querySpy.mockClear();
        const [hookFn] = mock.hooks.get(hookName)!;
        await hookFn();
        expect(querySpy).toHaveBeenCalledTimes(1);
        expect(querySpy).toHaveBeenCalledWith(
          `SELECT set_config('app.current_tenant_id', $1, true)`,
          { bind: ["shared-tenant"] },
        );
      }
    });
  });
});

describe("withTenantScope (convenience function)", () => {
  it("returns the same sequelize instance", () => {
    const mock = createMockSequelize();
    const pool = new MockPool();
    const result = withTenantScope(mock, () => "tenant-1", pool as any);
    expect(result).toBe(mock);
  });

  it("registers all expected hooks", () => {
    const mock = createMockSequelize();
    const pool = new MockPool();
    withTenantScope(mock, () => "tenant-1", pool as any);

    for (const hookName of EXPECTED_HOOKS) {
      expect(mock.hooks.has(hookName)).toBe(true);
    }
  });

  it("hooks call set_config with correct tenant ID", async () => {
    const mock = createMockSequelize();
    const querySpy = vi.fn().mockResolvedValue([[], 0]);
    mock.query = querySpy;

    const pool = new MockPool();
    withTenantScope(mock, () => "fn-tenant", pool as any);

    const [hookFn] = mock.hooks.get("beforeDestroy")!;
    await hookFn();

    expect(querySpy).toHaveBeenCalledWith(
      `SELECT set_config('app.current_tenant_id', $1, true)`,
      { bind: ["fn-tenant"] },
    );
  });

  it("does not call set_config when contextFn returns empty string", async () => {
    const mock = createMockSequelize();
    const pool = new MockPool();
    withTenantScope(mock, () => "", pool as any);

    const [hookFn] = mock.hooks.get("beforeBulkCreate")!;
    await hookFn();

    expect(mock.queries).toHaveLength(0);
  });
});
