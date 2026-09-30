import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { STRATUM_TABLES } from "../stratum-tables.js";
import * as lib from "../index.js";

const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

/** Returns the name of every table that a CREATE TABLE statement in the migrations makes. */
function tablesCreatedByMigrations(): string[] {
  const pattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;
  const names = new Set<string>();
  for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    for (const match of sql.matchAll(pattern)) names.add(match[1].toLowerCase());
  }
  return [...names];
}

describe("STRATUM_TABLES", () => {
  it("lists every table the migrations create, plus _migrations", () => {
    expect([...STRATUM_TABLES].sort()).toEqual(["_migrations", ...tablesCreatedByMigrations()].sort());
  });

  it("is exported from the package entry point", () => {
    expect(lib.STRATUM_TABLES).toBe(STRATUM_TABLES);
  });
});
