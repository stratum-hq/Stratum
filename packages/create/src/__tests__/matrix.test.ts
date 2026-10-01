import { describe, it, expect } from "vitest";
import {
  parsePresetString,
  formatPresetString,
  isValidPreset,
  getValidOptions,
  ormsFor,
  VALID_COMBINATIONS,
  type StackPreset,
} from "../matrix.js";

// ─── parsePresetString ───────────────────────────────────────────────────────

describe("parsePresetString", () => {
  it("parses a valid postgres preset", () => {
    const result = parsePresetString("postgres-rls-prisma-express");
    expect(result).toEqual({
      database: "postgres",
      strategy: "rls",
      orm: "prisma",
      framework: "express",
    });
  });

  it("parses a valid mongodb preset", () => {
    const result = parsePresetString("mongodb-database-mongoose-hono");
    expect(result).toEqual({
      database: "mongodb",
      strategy: "database",
      orm: "mongoose",
      framework: "hono",
    });
  });

  it("parses mysql with table-prefix (hyphenated strategy)", () => {
    const result = parsePresetString("mysql-table-prefix-sequelize-nestjs");
    expect(result).toEqual({
      database: "mysql",
      strategy: "table-prefix",
      orm: "sequelize",
      framework: "nestjs",
    });
  });

  it("parses preset with none framework", () => {
    const result = parsePresetString("postgres-schema-drizzle-none");
    expect(result).toEqual({
      database: "postgres",
      strategy: "schema",
      orm: "drizzle",
      framework: "none",
    });
  });

  it("handles uppercase input by lowering", () => {
    const result = parsePresetString("POSTGRES-RLS-PRISMA-EXPRESS");
    expect(result).toEqual({
      database: "postgres",
      strategy: "rls",
      orm: "prisma",
      framework: "express",
    });
  });

  it("returns null for empty string", () => {
    expect(parsePresetString("")).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(parsePresetString("invalid-garbage")).toBeNull();
  });

  it("returns null for too few parts", () => {
    expect(parsePresetString("postgres-rls")).toBeNull();
  });

  it("returns null for too many parts (non table-prefix)", () => {
    expect(parsePresetString("postgres-rls-prisma-express-extra-stuff")).toBeNull();
  });

  it("returns null for unknown database", () => {
    expect(parsePresetString("redis-rls-prisma-express")).toBeNull();
  });

  it("returns null for unknown orm", () => {
    expect(parsePresetString("postgres-rls-typeorm-express")).toBeNull();
  });

  it("returns null for unknown framework", () => {
    expect(parsePresetString("postgres-rls-prisma-koa")).toBeNull();
  });

  it("returns null for unknown strategy", () => {
    expect(parsePresetString("postgres-sharding-prisma-express")).toBeNull();
  });
});

// ─── formatPresetString ──────────────────────────────────────────────────────

describe("formatPresetString", () => {
  it("formats a simple preset", () => {
    const preset: StackPreset = {
      database: "postgres",
      strategy: "rls",
      orm: "prisma",
      framework: "express",
    };
    expect(formatPresetString(preset)).toBe("postgres-rls-prisma-express");
  });

  it("formats a table-prefix preset", () => {
    const preset: StackPreset = {
      database: "mysql",
      strategy: "table-prefix",
      orm: "sequelize",
      framework: "nestjs",
    };
    expect(formatPresetString(preset)).toBe("mysql-table-prefix-sequelize-nestjs");
  });

  it("round-trips with parsePresetString", () => {
    const original = "mongodb-collection-mongoose-fastify";
    const parsed = parsePresetString(original)!;
    expect(parsed).not.toBeNull();
    expect(formatPresetString(parsed)).toBe(original);
  });

  it("round-trips table-prefix", () => {
    const original = "mysql-table-prefix-knex-hono";
    const parsed = parsePresetString(original)!;
    expect(parsed).not.toBeNull();
    expect(formatPresetString(parsed)).toBe(original);
  });
});

// ─── isValidPreset ───────────────────────────────────────────────────────────

