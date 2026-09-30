import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import pg from "pg";
import { Stratum } from "@stratum-hq/lib";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
} from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

// API key lifecycle against a REAL Postgres: what rotation carries over, which
// tenant states a key authenticates under, that the background key updates land
// for a role subject to row-level security, and that validation completes on a
// single pooled connection.

const HMAC_ENV_NAME = "STRATUM_API_KEY_HMAC_SECRET";
const APP_ROLE = "stratum_it_keys_app";

const TEST_DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

/** Poll until fn() returns truthy, for writes the service does not await. */
async function waitFor<T>(fn: () => Promise<T>, tries = 40, delayMs = 25): Promise<T> {
  let last: T = await fn();
  for (let i = 0; i < tries && !last; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    last = await fn();
  }
  return last;
}

async function keyRow(id: string): Promise<{
  tenant_id: string | null;
  scopes: string[];
  role_id: string | null;
  expires_at: Date | null;
  rate_limit_max: number | null;
  rate_limit_window: string | null;
  revoked_at: Date | null;
  last_used_at: Date | null;
  hash_version: number;
}> {
  const res = await getPool().query(
    `SELECT tenant_id, scopes, role_id, expires_at, rate_limit_max, rate_limit_window,
            revoked_at, last_used_at, hash_version
     FROM api_keys WHERE id = $1`,
    [id],
  );
  return res.rows[0];
}

