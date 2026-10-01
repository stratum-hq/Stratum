import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type pg from "pg";
import { STRATUM_TABLES } from "@stratum-hq/lib";
import { controlRoleFlag, getAdminConnectionString, getConnectionString, scanTables } from "../db.js";

const DEFAULT = "postgres://stratum_app:stratum_dev@localhost:5432/stratum";

describe("getConnectionString", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = savedEnv;
    }
  });

  it("returns the --database-url flag when provided", () => {
    expect(getConnectionString({ "database-url": "postgres://flag" })).toBe("postgres://flag");
  });

  it("returns the -d flag when provided", () => {
    expect(getConnectionString({ d: "postgres://short" })).toBe("postgres://short");
  });

  it("prefers the flag over DATABASE_URL", () => {
    process.env.DATABASE_URL = "postgres://env";
    expect(getConnectionString({ "database-url": "postgres://flag" })).toBe("postgres://flag");
  });

  it("falls back to DATABASE_URL when no flag is given", () => {
    process.env.DATABASE_URL = "postgres://env";
    expect(getConnectionString({})).toBe("postgres://env");
  });

  it("returns the built-in default when neither flag nor env is set", () => {
    expect(getConnectionString({})).toBe(DEFAULT);
  });

  it("ignores a valueless (boolean) flag and falls through", () => {
    process.env.DATABASE_URL = "postgres://env";
    // `--database-url` with no value parses to boolean true, which is not a string
    expect(getConnectionString({ "database-url": true })).toBe("postgres://env");
  });
});

describe("scanTables SQL", () => {
  async function capturedSql(): Promise<string> {
    let sql = "";
    const fakePool = {
      query: (text: string) => {
        sql = text;
        return Promise.resolve({ rows: [] });
      },
    } as unknown as pg.Pool;
    await scanTables(fakePool);
    return sql;
  }

  // Regression for #167: the underscore in the internal-table filter must reach
  // Postgres as an escaped literal '\_%'. If the backslash is dropped, Postgres
  // sees the bare '_' single-char wildcard and NOT LIKE '_%' excludes every
  // non-empty table name, so the scan can never report an orphan table.
  it("escapes the underscore so Postgres receives a literal '\\_%'", async () => {
    const sql = await capturedSql();
    // The runtime string contains a real backslash before the underscore.
    expect(sql).toMatch(/NOT LIKE '\\_%'/);
  });

  it("does not emit the bare-wildcard predicate NOT LIKE '_%'", async () => {
    const sql = await capturedSql();
    // Strip the correctly-escaped occurrence, then assert no bare '_%' remains.
    const withoutEscaped = sql.replace(/NOT LIKE '\\_%'/g, "");
    expect(withoutEscaped).not.toMatch(/NOT LIKE '_%'/);
  });
});

describe("scanTables exclusions", () => {
  it("passes the table list from @stratum-hq/lib as the exclusion parameter", async () => {
    let sql = "";
    let params: unknown[] | undefined;
    const fakePool = {
      query: (text: string, values?: unknown[]) => {
        sql = text;
        params = values;
        return Promise.resolve({ rows: [] });
      },
    } as unknown as pg.Pool;
    await scanTables(fakePool);
    expect(sql).toContain("NOT (t.tablename = ANY($1::text[]))");
    expect(params).toEqual([STRATUM_TABLES, null]);
    expect(STRATUM_TABLES).toContain("principal_roles");
  });

  it("passes --control-role as the control role the policy check accepts", async () => {
    let params: unknown[] | undefined;
    const fakePool = {
      query: (_text: string, values?: unknown[]) => {
        params = values;
        return Promise.resolve({ rows: [] });
      },
    } as unknown as pg.Pool;
    await scanTables(fakePool, "acme_control");
    expect(params).toEqual([STRATUM_TABLES, "acme_control"]);
  });
});

describe("admin connection and role flags", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers --admin-database-url over DATABASE_ADMIN_URL", () => {
    vi.stubEnv("DATABASE_ADMIN_URL", "postgres://env-admin");
    expect(getAdminConnectionString({ "admin-database-url": "postgres://flag-admin" })).toBe("postgres://flag-admin");
  });

  it("falls back to DATABASE_ADMIN_URL, and to no admin connection when neither is set", () => {
    vi.stubEnv("DATABASE_ADMIN_URL", "postgres://env-admin");
    expect(getAdminConnectionString({})).toBe("postgres://env-admin");
    vi.stubEnv("DATABASE_ADMIN_URL", "");
    expect(getAdminConnectionString({})).toBeUndefined();
  });

  it("accepts a plain lowercase --control-role and refuses anything else", () => {
    expect(controlRoleFlag({})).toBeUndefined();
    expect(controlRoleFlag({ "control-role": "acme_control" })).toBe("acme_control");
    expect(() => controlRoleFlag({ "control-role": true })).toThrow(/needs a value/);
    expect(() => controlRoleFlag({ "control-role": 'x"; DROP ROLE y; --' })).toThrow(/Invalid --control-role/);
    expect(() => controlRoleFlag({ "control-role": "Acme" })).toThrow(/Invalid --control-role/);
  });
});
