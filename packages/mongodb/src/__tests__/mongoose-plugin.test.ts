import { describe, it, expect, vi, beforeEach } from "vitest";
import { stratumPlugin } from "../mongoose-plugin.js";

// Mock @stratum-hq/sdk
vi.mock("@stratum-hq/sdk", () => ({
  getTenantContext: vi.fn(),
}));

import { getTenantContext } from "@stratum-hq/sdk";

const mockGetTenantContext = vi.mocked(getTenantContext);

interface MockSchema {
  paths: Map<string, unknown>;
  added: Record<string, unknown>[];
  hooks: Map<string, Array<(this: unknown) => void>>;
  path(name: string): unknown;
  add(obj: Record<string, unknown>): void;
  pre(method: string | string[], fn: (...args: unknown[]) => void): void;
  statics: Record<string, unknown>;
  static(name: string, fn: unknown): void;
}

function createMockSchema(): MockSchema {
  const schema: MockSchema = {
    paths: new Map(),
    added: [],
    hooks: new Map(),
    path(name: string) {
      return schema.paths.get(name);
    },
    add(obj: Record<string, unknown>) {
      schema.added.push(obj);
      for (const key of Object.keys(obj)) {
        schema.paths.set(key, obj[key]);
      }
    },
    pre(method: string | string[], fn: (...args: unknown[]) => void) {
      const methods = Array.isArray(method) ? method : [method];
      for (const m of methods) {
        if (!schema.hooks.has(m)) schema.hooks.set(m, []);
        schema.hooks.get(m)!.push(fn as (this: unknown) => void);
      }
    },
    statics: {},
    static(name: string, fn: unknown) {
      schema.statics[name] = fn;
    },
  };
  return schema;
}

describe("stratumPlugin", () => {
  let schema: MockSchema;

  beforeEach(() => {
    schema = createMockSchema();
    vi.clearAllMocks();
  });

  it("adds tenant_id field to schema", () => {
    stratumPlugin(schema);
    expect(schema.paths.has("tenant_id")).toBe(true);
  });

  it("is idempotent: does not add tenant_id if already present", () => {
    schema.paths.set("tenant_id", { type: String });
    stratumPlugin(schema);
    expect(schema.added.length).toBe(0);
  });

  it("registers pre-validate and pre-save hooks that set tenant_id", () => {
    mockGetTenantContext.mockReturnValue({ tenant_id: "t1" } as never);
    stratumPlugin(schema);

    for (const name of ["validate", "save"]) {
      const hooks = schema.hooks.get(name)!;
      expect(hooks.length).toBe(1);
      // Mongoose 8 waits for a next() call from a hook that declares parameters.
      expect(hooks[0].length).toBe(0);

      const doc = {} as Record<string, unknown>;
      hooks[0].call(doc);
      expect(doc.tenant_id).toBe("t1");
    }
  });

  it("scopes insertMany with the Mongoose 8 and the Mongoose 9 hook arguments", () => {
    mockGetTenantContext.mockReturnValue({ tenant_id: "t1" } as never);
    stratumPlugin(schema);
    const hook = schema.hooks.get("insertMany")![0] as (this: unknown, ...args: unknown[]) => void;

    const docs8 = [{ tenant_id: "t2" }];
    const next = vi.fn();
    hook.call({}, next, docs8);
    expect(docs8[0].tenant_id).toBe("t1");
    expect(next).toHaveBeenCalledOnce();

    const docs9 = [{ tenant_id: "t2" }];
    hook.call({}, docs9, {});
    expect(docs9[0].tenant_id).toBe("t1");
  });

  it("scopes bulkWrite with the Mongoose 8 and the Mongoose 9 hook arguments", () => {
    mockGetTenantContext.mockReturnValue({ tenant_id: "t1" } as never);
    stratumPlugin(schema);
    const hook = schema.hooks.get("bulkWrite")![0] as (this: unknown, ...args: unknown[]) => void;
    const insert = () => [{ insertOne: { document: { name: "x" } } }];

    const ops8 = insert();
    const next = vi.fn();
    hook.call({}, next, ops8, {});
    expect(ops8[0].insertOne.document).toEqual({ name: "x", tenant_id: "t1" });
    expect(next).toHaveBeenCalledOnce();

    const ops9 = insert();
    hook.call({}, ops9, {});
    expect(ops9[0].insertOne.document).toEqual({ name: "x", tenant_id: "t1" });
  });

  it("registers pre-find hook that adds tenant_id to query", () => {
    mockGetTenantContext.mockReturnValue({ tenant_id: "t1" } as never);
    stratumPlugin(schema);

    const hooks = schema.hooks.get("find")!;
    expect(hooks.length).toBe(1);

    let currentQuery: Record<string, unknown> = { name: "test" };
    const query = {
      getQuery: () => currentQuery,
      setQuery: (q: Record<string, unknown>) => { currentQuery = q; },
    };
    expect(hooks[0].length).toBe(0);
    hooks[0].call(query);
    expect(currentQuery.tenant_id).toBe("t1");
  });

  it("registers hooks for all query methods", () => {
    stratumPlugin(schema);
    const queryMethods = [
      "find", "findOne", "updateOne", "updateMany",
      "deleteOne", "deleteMany", "countDocuments",
    ];
    for (const method of queryMethods) {
      expect(schema.hooks.has(method)).toBe(true);
    }
  });

  it("registers pre-aggregate hook", () => {
    mockGetTenantContext.mockReturnValue({ tenant_id: "t1" } as never);
    stratumPlugin(schema);

    const hooks = schema.hooks.get("aggregate")!;
    expect(hooks.length).toBe(1);

    const makeAgg = (options: { cursor?: unknown }) => ({
      options,
      _pipeline: [{ $group: { _id: "$x" } }] as Record<string, unknown>[],
      pipeline() {
        return this._pipeline;
      },
    });
    expect(hooks[0].length).toBe(0);
    const agg = makeAgg({});
    hooks[0].call(agg);
    expect(agg._pipeline).toEqual([{ $match: { tenant_id: "t1" } }, { $group: { _id: "$x" } }]);
    expect(Object.isFrozen(agg._pipeline)).toBe(false);

    const cursorAgg = makeAgg({ cursor: {} });
    hooks[0].call(cursorAgg);
    expect(cursorAgg._pipeline).toEqual([{ $match: { tenant_id: "t1" } }, { $group: { _id: "$x" } }]);
    expect(Object.isFrozen(cursorAgg._pipeline)).toBe(true);
  });

  it("throws when ALS context is missing", () => {
    mockGetTenantContext.mockImplementation(() => {
      throw new Error("TenantContextNotFoundError");
    });
    stratumPlugin(schema);

    const hooks = schema.hooks.get("save")!;
    const doc = {} as Record<string, unknown>;
    expect(() => hooks[0].call(doc)).toThrow("TenantContextNotFoundError");
  });
});
