import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import crypto from "node:crypto";
import { Stratum } from "@stratum-hq/lib";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
} from "./helpers/db.js";

// Exercises the API key + role services against a REAL Postgres. These cover the
// behavior the mocked unit tests cannot: that only a hash is persisted, that
// validateApiKey resolves/rejects against the actual table (revoked, expired,
// tampered, rotated), that scopes and tenant binding are what the schema stores,
// and that role assignment resolves through the api_keys.role_id join.

const HMAC_SECRET_ENV = "STRATUM_API_KEY_HMAC_SECRET";
const PREFIX = "sk_live_"; // Stratum's default keyPrefix

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function hmacSha256(input: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(input).digest("hex");
}

/** Poll until fn() returns truthy, for fire-and-forget writes the service does not await. */
async function waitFor<T>(
  fn: () => Promise<T>,
  tries = 40,
  delayMs = 25,
): Promise<T> {
  let last: T = await fn();
  for (let i = 0; i < tries && !last; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    last = await fn();
  }
  return last;
}

async function rawKeyRow(id: string): Promise<{
  key_hash: string;
  key_prefix: string | null;
  name: string | null;
  tenant_id: string | null;
  scopes: string[];
  hash_version: number;
  revoked_at: Date | null;
  last_used_at: Date | null;
  expires_at: Date | null;
}> {
  const res = await getPool().query(
    `SELECT key_hash, key_prefix, name, tenant_id, scopes, hash_version, revoked_at, last_used_at, expires_at
     FROM api_keys WHERE id = $1`,
    [id],
  );
  return res.rows[0];
}

