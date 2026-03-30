import { describe, it, expect, vi, beforeEach } from "vitest";
import { migrateAllSchemas } from "../migrate-schemas.js";

// Mock fs and path so we don't need real migration files
vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    readdirSync: vi.fn().mockReturnValue(["001_init.sql", "002_schema.sql"]),
    readFileSync: vi.fn().mockImplementation((_path: string) => {
      if (_path.includes("001_init")) return "CREATE TABLE test1 (id INT);";
      return "CREATE TABLE test2 (id INT);";
    }),
  },
}));

function createMockClient() {
  const applied = new Set<string>();
  return {
    query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
      // Track SET search_path calls
      if (typeof sql === "string" && sql.includes("search_path")) {
        return Promise.resolve({ rows: [] });
      }
      // Check if migration already applied
      if (
        typeof sql === "string" &&
        sql.includes("SELECT 1 FROM _migrations") &&
        params
      ) {
        const name = params[0] as string;
        if (applied.has(name)) {
          return Promise.resolve({ rows: [{ "?column?": 1 }] });
        }
        return Promise.resolve({ rows: [] });
      }
      // Record applied migration
      if (
        typeof sql === "string" &&
        sql.includes("INSERT INTO _migrations") &&
        params
      ) {
        applied.add(params[0] as string);
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    }),
    release: vi.fn(),
  };
}

