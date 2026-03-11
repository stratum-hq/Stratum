import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  tenantSchemaName,
  createSchema,
  dropSchema,
  schemaExists,
  listTenantSchemas,
  replicateTableToSchema,
} from "../schema/manager.js";
import type pg from "pg";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(queryResults: Record<string, unknown> = {}): pg.PoolClient {
  const query = vi.fn(async (sql: string) => {
    // Return the configured result or a sensible default
    for (const [pattern, result] of Object.entries(queryResults)) {
      if (sql.includes(pattern)) {
        return result;
      }
    }
    return { rows: [], rowCount: 0 };
  });
  return { query } as unknown as pg.PoolClient;
}

// ---------------------------------------------------------------------------
// tenantSchemaName
// ---------------------------------------------------------------------------

describe("tenantSchemaName", () => {
  it("prepends tenant_ to a simple slug", () => {
    expect(tenantSchemaName("acme")).toBe("tenant_acme");
  });

  it("handles slugs with underscores and digits", () => {
    expect(tenantSchemaName("acme_corp_2024")).toBe("tenant_acme_corp_2024");
  });
});

// ---------------------------------------------------------------------------
// createSchema
// ---------------------------------------------------------------------------

describe("createSchema", () => {
  it("executes CREATE SCHEMA IF NOT EXISTS with the correct name", async () => {
    const client = makeClient();
    await createSchema(client, "acme");
    expect(client.query).toHaveBeenCalledWith(
      "CREATE SCHEMA IF NOT EXISTS tenant_acme",
    );
  });

  it("rejects an invalid slug that produces an invalid schema name", async () => {
    const client = makeClient();
    // Injecting SQL-special characters via an invalid slug
    await expect(createSchema(client, "bad; DROP TABLE tenants--")).rejects.toThrow(
      "Invalid schema name",
    );
  });
});

// ---------------------------------------------------------------------------
// dropSchema
// ---------------------------------------------------------------------------

describe("dropSchema", () => {
  it("executes DROP SCHEMA IF EXISTS … CASCADE", async () => {
    const client = makeClient();
    await dropSchema(client, "acme");
    expect(client.query).toHaveBeenCalledWith(
      "DROP SCHEMA IF EXISTS tenant_acme CASCADE",
    );
  });
});

// ---------------------------------------------------------------------------
// schemaExists
// ---------------------------------------------------------------------------

describe("schemaExists", () => {
  it("returns true when count > 0", async () => {
    const client = makeClient({ pg_namespace: { rows: [{ count: "1" }], rowCount: 1 } });
    const result = await schemaExists(client, "acme");
    expect(result).toBe(true);
  });

  it("returns false when count is 0", async () => {
    const client = makeClient({ pg_namespace: { rows: [{ count: "0" }], rowCount: 1 } });
    const result = await schemaExists(client, "acme");
    expect(result).toBe(false);
  });

  it("uses parameterized query with the full schema name", async () => {
    const client = makeClient({ pg_namespace: { rows: [{ count: "0" }], rowCount: 1 } });
    await schemaExists(client, "acme");
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("pg_namespace"),
      ["tenant_acme"],
    );
  });
});

// ---------------------------------------------------------------------------
// listTenantSchemas
// ---------------------------------------------------------------------------

describe("listTenantSchemas", () => {
  it("returns schema names from pg_namespace", async () => {
    const client = makeClient({
      pg_namespace: {
        rows: [{ nspname: "tenant_acme" }, { nspname: "tenant_beta" }],
        rowCount: 2,
      },
    });
    const schemas = await listTenantSchemas(client);
    expect(schemas).toEqual(["tenant_acme", "tenant_beta"]);
  });

  it("returns empty array when no tenant schemas exist", async () => {
    const client = makeClient({
      pg_namespace: { rows: [], rowCount: 0 },
    });
    const schemas = await listTenantSchemas(client);
    expect(schemas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// replicateTableToSchema
// ---------------------------------------------------------------------------

describe("replicateTableToSchema", () => {
  it("executes CREATE TABLE … LIKE public.tableName", async () => {
    const client = makeClient();
    await replicateTableToSchema(client, "orders", "tenant_acme");
    expect(client.query).toHaveBeenCalledWith(
      "CREATE TABLE IF NOT EXISTS tenant_acme.orders (LIKE public.orders INCLUDING ALL)",
    );
  });

  it("rejects an invalid table name", async () => {
    const client = makeClient();
    await expect(
      replicateTableToSchema(client, "orders; DROP TABLE tenants--", "tenant_acme"),
    ).rejects.toThrow("Invalid table name");
  });

  it("rejects an invalid schema name", async () => {
    const client = makeClient();
    await expect(
      replicateTableToSchema(client, "orders", "bad schema name"),
    ).rejects.toThrow("Invalid schema name");
  });
});
