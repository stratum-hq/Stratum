import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { createSchema, dropSchema, tenantSchemaName } from "@stratum-hq/db-adapters";
import { getPool, closePool, runMigrations } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * SCHEMA_PER_TENANT and DB_PER_TENANT storage is named from the tenant slug.
 * A tenant's storage must never be handed to a different tenant: the slug of
 * such a tenant cannot change, and provisioning never adopts storage that
 * already exists.
 */

let stratum: Stratum;
const createdIds: string[] = [];
const schemasToDrop: string[] = [];

beforeAll(async () => {
  await runMigrations();
  stratum = new Stratum({ pool: getPool() });
});

afterAll(async () => {
  const pool = getPool();
  for (const id of createdIds) {
    await pool.query(`DELETE FROM audit_logs WHERE tenant_id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [id]).catch(() => {});
  }
  const c = await pool.connect();
  for (const slug of schemasToDrop) await dropSchema(c, slug).catch(() => {});
  c.release();
  await closePool();
});

describe("slug-keyed isolated storage (integration)", () => {
  it.each(["SCHEMA_PER_TENANT", "DB_PER_TENANT"] as const)(
    "rejects a slug change for a %s tenant",
    async (strategy) => {
      const slug = uniqueSlug("iso_keep");
      const t = await stratum.createTenant({ name: slug, slug, isolation_strategy: strategy });
      createdIds.push(t.id);

      await expect(
        stratum.updateTenant(t.id, { slug: uniqueSlug("iso_new") }),
      ).rejects.toThrow(/slug/i);
      expect((await stratum.getTenant(t.id)).slug).toBe(slug);
    },
  );

  it("still allows a slug change for a SHARED_RLS tenant", async () => {
    const slug = uniqueSlug("iso_rls");
    const t = await stratum.createTenant({ name: slug, slug });
    createdIds.push(t.id);
    const next = uniqueSlug("iso_rls_new");
    expect((await stratum.updateTenant(t.id, { slug: next })).slug).toBe(next);
  });

  it("provisioning refuses to reuse the schema of a purged tenant", async () => {
    const pool = getPool();
    const slug = uniqueSlug("iso_reuse");
    schemasToDrop.push(slug);

    const first = await stratum.createTenant({
      name: slug, slug, isolation_strategy: "SCHEMA_PER_TENANT",
    });
    const c = await pool.connect();
    try {
      await createSchema(c, slug);
      await c.query(`CREATE TABLE ${tenantSchemaName(slug)}.note (body text)`);
      await c.query(`INSERT INTO ${tenantSchemaName(slug)}.note VALUES ('first tenant data')`);

      await stratum.purgeTenant(first.id);
      const second = await stratum.createTenant({
        name: slug, slug, isolation_strategy: "SCHEMA_PER_TENANT",
      });
      createdIds.push(second.id);

      await expect(createSchema(c, slug)).rejects.toThrow(/already exists/);
    } finally {
      c.release();
    }
  });
});
