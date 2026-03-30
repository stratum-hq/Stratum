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
  hooks: Map<string, Array<(this: unknown, next: () => void) => void>>;
  path(name: string): unknown;
  add(obj: Record<string, unknown>): void;
  pre(method: string | string[], fn: (...args: unknown[]) => void): void;
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
        schema.hooks.get(m)!.push(fn as (this: unknown, next: () => void) => void);
      }
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

  it("is idempotent — does not add tenant_id if already present", () => {
    schema.paths.set("tenant_id", { type: String });
    stratumPlugin(schema);
    expect(schema.added.length).toBe(0);
  });

  it("registers pre-save hook that sets tenant_id", () => {
    mockGetTenantContext.mockReturnValue({ tenant_id: "t1" } as never);
    stratumPlugin(schema);

    const hooks = schema.hooks.get("save")!;
    expect(hooks.length).toBe(1);

    const doc = {} as Record<string, unknown>;
    const next = vi.fn();
    hooks[0].call(doc, next);
    expect(doc.tenant_id).toBe("t1");
    expect(next).toHaveBeenCalled();
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
    const next = vi.fn();
    hooks[0].call(query, next);
    expect(currentQuery.tenant_id).toBe("t1");
    expect(next).toHaveBeenCalled();
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

    const pipeline: Record<string, unknown>[] = [{ $group: { _id: "$x" } }];
    const agg = { pipeline: () => pipeline };
    const next = vi.fn();
    hooks[0].call(agg, next);
    expect(pipeline[0]).toEqual({ $match: { tenant_id: "t1" } });
    expect(next).toHaveBeenCalled();
  });

  it("throws when ALS context is missing", () => {
    mockGetTenantContext.mockImplementation(() => {
      throw new Error("TenantContextNotFoundError");
    });
    stratumPlugin(schema);

    const hooks = schema.hooks.get("save")!;
    const doc = {} as Record<string, unknown>;
    const next = vi.fn();
    expect(() => hooks[0].call(doc, next)).toThrow("TenantContextNotFoundError");
  });
});
