import { describe, it, expect, vi } from "vitest";
import type pg from "pg";
import { PINNED_SEARCH_PATH, pinnedQuery, schemaOfTable, withPinnedSearchPath } from "../pinned-query.js";
import * as lib from "../index.js";

function fakePool(fail = false) {
  const statements: string[] = [];
  const release = vi.fn();
  const client = {
    query: vi.fn((text: string) => {
      statements.push(text);
      if (fail && text === "SELECT 1") return Promise.reject(new Error("boom"));
      return Promise.resolve({ rows: [{ one: 1 }] });
    }),
    release,
  };
  const pool = { connect: vi.fn(() => Promise.resolve(client)) } as unknown as pg.Pool;
  return { pool, statements, release };
}

describe("withPinnedSearchPath", () => {
  it("runs the query in a transaction whose search path is only pg_catalog", async () => {
    const { pool, statements, release } = fakePool();
    await pinnedQuery(pool, "SELECT 1");
    expect(PINNED_SEARCH_PATH).toBe("pg_catalog, pg_temp");
    expect(statements).toEqual(["BEGIN", "SET LOCAL search_path = pg_catalog, pg_temp", "SELECT 1", "COMMIT"]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and releases the client when the query fails", async () => {
    const { pool, statements, release } = fakePool(true);
    await expect(withPinnedSearchPath(pool, (c) => c.query("SELECT 1"))).rejects.toThrow("boom");
    expect(statements.at(-1)).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("schemaOfTable", () => {
  it("names every function, operator and type it uses with pg_catalog", async () => {
    let sql = "";
    const db = {
      query: vi.fn((text: string) => {
        sql = text;
        return Promise.resolve({ rows: [{ nsp: "acme" }] });
      }),
    } as unknown as pg.Pool;
    expect(await schemaOfTable(db)).toBe("acme");
    const rest = sql
      .replace(/OPERATOR\(pg_catalog\.=\)/g, "")
      .replace(/::pg_catalog\.\w+/g, "")
      .replace(/pg_catalog\.\w+/g, "");
    expect(rest).not.toMatch(/[=<>|]|::|\b\w+\(/);
  });

  it("is exported from the package entry point with the pinned helpers", () => {
    expect(lib.schemaOfTable).toBe(schemaOfTable);
    expect(lib.pinnedQuery).toBe(pinnedQuery);
    expect(lib.withPinnedSearchPath).toBe(withPinnedSearchPath);
  });
});
