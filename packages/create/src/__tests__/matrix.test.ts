import { describe, it, expect } from "vitest";
import {
  parsePresetString,
  formatPresetString,
  isValidPreset,
  getValidOptions,
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

  it("accepts postgres-schema-drizzle-fastify", () => {
    expect(isValidPreset({ database: "postgres", strategy: "schema", orm: "drizzle", framework: "fastify" })).toBe(true);
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
  it("accepts mysql-database-sequelize-express", () => {
    expect(isValidPreset({ database: "mysql", strategy: "database", orm: "sequelize", framework: "express" })).toBe(true);
  });

  it("accepts mysql-table-prefix-knex-nextjs", () => {
    expect(isValidPreset({ database: "mysql", strategy: "table-prefix", orm: "knex", framework: "nextjs" })).toBe(true);
  });

  it("accepts mysql-database-pg-fastify", () => {
    expect(isValidPreset({ database: "mysql", strategy: "database", orm: "pg", framework: "fastify" })).toBe(true);
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

  it("rejects mysql-database-mongoose-express (mongoose not valid for mysql)", () => {
    expect(isValidPreset({ database: "mysql", strategy: "database", orm: "mongoose", framework: "express" })).toBe(false);
  });

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
    const opts = getValidOptions({ orm: "sequelize" });
    expect(opts.databases).toContain("postgres");
    expect(opts.databases).toContain("mysql");
    expect(opts.databases).not.toContain("mongodb");
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

  it("mysql has database, table-prefix strategies", () => {
    expect(VALID_COMBINATIONS.mysql.strategies).toEqual(["database", "table-prefix"]);
  });

  it("mongodb only supports mongoose", () => {
    expect(VALID_COMBINATIONS.mongodb.orms).toEqual(["mongoose"]);
  });
});
