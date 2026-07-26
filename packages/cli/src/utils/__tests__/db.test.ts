import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type pg from "pg";
import { getConnectionString, scanTables } from "../db.js";

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