describe("API key lifecycle (integration)", () => {
  let stratum: Stratum;

  beforeAll(async () => {
    await runMigrations();
    stratum = new Stratum({ pool: getPool() });
  });

  afterEach(async () => {
    await cleanTestData();
    delete process.env[HMAC_ENV_NAME];
  });

  afterAll(async () => {
    await closePool();
  });

  describe("rotation", () => {
    it("carries the old key's role, scopes, expiry and rate limit over to the new key", async () => {
      const tenant = await stratum.createTenant({ name: "rot", slug: uniqueSlug("rot") });
      const expiresAt = new Date(Date.now() + 7 * 86_400_000);
      const original = await stratum.createApiKey(tenant.id, {
        name: "limited",
        expiresAt,
        rateLimitMax: 10,
        rateLimitWindow: "1 minute",
      });
      await getPool().query(`UPDATE api_keys SET scopes = $2 WHERE id = $1`, [original.id, ["read"]]);
      const role = await stratum.createRole({ name: "readers", scopes: ["read"], tenant_id: tenant.id });
      await stratum.assignRoleToKey(original.id, role.id);

      const rotated = await stratum.rotateApiKey(original.id);
      const row = await keyRow(rotated.id);

      expect(row.tenant_id).toBe(tenant.id);
      expect(row.role_id).toBe(role.id);
      expect(row.scopes).toEqual(["read"]);
      expect(row.expires_at?.getTime()).toBe(expiresAt.getTime());
      expect(row.rate_limit_max).toBe(10);
      expect(row.rate_limit_window).toBe("1 minute");

      const validated = await stratum.validateApiKey(rotated.plaintext_key);
      expect(validated!.scopes).toEqual(["read"]);
      expect(validated!.rate_limit_max).toBe(10);
    });

    it("refuses to rotate an expired key", async () => {
      const tenant = await stratum.createTenant({ name: "rotexp", slug: uniqueSlug("rotexp") });
      const expired = await stratum.createApiKey(tenant.id, {
        name: "expired",
        expiresAt: new Date(Date.now() - 60_000),
      });

      await expect(stratum.rotateApiKey(expired.id)).rejects.toThrow();
      const live = await getPool().query(
        `SELECT 1 FROM api_keys WHERE tenant_id = $1 AND id <> $2`,
        [tenant.id, expired.id],
      );
      expect(live.rows).toHaveLength(0);
    });
  });

  describe("tenant status", () => {
    it("rejects a key whose tenant is suspended, and accepts it again once resumed", async () => {
      const tenant = await stratum.createTenant({ name: "susp", slug: uniqueSlug("susp") });
      const key = await stratum.createApiKey(tenant.id, "k");

      await stratum.suspendTenant(tenant.id);
      expect(await stratum.validateApiKey(key.plaintext_key)).toBeNull();

      await stratum.resumeTenant(tenant.id);
      expect(await stratum.validateApiKey(key.plaintext_key)).not.toBeNull();
    });

    it("rejects a key whose tenant is archived", async () => {
      const tenant = await stratum.createTenant({ name: "arch", slug: uniqueSlug("arch") });
      const key = await stratum.createApiKey(tenant.id, "k");

      await stratum.archiveTenant(tenant.id);
      expect(await stratum.validateApiKey(key.plaintext_key)).toBeNull();
    });

    it("rejects a key whose tenant sits under a suspended ancestor", async () => {
      const parent = await stratum.createTenant({ name: "p", slug: uniqueSlug("p") });
      const child = await stratum.createTenant({ name: "c", slug: uniqueSlug("c"), parent_id: parent.id });
      const key = await stratum.createApiKey(child.id, "k");

      // The lib refuses to leave an active tenant under a suspended one, so
      // write that state directly: the key check must not rely on it.
      await getPool().query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [parent.id]);

      expect(await stratum.validateApiKey(key.plaintext_key)).toBeNull();
    });

    it("still accepts a global key that belongs to no tenant", async () => {
      const tenant = await stratum.createTenant({ name: "g", slug: uniqueSlug("g") });
      const key = await stratum.createApiKey(tenant.id, "global");
      await getPool().query(`UPDATE api_keys SET tenant_id = NULL WHERE id = $1`, [key.id]);

      const result = await stratum.validateApiKey(key.plaintext_key);
      expect(result).not.toBeNull();
      expect(result!.tenant_id).toBeNull();
    });
  });

  describe("under a role subject to row-level security", () => {
    let appPool: pg.Pool;
    let appStratum: Stratum;

    beforeAll(async () => {
      // A non-superuser NOBYPASSRLS role, like the production stratum_app role.
      // The suite's own connection is a superuser and would hide RLS failures.
      await getPool().query(`DO $$ BEGIN
        CREATE ROLE ${APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
      await getPool().query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
      await getPool().query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
      await getPool().query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`);
      // Every connection of this pool runs as the RLS-subject role.
      appPool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 5, options: `-c role=${APP_ROLE}` });
      appStratum = new Stratum({ pool: appPool });
      const who = await appPool.query<{ rolbypassrls: boolean }>(
        `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      );
      expect(who.rows[0].rolbypassrls).toBe(false);
    });

    afterAll(async () => {
      await appPool.end();
    });

    it("stamps last_used_at on a successful validation", async () => {
      const tenant = await stratum.createTenant({ name: "rls", slug: uniqueSlug("rls") });
      const key = await stratum.createApiKey(tenant.id, "k");

      expect(await appStratum.validateApiKey(key.plaintext_key)).not.toBeNull();
      const stamped = await waitFor(async () => (await keyRow(key.id)).last_used_at);
      expect(stamped).not.toBeNull();
    });

    it("upgrades a legacy SHA-256 hash to HMAC on a successful validation", async () => {
      const tenant = await stratum.createTenant({ name: "rlsu", slug: uniqueSlug("rlsu") });
      const key = await stratum.createApiKey(tenant.id, "legacy");
      expect((await keyRow(key.id)).hash_version).toBe(1);

      process.env[HMAC_ENV_NAME] = "a8-upgrade-secret";
      expect(await appStratum.validateApiKey(key.plaintext_key)).not.toBeNull();
      const version = await waitFor(async () => {
        const v = (await keyRow(key.id)).hash_version;
        return v === 2 ? v : 0;
      });
      expect(version).toBe(2);
    });
  });

  describe("pool usage", () => {
    it("validates a role-bound key on a pool with a single connection", async () => {
      const tenant = await stratum.createTenant({ name: "pool", slug: uniqueSlug("pool") });
      const key = await stratum.createApiKey(tenant.id, "k");
      const role = await stratum.createRole({ name: "pool-readers", scopes: ["read"], tenant_id: tenant.id });
      await stratum.assignRoleToKey(key.id, role.id);

      // One connection: validation must not need a second one while it holds
      // the first. The timeout turns a would-be deadlock into a failure.
      const onePool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1, connectionTimeoutMillis: 2000 });
      try {
        const result = await new Stratum({ pool: onePool }).validateApiKey(key.plaintext_key);
        expect(result!.scopes).toEqual(["read"]);
      } finally {
        await onePool.end();
      }
    });
  });
});