describe("isValidPreset", () => {
  // Valid PostgreSQL combos
  it("accepts postgres-rls-prisma-express", () => {
    expect(isValidPreset({ database: "postgres", strategy: "rls", orm: "prisma", framework: "express" })).toBe(true);
  });

  it("accepts postgres-schema-prisma-fastify", () => {
    expect(isValidPreset({ database: "postgres", strategy: "schema", orm: "prisma", framework: "fastify" })).toBe(true);
  });

  it("accepts postgres-database-prisma-express", () => {
    expect(isValidPreset({ database: "postgres", strategy: "database", orm: "prisma", framework: "express" })).toBe(true);
  });

  it("accepts postgres-rls-drizzle-fastify", () => {
    expect(isValidPreset({ database: "postgres", strategy: "rls", orm: "drizzle", framework: "fastify" })).toBe(true);
  });

  it("accepts postgres-database-pg-none", () => {
    expect(isValidPreset({ database: "postgres", strategy: "database", orm: "pg", framework: "none" })).toBe(true);
  });

  it("accepts postgres-rls-knex-hono", () => {
    expect(isValidPreset({ database: "postgres", strategy: "rls", orm: "knex", framework: "hono" })).toBe(true);
  });

  it("accepts postgres-rls-sequelize-nestjs", () => {
    expect(isValidPreset({ database: "postgres", strategy: "rls", orm: "sequelize", framework: "nestjs" })).toBe(true);
  });

  // Valid MongoDB combos
  it("accepts mongodb-database-mongoose-express", () => {
    expect(isValidPreset({ database: "mongodb", strategy: "database", orm: "mongoose", framework: "express" })).toBe(true);
  });

  it("accepts mongodb-collection-mongoose-hono", () => {
    expect(isValidPreset({ database: "mongodb", strategy: "collection", orm: "mongoose", framework: "hono" })).toBe(true);
  });

  // Valid MySQL combos
  it("accepts mysql-table-prefix-pg-nextjs", () => {
    expect(isValidPreset({ database: "mysql", strategy: "table-prefix", orm: "pg", framework: "nextjs" })).toBe(true);
  });

  it("accepts mysql-database-pg-fastify", () => {
    expect(isValidPreset({ database: "mysql", strategy: "database", orm: "pg", framework: "fastify" })).toBe(true);
  });

  // @stratum-hq/mysql scopes a shared table for the raw driver, Knex and Sequelize.
  for (const orm of ["pg", "knex", "sequelize"] as const) {
    it(`accepts mysql-shared-${orm}-express`, () => {
      expect(isValidPreset({ database: "mysql", strategy: "shared", orm, framework: "express" })).toBe(true);
    });
  }

  it("parses mysql-shared-knex-nestjs", () => {
    expect(parsePresetString("mysql-shared-knex-nestjs")).toEqual({
      database: "mysql",
      strategy: "shared",
      orm: "knex",
      framework: "nestjs",
    });
  });

  // Invalid combos
  it("rejects mongodb-rls-prisma-express (rls not valid for mongodb)", () => {
    expect(isValidPreset({ database: "mongodb", strategy: "rls", orm: "prisma", framework: "express" })).toBe(false);
  });

  it("rejects mongodb-database-prisma-express (prisma not valid for mongodb)", () => {
    expect(isValidPreset({ database: "mongodb", strategy: "database", orm: "prisma", framework: "express" })).toBe(false);
  });

  it("rejects postgres-collection-prisma-express (collection not valid for postgres)", () => {
    expect(isValidPreset({ database: "postgres", strategy: "collection", orm: "prisma", framework: "express" })).toBe(false);
  });

  it("rejects mysql-rls-sequelize-express (rls not valid for mysql)", () => {
    expect(isValidPreset({ database: "mysql", strategy: "rls", orm: "sequelize", framework: "express" })).toBe(false);
  });

  // @stratum-hq/mysql has no shared-table helper for Prisma or Drizzle.
  for (const orm of ["prisma", "drizzle"] as const) {
    it(`rejects mysql-shared-${orm}-express (no shared-table helper for ${orm})`, () => {
      expect(isValidPreset({ database: "mysql", strategy: "shared", orm, framework: "express" })).toBe(false);
    });
  }

  it("rejects postgres-shared-pg-express (shared is a MySQL strategy)", () => {
    expect(isValidPreset({ database: "postgres", strategy: "shared", orm: "pg", framework: "express" })).toBe(false);
  });

  it("rejects mysql-database-mongoose-express (mongoose not valid for mysql)", () => {
    expect(isValidPreset({ database: "mysql", strategy: "database", orm: "mongoose", framework: "express" })).toBe(false);
  });

  // @stratum-hq/mysql routes a tenant's database or tables only for the raw driver.
  for (const strategy of ["database", "table-prefix"] as const) {
    for (const orm of ["sequelize", "knex"] as const) {
      it(`rejects mysql-${strategy}-${orm}-express (no ${strategy} adapter for ${orm})`, () => {
        expect(isValidPreset({ database: "mysql", strategy, orm, framework: "express" })).toBe(false);
      });
    }
  }

  // db-adapters has no schema or database adapter for these ORMs.
  for (const strategy of ["schema", "database"] as const) {
    for (const orm of ["drizzle", "sequelize", "knex"] as const) {
      it(`rejects postgres-${strategy}-${orm}-express (no ${strategy} adapter for ${orm})`, () => {
        expect(isValidPreset({ database: "postgres", strategy, orm, framework: "express" })).toBe(false);
      });
    }
  }

  it("rejects postgres-rls-mongoose-express (mongoose not valid for postgres)", () => {
    expect(isValidPreset({ database: "postgres", strategy: "rls", orm: "mongoose", framework: "express" })).toBe(false);
  });
});

