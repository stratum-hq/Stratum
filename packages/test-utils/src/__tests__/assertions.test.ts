import { describe, it, expect, vi, beforeEach } from "vitest";
import { assertIsolation, assertConfigInheritance, assertMongoIsolation } from "../assertions.js";

// ---------------------------------------------------------------------------
// Mock pg.Pool + pg.PoolClient
// ---------------------------------------------------------------------------

function createMockClient(overrides?: {
  queryFn?: (text: string, params?: unknown[]) => unknown;
}) {
  // Default: tenant B can read its own row (positive control) and nothing leaks.
  const queryFn =
    overrides?.queryFn ??
    ((text: string) =>
      text.startsWith("SELECT 1 FROM") ? { rows: [{}], rowCount: 1 } : { rows: [], rowCount: 0 });

  return {
    query: vi.fn(queryFn),
    release: vi.fn(),
  };
}

function createMockPool(client: ReturnType<typeof createMockClient>) {
  return {
    connect: vi.fn(async () => client),
  } as unknown as import("pg").Pool;
}

// ---------------------------------------------------------------------------
// assertIsolation
// ---------------------------------------------------------------------------

describe("assertIsolation", () => {
  let client: ReturnType<typeof createMockClient>;
  let pool: import("pg").Pool;

  beforeEach(() => {
    client = createMockClient();
    pool = createMockPool(client);
  });

  it("calls set_config with correct tenant IDs", async () => {
    await assertIsolation(pool, "tenant-a", "tenant-b", "users");

    const setCalls = client.query.mock.calls.filter(
      (c: unknown[]) =>
        typeof c[0] === "string" && c[0].includes("set_config"),
    );

    expect(setCalls.length).toBe(2);
    // First call sets tenantB (for the insert)
    expect(setCalls[0][1]).toEqual(["tenant-b"]);
    // Second call sets tenantA (for the read)
    expect(setCalls[1][1]).toEqual(["tenant-a"]);
  });

  it("inserts a test row, queries, and cleans up via ROLLBACK", async () => {
    await assertIsolation(pool, "tenant-a", "tenant-b", "orders");

    const texts = client.query.mock.calls.map((c: unknown[]) => c[0] as string);

    expect(texts[0]).toBe("BEGIN");
    expect(texts.some((t: string) => t.includes("INSERT INTO"))).toBe(true);
    expect(texts.some((t: string) => t.includes("SELECT * FROM"))).toBe(true);
    // Must always ROLLBACK in finally
    expect(texts[texts.length - 1]).toBe("ROLLBACK");
    expect(client.release).toHaveBeenCalled();
  });

  it("throws a descriptive error when isolation fails (rows returned)", async () => {
    client = createMockClient({
      queryFn: (text: string) => {
        // The SELECT * query is the 4th call (BEGIN, set_config, INSERT, set_config, SELECT)
        if (text.startsWith("SELECT * FROM")) {
          return { rows: [{ id: "leaked" }, { id: "leaked2" }, { id: "leaked3" }], rowCount: 3 };
        }
        if (text.startsWith("SELECT 1 FROM")) {
          return { rows: [{}], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    pool = createMockPool(client);

    await expect(
      assertIsolation(pool, "tenant-a", "tenant-b", "users"),
    ).rejects.toThrow(
      "Tenant 'tenant-a' was able to read 3 row(s) from tenant 'tenant-b' data in table 'users'. RLS policy is not enforcing isolation",
    );
  });

  it("passes when isolation works (empty result)", async () => {
    await expect(
      assertIsolation(pool, "tenant-a", "tenant-b", "users"),
    ).resolves.toBeUndefined();
  });

  it("uses custom testColumn when provided", async () => {
    await assertIsolation(pool, "a", "b", "docs", { testColumn: "doc_id" });

    const insertCall = client.query.mock.calls.find(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("INSERT"),
    );
    expect(insertCall?.[0]).toContain('"doc_id"');
  });

  it("sets the tenant column to tenant B on the inserted row", async () => {
    await assertIsolation(pool, "a", "b", "docs");

    const insertCall = client.query.mock.calls.find(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("INSERT"),
    );
    expect(insertCall?.[0]).toContain('("tenant_id", "id")');
    expect((insertCall?.[1] as unknown[])[0]).toBe("b");
  });

  it("uses a UUID marker so UUID-keyed tables accept the test row", async () => {
    await assertIsolation(pool, "a", "b", "docs");

    const insertCall = client.query.mock.calls.find(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("INSERT"),
    );
    expect((insertCall?.[1] as unknown[])[1]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("fails as inconclusive when tenant B cannot read its own row", async () => {
    client = createMockClient({ queryFn: () => ({ rows: [], rowCount: 0 }) });
    pool = createMockPool(client);

    await expect(assertIsolation(pool, "a", "b", "docs")).rejects.toThrow(/positive control failed/);
  });
});

// ---------------------------------------------------------------------------
// assertConfigInheritance
// ---------------------------------------------------------------------------

type Entry = { value: unknown; locked: boolean };

/**
 * In-memory stand-in for Stratum's config API with the documented semantics:
 * inheritance from parent to child, child override, and parent locks that
 * reject a child override with ConfigLockedError.
 */
function fakeStratum(parentId: string, childId: string, opts: { enforceLock?: boolean; childSetError?: Error } = {}) {
  const entries = new Map<string, Map<string, Entry>>([
    [parentId, new Map()],
    [childId, new Map()],
  ]);
  const enforceLock = opts.enforceLock ?? true;
  return {
    entries,
    setConfig: vi.fn(async (tenantId: string, key: string, input: { value: unknown; locked?: boolean }) => {
      if (tenantId === childId) {
        if (opts.childSetError && entries.get(parentId)!.get(key)?.locked) throw opts.childSetError;
        if (enforceLock && entries.get(parentId)!.get(key)?.locked) {
          throw Object.assign(new Error("locked"), { name: "ConfigLockedError", code: "CONFIG_LOCKED" });
        }
      }
      entries.get(tenantId)!.set(key, { value: input.value, locked: input.locked ?? false });
    }),
    deleteConfig: vi.fn(async (tenantId: string, key: string) => {
      entries.get(tenantId)!.delete(key);
    }),
    resolveConfig: vi.fn(async (tenantId: string) => {
      const out: Record<string, { value: unknown }> = {};
      for (const [k, e] of entries.get(parentId)!) out[k] = { value: e.value };
      if (tenantId === childId) {
        for (const [k, e] of entries.get(childId)!) {
          if (!(enforceLock && entries.get(parentId)!.get(k)?.locked)) out[k] = { value: e.value };
        }
      }
      return out;
    }),
  };
}

describe("assertConfigInheritance", () => {
  it("passes when inheritance, override and lock all behave, and cleans up", async () => {
    const s = fakeStratum("p", "c");
    await expect(assertConfigInheritance(s, "p", "c", "k")).resolves.toBeUndefined();
    expect(s.entries.get("p")!.size).toBe(0);
    expect(s.entries.get("c")!.size).toBe(0);
  });

  it("throws when child does not inherit parent config", async () => {
    const s = fakeStratum("p", "c");
    s.resolveConfig.mockImplementation(async () => ({}));
    await expect(assertConfigInheritance(s, "p", "c", "k")).rejects.toThrow(/did not inherit config key 'k'/);
  });

  it("throws when the child override does not take precedence", async () => {
    const s = fakeStratum("p", "c");
    const real = s.resolveConfig.getMockImplementation()!;
    s.resolveConfig.mockImplementation(async (tenantId: string) => {
      const out = await real(tenantId);
      const parent = s.entries.get("p")!.get("k");
      if (parent) out.k = { value: parent.value };
      return out;
    });
    await expect(assertConfigInheritance(s, "p", "c", "k")).rejects.toThrow(/did not take precedence/);
  });

  it("throws when locked config override succeeds (lock not enforced)", async () => {
    const s = fakeStratum("p", "c", { enforceLock: false });
    await expect(assertConfigInheritance(s, "p", "c", "k")).rejects.toThrow(/lock is not enforced/);
  });

  it("does not count an unrelated error during the lock check as the lock working", async () => {
    const s = fakeStratum("p", "c", { enforceLock: false, childSetError: new Error("connection reset") });
    await expect(assertConfigInheritance(s, "p", "c", "k")).rejects.toThrow("connection reset");
  });

  it("refuses a key that already resolves for the child", async () => {
    const s = fakeStratum("p", "c");
    s.entries.get("p")!.set("k", { value: "real", locked: false });
    await expect(assertConfigInheritance(s, "p", "c", "k")).rejects.toThrow(/not in use/);
    expect(s.entries.get("p")!.get("k")).toEqual({ value: "real", locked: false });
  });

  it("rejects a pg pool with a clear message", async () => {
    await expect(
      assertConfigInheritance({} as never, "p", "c", "k"),
    ).rejects.toThrow(/expects a Stratum instance/);
  });
});

// ---------------------------------------------------------------------------
// assertMongoIsolation
// ---------------------------------------------------------------------------

/** In-memory collections. When `scoped` is false every tenant sees every document. */
function createFakeMongo(scoped: boolean) {
  const docs: Array<Record<string, unknown>> = [];
  const matches = (doc: Record<string, unknown>, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([k, v]) => doc[k] === v);
  return (tenantId: string) => {
    const scope = (f: Record<string, unknown>) => (scoped ? { ...f, tenant: tenantId } : f);
    return {
      insertOne: async (doc: Record<string, unknown>) => {
        docs.push({ ...doc, tenant: tenantId });
      },
      findOne: async (filter: Record<string, unknown>) => docs.find((d) => matches(d, scope(filter))) ?? null,
      deleteOne: async (filter: Record<string, unknown>) => {
        const i = docs.findIndex((d) => matches(d, scope(filter)));
        if (i >= 0) docs.splice(i, 1);
      },
      docs,
    };
  };
}

describe("assertMongoIsolation", () => {
  it("passes when the accessor isolates tenants, and cleans up", async () => {
    const fake = createFakeMongo(true);
    await assertMongoIsolation(fake, "a", "b");
    expect(fake("b").docs).toHaveLength(0);
  });

  it("throws when the accessor does not isolate tenants", async () => {
    await expect(
      assertMongoIsolation(createFakeMongo(false), "a", "b", { strategy: "SHARED_COLLECTION" }),
    ).rejects.toThrow("SHARED_COLLECTION isolation is not enforced");
  });

  it("throws when tenant B cannot read its own document (positive control)", async () => {
    const accessor = () => ({
      insertOne: async () => undefined,
      findOne: async () => null,
      deleteOne: async () => undefined,
    });
    await expect(assertMongoIsolation(accessor, "a", "b")).rejects.toThrow("positive control failed");
  });

  it("throws when given something other than an accessor function", async () => {
    await expect(assertMongoIsolation({} as never, "a", "b")).rejects.toThrow(TypeError);
  });

  it("throws when both tenants are the same", async () => {
    await expect(assertMongoIsolation(createFakeMongo(true), "a", "a")).rejects.toThrow("two different tenants");
  });
});
