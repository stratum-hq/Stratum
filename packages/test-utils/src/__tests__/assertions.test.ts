import { describe, it, expect, vi, beforeEach } from "vitest";
import { assertIsolation, assertConfigInheritance } from "../assertions.js";

// ---------------------------------------------------------------------------
// Mock pg.Pool + pg.PoolClient
// ---------------------------------------------------------------------------

function createMockClient(overrides?: {
  queryFn?: (text: string, params?: unknown[]) => unknown;
}) {
  const queryFn =
    overrides?.queryFn ??
    (() => ({ rows: [], rowCount: 0 }));

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
    let callIndex = 0;
    client = createMockClient({
      queryFn: (text: string) => {
        callIndex++;
        // The SELECT * query is the 4th call (BEGIN, set_config, INSERT, set_config, SELECT)
        if (text.startsWith("SELECT * FROM")) {
          return { rows: [{ id: "leaked" }, { id: "leaked2" }, { id: "leaked3" }], rowCount: 3 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    pool = createMockPool(client);

    await expect(
      assertIsolation(pool, "tenant-a", "tenant-b", "users"),
    ).rejects.toThrow(
      "Tenant 'tenant-a' was able to read 3 row(s) from tenant 'tenant-b' data in table 'users' — RLS policy is not enforcing isolation",
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
});

// ---------------------------------------------------------------------------
// assertConfigInheritance
// ---------------------------------------------------------------------------

describe("assertConfigInheritance", () => {
  it("reads config after setting on parent and asserts child inherits", async () => {
    const client = createMockClient({
      queryFn: (text: string, params?: unknown[]) => {
        if (text.includes("tenant_config_resolved")) {
          // Return the parent value for inheritance check
          // We need to figure out which call this is — first resolved read returns parent value
          return { rows: [{ value: expect.stringContaining("__stratum_parent_") ? (params as string[])?.[0] === undefined ? "" : "__matching__" : "" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });

    // More precise mock: track state
    let parentValue = "";
    let childOverrideValue = "";
    let configLocked = false;
    let resolvedCallCount = 0;
    let insertCallCount = 0;

    const statefulClient = createMockClient({
      queryFn: (text: string, params?: unknown[]) => {
        if (text.includes("INSERT INTO tenant_config") && params) {
          insertCallCount++;
          if (insertCallCount === 1) {
            parentValue = params[2] as string;
          } else if (insertCallCount === 2) {
            childOverrideValue = params[2] as string;
          } else if (insertCallCount === 3 && configLocked) {
            // Locked — throw error
            throw new Error("locked config violation");
          }
        }
        if (text.includes("tenant_config_resolved")) {
          resolvedCallCount++;
          if (resolvedCallCount === 1) {
            return { rows: [{ value: parentValue }], rowCount: 1 };
          }
          if (resolvedCallCount === 2) {
            return { rows: [{ value: childOverrideValue }], rowCount: 1 };
          }
        }
        if (text.includes("UPDATE tenant_config SET locked")) {
          configLocked = true;
        }
        return { rows: [], rowCount: 0 };
      },
    });

    const pool = createMockPool(statefulClient);

    await expect(
      assertConfigInheritance(pool, "parent-1", "child-1", "feature.flag"),
    ).resolves.toBeUndefined();

    // Verify set_config was called with both tenant IDs
    const setCalls = statefulClient.query.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("set_config"),
    );
    const tenantIds = setCalls.map((c: unknown[]) => (c as [string, string[]])[1][0]);
    expect(tenantIds).toContain("parent-1");
    expect(tenantIds).toContain("child-1");
  });

  it("verifies child override takes precedence", async () => {
    let insertCount = 0;
    let resolvedCount = 0;
    let parentVal = "";
    let childVal = "";

    const client = createMockClient({
      queryFn: (text: string, params?: unknown[]) => {
        if (text.includes("INSERT INTO tenant_config") && params) {
          insertCount++;
          if (insertCount === 1) parentVal = params[2] as string;
          if (insertCount === 2) childVal = params[2] as string;
        }
        if (text.includes("tenant_config_resolved")) {
          resolvedCount++;
          if (resolvedCount === 1) return { rows: [{ value: parentVal }], rowCount: 1 };
          if (resolvedCount === 2) return { rows: [{ value: childVal }], rowCount: 1 };
        }
        if (text.includes("UPDATE tenant_config SET locked")) {
          // After lock, next insert will throw
        }
        return { rows: [], rowCount: 0 };
      },
    });

    // Make the 3rd insert (locked override attempt) throw
    let realInsertCount = 0;
    const origQuery = client.query.getMockImplementation()!;
    client.query.mockImplementation(((text: string, params?: unknown[]) => {
      if (typeof text === "string" && text.includes("INSERT INTO tenant_config")) {
        realInsertCount++;
        if (realInsertCount === 3) {
          throw new Error("violates locked constraint");
        }
      }
      return origQuery(text, params);
    }) as typeof client.query);

    const pool = createMockPool(client);
    await expect(
      assertConfigInheritance(pool, "parent", "child", "theme"),
    ).resolves.toBeUndefined();

    // The second resolved call should have been made (child override check)
    const resolvedCalls = client.query.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("tenant_config_resolved"),
    );
    expect(resolvedCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("verifies locked config cannot be overridden", async () => {
    let insertCount = 0;
    let resolvedCount = 0;
    let parentVal = "";
    let childVal = "";

    const client = createMockClient({
      queryFn: (text: string, params?: unknown[]) => {
        if (text.includes("INSERT INTO tenant_config") && params) {
          insertCount++;
          if (insertCount === 1) parentVal = params[2] as string;
          if (insertCount === 2) childVal = params[2] as string;
          if (insertCount === 3) {
            // Locked config — constraint error
            throw new Error("cannot override locked config");
          }
        }
        if (text.includes("tenant_config_resolved")) {
          resolvedCount++;
          if (resolvedCount === 1) return { rows: [{ value: parentVal }], rowCount: 1 };
          if (resolvedCount === 2) return { rows: [{ value: childVal }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });

    const pool = createMockPool(client);
    // Should pass because the lock IS enforced (insert throws)
    await expect(
      assertConfigInheritance(pool, "org-1", "team-1", "max_seats"),
    ).resolves.toBeUndefined();
  });

  it("throws when child does not inherit parent config", async () => {
    const client = createMockClient({
      queryFn: (text: string) => {
        if (text.includes("tenant_config_resolved")) {
          // Return empty — child did not inherit
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });

    const pool = createMockPool(client);
    await expect(
      assertConfigInheritance(pool, "parent", "child", "feature.x"),
    ).rejects.toThrow(
      /did not inherit config key 'feature\.x' from parent 'parent'/,
    );
  });

  it("throws when locked config override succeeds (lock not enforced)", async () => {
    let insertCount = 0;
    let resolvedCount = 0;
    let parentVal = "";
    let childVal = "";

    const client = createMockClient({
      queryFn: (text: string, params?: unknown[]) => {
        if (text.includes("INSERT INTO tenant_config") && params) {
          insertCount++;
          if (insertCount === 1) parentVal = params[2] as string;
          if (insertCount === 2) childVal = params[2] as string;
          // 3rd insert succeeds — lock not enforced
        }
        if (text.includes("tenant_config_resolved")) {
          resolvedCount++;
          if (resolvedCount === 1) return { rows: [{ value: parentVal }], rowCount: 1 };
          if (resolvedCount === 2) return { rows: [{ value: childVal }], rowCount: 1 };
          // After lock attempt, resolved returns child's override instead of parent
          if (resolvedCount === 3) return { rows: [{ value: childVal }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });

    const pool = createMockPool(client);
    await expect(
      assertConfigInheritance(pool, "p", "c", "setting"),
    ).rejects.toThrow(/was able to override locked config key/);
  });
});
