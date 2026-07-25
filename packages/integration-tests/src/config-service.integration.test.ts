import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { ConfigNotFoundError } from "@stratum-hq/core";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";
import { tenantInput, uniqueSlug } from "./helpers/fixtures.js";

/**
 * Config behaviors that need a real database: the ON CONFLICT upsert against the
 * UNIQUE(tenant_id, key) constraint, partial success within a single
 * batchSetConfig transaction, nearest-ancestor inheritance resolved over a real
 * ancestry_path, and that a sensitive value is stored encrypted yet decrypts
 * correctly when inherited by a descendant.
 */
describe("config-service against real Postgres (integration)", () => {
  let stratum: Stratum;

  beforeAll(async () => {
    process.env.STRATUM_ENCRYPTION_KEY = "test-encryption-key-32chars-long!";
    await runMigrations();
    stratum = new Stratum({ pool: getPool() });
  });

  afterEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    delete process.env.STRATUM_ENCRYPTION_KEY;
    await closePool();
  });

  const set = (id: string, key: string, value: unknown, locked = false, sensitive = false) =>
    stratum.setConfig(id, key, { value, locked, sensitive });

  it("upserts on the UNIQUE(tenant_id, key) constraint instead of inserting a duplicate", async () => {
    const t = await stratum.createTenant(tenantInput({ name: "T", slug: uniqueSlug("cfgu") }));

    await set(t.id, "max_users", 10);
    await set(t.id, "max_users", 25);

    const rows = await getPool().query<{ n: string; value: string }>(
      `SELECT COUNT(*)::text AS n, MAX(value::text) AS value
       FROM config_entries WHERE tenant_id = $1 AND key = 'max_users'`,
      [t.id],
    );
    expect(rows.rows[0].n).toBe("1"); // upserted, not duplicated
    expect((await stratum.resolveConfig(t.id)).max_users.value).toBe(25);
  });

  it("commits the unlocked keys of a batch while rejecting the locked one, in one transaction", async () => {
    const root = await stratum.createTenant(tenantInput({ name: "Root", slug: uniqueSlug("bsr") }));
    const child = await stratum.createTenant(
      tenantInput({ name: "Child", slug: uniqueSlug("bsc"), parent_id: root.id }),
    );
    await set(root.id, "locked_key", 100, /* locked */ true);

    const result = await stratum.batchSetConfig(child.id, [
      { key: "locked_key", value: 1 },
      { key: "free_key_a", value: 2 },
      { key: "free_key_b", value: 3 },
    ]);

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.results.find((r) => r.key === "locked_key")?.status).toBe("error");

    // The two unlocked keys really persisted for the child...
    const childRows = await getPool().query<{ key: string }>(
      `SELECT key FROM config_entries WHERE tenant_id = $1 ORDER BY key`,
      [child.id],
    );
    expect(childRows.rows.map((r) => r.key)).toEqual(["free_key_a", "free_key_b"]);

    // ...and the locked key still resolves to the ancestor's locked value.
    const resolved = await stratum.resolveConfig(child.id);
    expect(resolved.locked_key.value).toBe(100);
    expect(resolved.locked_key.locked).toBe(true);
    expect(resolved.free_key_a.value).toBe(2);
  });

  it("deleteConfig removes the override and re-exposes the inherited parent value", async () => {
    const root = await stratum.createTenant(tenantInput({ name: "Root", slug: uniqueSlug("delr") }));
    const child = await stratum.createTenant(
      tenantInput({ name: "Child", slug: uniqueSlug("delc"), parent_id: root.id }),
    );
    await set(root.id, "theme", "dark");
    await set(child.id, "theme", "light");

    expect((await stratum.resolveConfig(child.id)).theme.value).toBe("light");

    await stratum.deleteConfig(child.id, "theme");

    const resolved = await stratum.resolveConfig(child.id);
    expect(resolved.theme.value).toBe("dark");
    expect(resolved.theme.inherited).toBe(true);
    expect(resolved.theme.source_tenant_id).toBe(root.id);

    await expect(stratum.deleteConfig(child.id, "theme")).rejects.toThrow(
      ConfigNotFoundError,
    );
  });

  it("resolves the nearest ancestor's value down a three-level chain", async () => {
    const root = await stratum.createTenant(tenantInput({ name: "Root", slug: uniqueSlug("nar") }));
    const mid = await stratum.createTenant(
      tenantInput({ name: "Mid", slug: uniqueSlug("nam"), parent_id: root.id }),
    );
    const leaf = await stratum.createTenant(
      tenantInput({ name: "Leaf", slug: uniqueSlug("nal"), parent_id: mid.id }),
    );

    await set(root.id, "tier", "root");
    await set(mid.id, "tier", "mid");

    const resolved = await stratum.resolveConfig(leaf.id);
    expect(resolved.tier.value).toBe("mid"); // nearest ancestor wins
    expect(resolved.tier.source_tenant_id).toBe(mid.id);
    expect(resolved.tier.inherited).toBe(true);
  });

  it("stores a sensitive value encrypted at rest and resolveConfig decrypts it back", async () => {
    const t = await stratum.createTenant(tenantInput({ name: "T", slug: uniqueSlug("sens") }));
    await set(t.id, "api_token", "s3cr3t-value", /* locked */ false, /* sensitive */ true);

    // At rest the raw column holds ciphertext, never the plaintext.
    const raw = await getPool().query<{ value: string }>(
      `SELECT value::text AS value FROM config_entries WHERE tenant_id = $1 AND key = 'api_token'`,
      [t.id],
    );
    expect(raw.rows[0].value).not.toContain("s3cr3t-value");
    expect(raw.rows[0].value).toContain("v1:");

    // setConfig stores the ciphertext single-JSON-encoded and the pg driver
    // parses the JSONB back to that string on read, so resolveConfig decrypts
    // it once and returns the original plaintext. (Regression guard for the
    // double-parse that used to throw here and in key-rotation-service.)
    const resolved = await stratum.resolveConfig(t.id);
    expect(resolved.api_token.value).toBe("s3cr3t-value");
  });

  it("rotates the encryption key for a sensitive value and still resolves the original plaintext", async () => {
    const originalKey = process.env.STRATUM_ENCRYPTION_KEY as string;
    const newKey = "rotated-encryption-key-32chars!!";
    const t = await stratum.createTenant(tenantInput({ name: "T", slug: uniqueSlug("rot") }));
    await set(t.id, "api_token", "s3cr3t-value", /* locked */ false, /* sensitive */ true);

    try {
      const result = await stratum.rotateEncryptionKey(originalKey, newKey);
      expect(result.config_entries_rotated).toBe(1);

      // Re-encrypted at rest under the new key — still ciphertext, never plaintext.
      const raw = await getPool().query<{ value: string }>(
        `SELECT value::text AS value FROM config_entries WHERE tenant_id = $1 AND key = 'api_token'`,
        [t.id],
      );
      expect(raw.rows[0].value).not.toContain("s3cr3t-value");
      expect(raw.rows[0].value).toContain("v1:");

      // resolveConfig, now using the rotated key, decrypts back to the original.
      process.env.STRATUM_ENCRYPTION_KEY = newKey;
      const resolved = await stratum.resolveConfig(t.id);
      expect(resolved.api_token.value).toBe("s3cr3t-value");
    } finally {
      process.env.STRATUM_ENCRYPTION_KEY = originalKey;
    }
  });
});