describe("API key service (integration)", () => {
  let stratum: Stratum;

  beforeAll(async () => {
    await runMigrations();
    stratum = new Stratum({ pool: getPool() });
  });

  afterEach(async () => {
    await cleanTestData();
    delete process.env[HMAC_SECRET_ENV];
  });

  afterAll(async () => {
    await closePool();
  });

  async function makeTenant(slug: string): Promise<{ id: string }> {
    return stratum.createTenant({ name: slug, slug });
  }

  describe("createApiKey — hashing & storage", () => {
    it("returns a plaintext key with the prefix but stores only its hash", async () => {
      const tenant = await makeTenant("apikey_store");
      const created = await stratum.createApiKey(tenant.id, "primary");

      expect(created.plaintext_key.startsWith(PREFIX)).toBe(true);

      const row = await rawKeyRow(created.id);
      expect(row.key_hash).not.toBe(created.plaintext_key);
      expect(row.key_hash).toBe(sha256(created.plaintext_key));
      // The raw key must not be recoverable from any stored column.
      expect(row.key_hash).not.toContain(created.plaintext_key);
      expect(row.key_prefix).toBe(PREFIX);
    });

    it("binds the key to its tenant and records name + prefix", async () => {
      const tenant = await makeTenant("apikey_bind");
      const created = await stratum.createApiKey(tenant.id, "named-key");

      const row = await rawKeyRow(created.id);
      expect(row.tenant_id).toBe(tenant.id);
      expect(row.name).toBe("named-key");
      expect(row.key_prefix).toBe(PREFIX);
    });

    it("defaults new keys to read+write scopes", async () => {
      const tenant = await makeTenant("apikey_scopes");
      const created = await stratum.createApiKey(tenant.id, "k");
      const row = await rawKeyRow(created.id);
      expect(row.scopes).toEqual(["read", "write"]);
    });

    it("tags the hash as version 1 (SHA-256) when no HMAC secret is set", async () => {
      const tenant = await makeTenant("apikey_v1");
      const created = await stratum.createApiKey(tenant.id, "k");
      const row = await rawKeyRow(created.id);
      expect(row.hash_version).toBe(1);
    });

    it("uses HMAC-SHA256 (version 2) when an HMAC secret is set", async () => {
      process.env[HMAC_SECRET_ENV] = "integration-hmac-secret";
      const tenant = await makeTenant("apikey_v2");
      const created = await stratum.createApiKey(tenant.id, "k");
      const row = await rawKeyRow(created.id);
      expect(row.hash_version).toBe(2);
      expect(row.key_hash).toBe(
        hmacSha256(created.plaintext_key, "integration-hmac-secret"),
      );
    });

    it("gives every key a unique hash", async () => {
      const tenant = await makeTenant("apikey_uniq");
      const a = await stratum.createApiKey(tenant.id, "a");
      const b = await stratum.createApiKey(tenant.id, "b");
      expect(a.id).not.toBe(b.id);
      const [ra, rb] = [await rawKeyRow(a.id), await rawKeyRow(b.id)];
      expect(ra.key_hash).not.toBe(rb.key_hash);
    });
  });

  describe("validateApiKey", () => {
    it("resolves a valid key to its id, tenant, and scopes", async () => {
      const tenant = await makeTenant("apikey_valid");
      const created = await stratum.createApiKey(tenant.id, "k");

      const result = await stratum.validateApiKey(created.plaintext_key);
      expect(result).not.toBeNull();
      expect(result!.key_id).toBe(created.id);
      expect(result!.tenant_id).toBe(tenant.id);
      expect(result!.scopes).toEqual(["read", "write"]);
    });

    it("rejects an unknown key", async () => {
      await makeTenant("apikey_unknown");
      const result = await stratum.validateApiKey(`${PREFIX}not-a-real-key`);
      expect(result).toBeNull();
    });

    it("rejects a key that is one character off from a valid one", async () => {
      const tenant = await makeTenant("apikey_tamper");
      const created = await stratum.createApiKey(tenant.id, "k");
      const tampered =
        created.plaintext_key.slice(0, -1) +
        (created.plaintext_key.endsWith("a") ? "b" : "a");
      expect(await stratum.validateApiKey(tampered)).toBeNull();
    });

    it("rejects a revoked key", async () => {
      const tenant = await makeTenant("apikey_revoked");
      const created = await stratum.createApiKey(tenant.id, "k");

      expect(await stratum.revokeApiKey(created.id)).toBe(true);
      expect(await stratum.validateApiKey(created.plaintext_key)).toBeNull();
    });

    it("rejects an expired key but accepts one expiring in the future", async () => {
      const tenant = await makeTenant("apikey_expiry");
      const expired = await stratum.createApiKey(tenant.id, {
        name: "expired",
        expiresAt: new Date(Date.now() - 60_000),
      });
      const future = await stratum.createApiKey(tenant.id, {
        name: "future",
        expiresAt: new Date(Date.now() + 3_600_000),
      });

      expect(await stratum.validateApiKey(expired.plaintext_key)).toBeNull();
      expect(await stratum.validateApiKey(future.plaintext_key)).not.toBeNull();
    });

    it("stamps last_used_at on a successful validation", async () => {
      const tenant = await makeTenant("apikey_lastused");
      const created = await stratum.createApiKey(tenant.id, "k");
      expect((await rawKeyRow(created.id)).last_used_at).toBeNull();

      await stratum.validateApiKey(created.plaintext_key);
      // The update is fire-and-forget; poll for it.
      const stamped = await waitFor(
        async () => (await rawKeyRow(created.id)).last_used_at,
      );
      expect(stamped).not.toBeNull();
    });

    it("returns the scopes column verbatim, including admin", async () => {
      const tenant = await makeTenant("apikey_admin");
      const created = await stratum.createApiKey(tenant.id, "k");
      await getPool().query(`UPDATE api_keys SET scopes = $1 WHERE id = $2`, [
        ["admin"],
        created.id,
      ]);

      const result = await stratum.validateApiKey(created.plaintext_key);
      expect(result!.scopes).toEqual(["admin"]);
    });

    it("keeps keys of different tenants isolated", async () => {
      const tenantA = await makeTenant("apikey_iso_a");
      const tenantB = await makeTenant("apikey_iso_b");
      const keyA = await stratum.createApiKey(tenantA.id, "a");
      const keyB = await stratum.createApiKey(tenantB.id, "b");

      expect(
        (await stratum.validateApiKey(keyA.plaintext_key))!.tenant_id,
      ).toBe(tenantA.id);
      expect(
        (await stratum.validateApiKey(keyB.plaintext_key))!.tenant_id,
      ).toBe(tenantB.id);
    });
  });

  describe("HMAC transparent upgrade", () => {
    it("still validates a legacy SHA-256 key after a secret is set, and upgrades its stored hash to HMAC", async () => {
      // Create while no secret is configured -> stored as SHA-256 (v1).
      const tenant = await makeTenant("apikey_upgrade");
      const created = await stratum.createApiKey(tenant.id, "legacy");
      expect((await rawKeyRow(created.id)).hash_version).toBe(1);

      // Now configure an HMAC secret and validate: the SHA-256 fallback must
      // still match, and the row should be transparently re-hashed to HMAC (v2).
      process.env[HMAC_SECRET_ENV] = "upgrade-secret";
      const result = await stratum.validateApiKey(created.plaintext_key);
      expect(result).not.toBeNull();
      expect(result!.key_id).toBe(created.id);

      const version = await waitFor(async () => {
        const row = await rawKeyRow(created.id);
        return row.hash_version === 2 ? row.hash_version : 0;
      });
      expect(version).toBe(2);
      const upgraded = await rawKeyRow(created.id);
      expect(upgraded.key_hash).toBe(
        hmacSha256(created.plaintext_key, "upgrade-secret"),
      );
    });
  });

  describe("rotateApiKey", () => {
    it("issues a new key on the same tenant and revokes the old one", async () => {
      const tenant = await makeTenant("apikey_rotate");
      const original = await stratum.createApiKey(tenant.id, "orig");

      const rotated = await stratum.rotateApiKey(original.id, "rotated");
      expect(rotated.id).not.toBe(original.id);
      expect(rotated.tenant_id).toBe(tenant.id);

      // Old key no longer validates; new one does and is bound to the same tenant.
      expect(await stratum.validateApiKey(original.plaintext_key)).toBeNull();
      const newResult = await stratum.validateApiKey(rotated.plaintext_key);
      expect(newResult!.tenant_id).toBe(tenant.id);
      expect((await rawKeyRow(original.id)).revoked_at).not.toBeNull();
    });

    it("refuses to rotate an already-revoked key", async () => {
      const tenant = await makeTenant("apikey_rotate_revoked");
      const created = await stratum.createApiKey(tenant.id, "k");
      await stratum.revokeApiKey(created.id);
      await expect(stratum.rotateApiKey(created.id)).rejects.toThrow();
    });

    it("refuses to rotate a key that does not exist", async () => {
      await makeTenant("apikey_rotate_ghost");
      await expect(stratum.rotateApiKey(crypto.randomUUID())).rejects.toThrow();
    });
  });

  describe("scopes & role assignment", () => {
    it("resolveKeyScopes falls back to the key's own scopes when no role is assigned", async () => {
      const tenant = await makeTenant("scope_norole");
      const created = await stratum.createApiKey(tenant.id, "k");
      expect(await stratum.resolveKeyScopes(created.id)).toEqual([
        "read",
        "write",
      ]);
    });

    it("a role's scopes override the key's own scopes", async () => {
      const tenant = await makeTenant("scope_role");
      const created = await stratum.createApiKey(tenant.id, "k");
      const role = await stratum.createRole({
        name: "admins",
        scopes: ["admin"],
        tenant_id: tenant.id,
      });

      expect(await stratum.assignRoleToKey(created.id, role.id)).toBe(true);
      expect(await stratum.resolveKeyScopes(created.id)).toEqual(["admin"]);
    });

    it("removing the role reverts to the key's own scopes", async () => {
      const tenant = await makeTenant("scope_role_remove");
      const created = await stratum.createApiKey(tenant.id, "k");
      const role = await stratum.createRole({
        name: "writers",
        scopes: ["read", "write"],
        tenant_id: tenant.id,
      });
      await stratum.assignRoleToKey(created.id, role.id);

      expect(await stratum.removeRoleFromKey(created.id)).toBe(true);
      expect(await stratum.resolveKeyScopes(created.id)).toEqual([
        "read",
        "write",
      ]);
    });

    it("refuses to assign a role to a revoked key", async () => {
      const tenant = await makeTenant("scope_revoked");
      const created = await stratum.createApiKey(tenant.id, "k");
      const role = await stratum.createRole({
        name: "role_rev",
        scopes: ["admin"],
        tenant_id: tenant.id,
      });
      await stratum.revokeApiKey(created.id);

      expect(await stratum.assignRoleToKey(created.id, role.id)).toBe(false);
    });

    it("validateApiKey and resolveKeyScopes resolve an assigned role identically (single source)", async () => {
      const tenant = await makeTenant("scope_unified");
      const created = await stratum.createApiKey(tenant.id, "k");
      const role = await stratum.createRole({
        name: "elevated",
        scopes: ["admin"],
        tenant_id: tenant.id,
      });
      await stratum.assignRoleToKey(created.id, role.id);

      // The role now governs at the auth boundary too, not just resolveKeyScopes.
      const validated = await stratum.validateApiKey(created.plaintext_key);
      expect(validated!.scopes).toEqual(["admin"]);
      expect(await stratum.resolveKeyScopes(created.id)).toEqual(["admin"]);
    });

    it("a narrow role narrows a key with broader column scopes at both call sites", async () => {
      const tenant = await makeTenant("scope_narrow");
      // Column scopes are read+write; the assigned role is read-only.
      const created = await stratum.createApiKey(tenant.id, "k");
      expect((await rawKeyRow(created.id)).scopes).toEqual(["read", "write"]);
      const role = await stratum.createRole({
        name: "readers",
        scopes: ["read"],
        tenant_id: tenant.id,
      });
      await stratum.assignRoleToKey(created.id, role.id);

      // The role wins even though it is NARROWER than the key's own column.
      const validated = await stratum.validateApiKey(created.plaintext_key);
      expect(validated!.scopes).toEqual(["read"]);
      expect(await stratum.resolveKeyScopes(created.id)).toEqual(["read"]);
    });

    it("a key with no role authorizes by its column scopes at both call sites", async () => {
      const tenant = await makeTenant("scope_norole_unified");
      const created = await stratum.createApiKey(tenant.id, "k");

      const validated = await stratum.validateApiKey(created.plaintext_key);
      expect(validated!.scopes).toEqual(["read", "write"]);
      expect(await stratum.resolveKeyScopes(created.id)).toEqual([
        "read",
        "write",
      ]);
    });
  });

  describe("principal role assignment (tenant scoping)", () => {
    it("refuses a foreign tenant's role but allows own-tenant and global roles", async () => {
      const tenantA = await makeTenant("prin_a");
      const tenantB = await makeTenant("prin_b");
      const roleA = await stratum.createRole({
        name: "role_a",
        scopes: ["admin"],
        tenant_id: tenantA.id,
      });
      const globalRole = await stratum.createRole({
        name: "role_global",
        scopes: ["read"],
        tenant_id: null,
      });

      // tenantB cannot be granted tenantA's role.
      expect(await stratum.assignRole("user", "u1", roleA.id, tenantB.id)).toBe(
        false,
      );
      // tenantA can grant its own role.
      expect(await stratum.assignRole("user", "u1", roleA.id, tenantA.id)).toBe(
        true,
      );
      // Global roles are grantable regardless of the scoping tenant.
      expect(
        await stratum.assignRole("user", "u2", globalRole.id, tenantB.id),
      ).toBe(true);
    });

    it("resolvePrincipalScopes fails closed for an unassigned principal and honors tenant scoping", async () => {
      const tenantA = await makeTenant("prin_scope_a");
      const tenantB = await makeTenant("prin_scope_b");
      const roleA = await stratum.createRole({
        name: "role_scope_a",
        scopes: ["admin"],
        tenant_id: tenantA.id,
      });
      await stratum.assignRole("user", "u1", roleA.id, tenantA.id);

      expect(
        await stratum.resolvePrincipalScopes("user", "u1", tenantA.id),
      ).toEqual(["admin"]);
      // No assignment -> empty (fail closed), not null.
      expect(
        await stratum.resolvePrincipalScopes("user", "nobody", tenantA.id),
      ).toEqual([]);
      // Same principal, but resolved under a foreign tenant -> role filtered out.
      expect(
        await stratum.resolvePrincipalScopes("user", "u1", tenantB.id),
      ).toEqual([]);
    });
  });
});