function createMockPool(schemas: string[], opts?: { failSchema?: string }) {
  const clients: ReturnType<typeof createMockClient>[] = [];

  const pool = {
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("SELECT slug FROM tenants")) {
        return Promise.resolve({
          rows: schemas.map((s) => ({ slug: s })),
        });
      }
      return Promise.resolve({ rows: [] });
    }),
    connect: vi.fn().mockImplementation(() => {
      const client = createMockClient();

      if (opts?.failSchema) {
        const origQuery = client.query;
        client.query = vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
          // Fail on the actual migration SQL for the target schema
          if (
            typeof sql === "string" &&
            sql.includes("search_path") &&
            sql.includes(`tenant_${opts.failSchema}`)
          ) {
            // Let the search_path call succeed, but fail on the next migration SQL
            const innerQuery = vi.fn().mockImplementation((innerSql: string, innerParams?: unknown[]) => {
              if (innerSql.startsWith("CREATE TABLE test")) {
                return Promise.reject(new Error(`Migration failed for schema tenant_${opts.failSchema}`));
              }
              return origQuery(innerSql, innerParams);
            });
            // Replace query for subsequent calls
            client.query = innerQuery as any;
            return Promise.resolve({ rows: [] });
          }
          return origQuery(sql, params);
        }) as any;
      }

      clients.push(client);
      return Promise.resolve(client);
    }),
    _clients: clients,
  };

  return pool as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("migrateAllSchemas", () => {
  it("discovers schemas from tenants table", async () => {
    const pool = createMockPool(["acme", "globex"]);
    await migrateAllSchemas({ pool });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("SELECT slug FROM tenants"),
    );
  });

  it("runs migrations per schema with correct search_path", async () => {
    const pool = createMockPool(["acme"]);
    const result = await migrateAllSchemas({ pool });

    expect(result.succeeded).toContain("tenant_acme");
    expect(result.failed).toHaveLength(0);

    // Verify search_path was set for the schema
    const allCalls = pool._clients.flatMap(
      (c: ReturnType<typeof createMockClient>) =>
        c.query.mock.calls.map((call: unknown[]) => call[0]),
    );
    const searchPathCalls = allCalls.filter(
      (s: string) => typeof s === "string" && s.includes("search_path"),
    );
    expect(searchPathCalls.some((s: string) => s.includes("tenant_acme"))).toBe(true);
  });

  it("continue-on-error: collects failures in result.failed[]", async () => {
    // Create a pool where one schema will fail
    const pool = createMockPool(["acme", "badco"]);
    // Override connect to fail for badco's migration
    let callCount = 0;
    const origConnect = pool.connect;
    pool.connect = vi.fn().mockImplementation(() => {
      callCount++;
      const client = createMockClient();

      // Make every other set of clients fail for badco
      const origQuery = client.query;
      let currentSchema = "";
      client.query = vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
        if (typeof sql === "string" && sql.includes("search_path")) {
          if (sql.includes("tenant_badco")) {
            currentSchema = "badco";
          } else {
            currentSchema = "";
          }
        }
        if (
          currentSchema === "badco" &&
          typeof sql === "string" &&
          sql.startsWith("CREATE TABLE test")
        ) {
          return Promise.reject(new Error("Schema migration failed"));
        }
        return origQuery(sql, params);
      }) as any;

      pool._clients.push(client);
      return Promise.resolve(client);
    }) as any;

    const result = await migrateAllSchemas({ pool });

    expect(result.succeeded).toContain("tenant_acme");
    expect(result.failed.length).toBeGreaterThan(0);
    expect(result.failed[0].schema).toBe("tenant_badco");
    expect(result.failed[0].error).toBeInstanceOf(Error);
  });

  it("progress callback called with correct args", async () => {
    const pool = createMockPool(["acme", "globex"]);
    const progress = vi.fn();
    await migrateAllSchemas({ pool, onProgress: progress });

    expect(progress).toHaveBeenCalledTimes(2);
    // Each call should have (schema, index, total)
    const calls = progress.mock.calls;
    for (const call of calls) {
      expect(typeof call[0]).toBe("string");
      expect(typeof call[1]).toBe("number");
      expect(call[2]).toBe(2);
    }
    // Indices should be 1 and 2 (completed count)
    const indices = calls.map((c: unknown[]) => c[1]).sort();
    expect(indices).toEqual([1, 2]);
  });

  it("idempotent re-run: already-applied migrations skipped", async () => {
    // Create pool with a client that reports migrations as already applied
    const pool = createMockPool(["acme"]);
    const origConnect = pool.connect;
    pool.connect = vi.fn().mockImplementation(() => {
      const client = createMockClient();
      // Override: all migrations already applied
      const origQuery = client.query;
      client.query = vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
        if (
          typeof sql === "string" &&
          sql.includes("SELECT 1 FROM _migrations") &&
          params
        ) {
          return Promise.resolve({ rows: [{ "?column?": 1 }] });
        }
        return origQuery(sql, params);
      }) as any;
      pool._clients.push(client);
      return Promise.resolve(client);
    }) as any;

    const result = await migrateAllSchemas({ pool });
    expect(result.succeeded).toContain("tenant_acme");
    expect(result.failed).toHaveLength(0);

    // No INSERT should have been called (migrations skipped)
    const allCalls = pool._clients.flatMap(
      (c: ReturnType<typeof createMockClient>) =>
        c.query.mock.calls.map((call: unknown[]) => call[0]),
    );
    const inserts = allCalls.filter(
      (s: string) => typeof s === "string" && s.includes("INSERT INTO _migrations"),
    );
    expect(inserts).toHaveLength(0);
  });

  it("empty schema list returns empty result", async () => {
    const pool = createMockPool([]);
    const result = await migrateAllSchemas({ pool });
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it("respects concurrency limit", async () => {
    const schemas = Array.from({ length: 10 }, (_, i) => `tenant${i}`);
    const pool = createMockPool(schemas);
    let maxConcurrent = 0;
    let currentConcurrent = 0;
    const origConnect = pool.connect;

    pool.connect = vi.fn().mockImplementation(async () => {
      currentConcurrent++;
      if (currentConcurrent > maxConcurrent) {
        maxConcurrent = currentConcurrent;
      }
      const client = createMockClient();
      // Add a small delay to simulate work
      const origQuery = client.query;
      client.query = vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
        if (typeof sql === "string" && sql.includes("COMMIT")) {
          // Small delay on commit
          await new Promise((r) => setTimeout(r, 5));
          currentConcurrent--;
        }
        return origQuery(sql, params);
      }) as any;
      pool._clients.push(client);
      return client;
    }) as any;

    await migrateAllSchemas({ pool, concurrency: 3 });

    // maxConcurrent should not exceed concurrency * migrations_per_schema
    // but the schema-level concurrency should be limited
    // Due to the semaphore, we expect at most 3 schemas in flight
    expect(maxConcurrent).toBeLessThanOrEqual(3 * 2); // 3 concurrent * 2 migration files
  });
});