// ─── getValidOptions ─────────────────────────────────────────────────────────

describe("getValidOptions", () => {
  it("returns all options when no selection made", () => {
    const opts = getValidOptions({});
    expect(opts.databases).toContain("postgres");
    expect(opts.databases).toContain("mongodb");
    expect(opts.databases).toContain("mysql");
    expect(opts.orms.length).toBeGreaterThan(0);
    expect(opts.strategies.length).toBeGreaterThan(0);
    expect(opts.frameworks.length).toBeGreaterThan(0);
  });

  it("narrows orms to mongoose when mongodb selected", () => {
    const opts = getValidOptions({ database: "mongodb" });
    expect(opts.orms).toEqual(["mongoose"]);
  });

  it("narrows strategies when mongodb selected", () => {
    const opts = getValidOptions({ database: "mongodb" });
    expect(opts.strategies).toEqual(["database", "collection"]);
  });

  it("narrows databases when mongoose selected", () => {
    const opts = getValidOptions({ orm: "mongoose" });
    expect(opts.databases).toEqual(["mongodb"]);
  });

  it("narrows databases when rls strategy selected", () => {
    const opts = getValidOptions({ strategy: "rls" });
    expect(opts.databases).toEqual(["postgres"]);
  });

  it("includes all frameworks for any database", () => {
    for (const db of ["postgres", "mongodb", "mysql"] as const) {
      const opts = getValidOptions({ database: db });
      expect(opts.frameworks).toContain("express");
      expect(opts.frameworks).toContain("none");
    }
  });

  it("narrows databases when table-prefix selected", () => {
    const opts = getValidOptions({ strategy: "table-prefix" });
    expect(opts.databases).toEqual(["mysql"]);
  });

  it("includes postgres and mysql for sequelize", () => {
    expect(getValidOptions({ orm: "sequelize" }).databases).toEqual(["postgres", "mysql"]);
  });

  it("offers only the shared strategy for mysql with knex", () => {
    expect(getValidOptions({ database: "mysql", orm: "knex" }).strategies).toEqual(["shared"]);
  });

  it("offers the raw driver, knex and sequelize for mysql shared", () => {
    expect(getValidOptions({ database: "mysql", strategy: "shared" }).orms).toEqual(["pg", "knex", "sequelize"]);
  });

  it("includes postgres and mysql for pg", () => {
    expect(getValidOptions({ orm: "pg" }).databases).toEqual(["postgres", "mysql"]);
  });
});

describe("getValidOptions with strategy and ORM pairs", () => {
  it("offers only prisma and pg for postgres schema", () => {
    expect(getValidOptions({ database: "postgres", strategy: "schema" }).orms).toEqual(["prisma", "pg"]);
  });

  it("offers only prisma and pg for postgres database", () => {
    expect(getValidOptions({ database: "postgres", strategy: "database" }).orms).toEqual(["prisma", "pg"]);
  });

  it("offers every postgres ORM for rls", () => {
    expect(getValidOptions({ database: "postgres", strategy: "rls" }).orms).toEqual(VALID_COMBINATIONS.postgres.orms);
  });

  it("offers only the rls strategy for postgres with drizzle", () => {
    expect(getValidOptions({ database: "postgres", orm: "drizzle" }).strategies).toEqual(["rls"]);
  });

  it("returns no database for postgres-only schema with drizzle", () => {
    expect(getValidOptions({ strategy: "schema", orm: "drizzle" }).databases).toEqual([]);
  });
});

describe("ormsFor", () => {
  it("returns the per-strategy ORMs when the database restricts them", () => {
    expect(ormsFor("postgres", "schema")).toEqual(["prisma", "pg"]);
    expect(ormsFor("postgres", "rls")).toEqual(VALID_COMBINATIONS.postgres.orms);
  });

  it("returns no ORM for a strategy the database does not allow", () => {
    expect(ormsFor("mongodb", "rls")).toEqual([]);
  });
});

// ─── VALID_COMBINATIONS structure ────────────────────────────────────────────

describe("VALID_COMBINATIONS", () => {
  it("has all three databases", () => {
    expect(Object.keys(VALID_COMBINATIONS)).toEqual(["postgres", "mongodb", "mysql"]);
  });

  it("postgres has rls, schema, database strategies", () => {
    expect(VALID_COMBINATIONS.postgres.strategies).toEqual(["rls", "schema", "database"]);
  });

  it("mongodb has database, collection strategies", () => {
    expect(VALID_COMBINATIONS.mongodb.strategies).toEqual(["database", "collection"]);
  });

  it("mysql has database, table-prefix, shared strategies", () => {
    expect(VALID_COMBINATIONS.mysql.strategies).toEqual(["database", "table-prefix", "shared"]);
  });

  it("mongodb only supports mongoose", () => {
    expect(VALID_COMBINATIONS.mongodb.orms).toEqual(["mongoose"]);
  });
});
