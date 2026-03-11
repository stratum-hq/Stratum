import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getDatabaseName,
  databaseExists,
  createDatabase,
  dropDatabase,
} from "../database/manager.js";
import pg from "pg";

// ---------------------------------------------------------------------------
// getDatabaseName
// ---------------------------------------------------------------------------

describe("getDatabaseName", () => {
  it("returns correct name for a simple slug", () => {
    expect(getDatabaseName("acme")).toBe("stratum_tenant_acme");
  });

  it("handles slugs with numbers and underscores", () => {
    expect(getDatabaseName("acme_corp_2")).toBe("stratum_tenant_acme_corp_2");
  });

  it("throws on slug with hyphens", () => {
    expect(() => getDatabaseName("acme-corp")).toThrow(/Invalid tenant slug/);
  });

  it("throws on slug starting with a number", () => {
    expect(() => getDatabaseName("1acme")).toThrow(/Invalid tenant slug/);
  });

  it("throws on empty slug", () => {
    expect(() => getDatabaseName("")).toThrow(/Invalid tenant slug/);
  });

  it("throws on slug with uppercase letters", () => {
    expect(() => getDatabaseName("Acme")).toThrow(/Invalid tenant slug/);
  });

  it("throws on slug that is too long (> 63 chars)", () => {
    // 64 chars: 'a' + 63 'x'
    const longSlug = "a" + "x".repeat(63);
    expect(() => getDatabaseName(longSlug)).toThrow(/Invalid tenant slug/);
  });

  it("accepts maximum-length slug (63 chars)", () => {
    const maxSlug = "a" + "x".repeat(62); // 63 chars total
    expect(getDatabaseName(maxSlug)).toBe(`stratum_tenant_${maxSlug}`);
  });
});

// ---------------------------------------------------------------------------
// databaseExists
// ---------------------------------------------------------------------------

describe("databaseExists", () => {
  function makeClient(exists: boolean): pg.PoolClient {
    return {
      query: vi.fn().mockResolvedValue({ rows: [{ exists }] }),
    } as unknown as pg.PoolClient;
  }

  it("returns true when database exists", async () => {
    const client = makeClient(true);
    const result = await databaseExists(client, "acme");
    expect(result).toBe(true);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("pg_database"),
      ["stratum_tenant_acme"],
    );
  });

  it("returns false when database does not exist", async () => {
    const client = makeClient(false);
    const result = await databaseExists(client, "acme");
    expect(result).toBe(false);
  });

  it("throws on invalid slug", async () => {
    const client = makeClient(false);
    await expect(databaseExists(client, "bad-slug")).rejects.toThrow(
      /Invalid tenant slug/,
    );
  });
});

// ---------------------------------------------------------------------------
// createDatabase
// ---------------------------------------------------------------------------

describe("createDatabase", () => {
  function makeClient(): pg.PoolClient {
    return {
      query: vi.fn().mockResolvedValue({}),
    } as unknown as pg.PoolClient;
  }

  it("issues CREATE DATABASE with correct name", async () => {
    const client = makeClient();
    await createDatabase(client, "acme");
    expect(client.query).toHaveBeenCalledWith(
      'CREATE DATABASE "stratum_tenant_acme"',
    );
  });

  it("includes TEMPLATE clause when templateDb is provided", async () => {
    const client = makeClient();
    await createDatabase(client, "acme", "stratum_base");
    expect(client.query).toHaveBeenCalledWith(
      'CREATE DATABASE "stratum_tenant_acme" TEMPLATE "stratum_base"',
    );
  });

  it("throws on invalid template database name", async () => {
    const client = makeClient();
    await expect(
      createDatabase(client, "acme", "bad-template!"),
    ).rejects.toThrow(/Invalid template database name/);
    expect(client.query).not.toHaveBeenCalled();
  });

  it("throws on invalid slug", async () => {
    const client = makeClient();
    await expect(createDatabase(client, "bad-slug")).rejects.toThrow(
      /Invalid tenant slug/,
    );
  });
});

// ---------------------------------------------------------------------------
// dropDatabase
// ---------------------------------------------------------------------------

describe("dropDatabase", () => {
  function makeClient(): pg.PoolClient {
    return {
      query: vi.fn().mockResolvedValue({}),
    } as unknown as pg.PoolClient;
  }

  it("issues DROP DATABASE IF EXISTS with correct name", async () => {
    const client = makeClient();
    await dropDatabase(client, "acme");
    expect(client.query).toHaveBeenCalledWith(
      'DROP DATABASE IF EXISTS "stratum_tenant_acme"',
    );
  });

  it("throws on invalid slug", async () => {
    const client = makeClient();
    await expect(dropDatabase(client, "bad slug")).rejects.toThrow(
      /Invalid tenant slug/,
    );
  });
});
