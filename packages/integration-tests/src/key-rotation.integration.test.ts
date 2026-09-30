import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import crypto from "node:crypto";
import pg from "pg";
import { Stratum } from "@stratum-hq/lib";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
} from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

// Decrypts the way lib's crypto.ts does: HKDF-SHA256 with info "stratum-aes-key"
// and the configured salt. The salt is STRATUM_HKDF_SALT (hex) when set, else the
// non-production default (NON_PRODUCTION_DEFAULT_SALT in crypto.ts). Because this
// derivation is independent of lib, a change or fault in lib's derivation fails
// the tests that use it.
const LIB_SALT = process.env.STRATUM_HKDF_SALT
  ? Buffer.from(process.env.STRATUM_HKDF_SALT, "hex")
  : Buffer.from("stratum-non-production-hkdf-salt-v1", "utf8");

function decryptAsLib(blob: string, keyMaterial: string): string {
  const key = Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(keyMaterial, "utf8"), LIB_SALT, "stratum-aes-key", 32),
  );
  const [, ivHex, authTagHex, ciphertextHex] = blob.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"), {
    authTagLength: 16,
  });
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  return decipher.update(Buffer.from(ciphertextHex, "hex")).toString("utf8") + decipher.final("utf8");
}

describe("Encryption & Key Rotation (integration)", () => {
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

  it("sensitive config values are encrypted in the database", async () => {
    const tenant = await stratum.createTenant({
      name: "Enc Test",
      slug: "enc_test",
    });
    await stratum.setConfig(tenant.id, "db_password", {
      value: "super-secret",
      locked: false,
      sensitive: true,
    });

    // Read raw value from DB — should be encrypted, not plaintext
    const pool = getPool();
    const raw = await pool.query(
      "SELECT value FROM config_entries WHERE tenant_id = $1 AND key = $2",
      [tenant.id, "db_password"],
    );
    const storedValue = raw.rows[0]?.value;
    expect(storedValue).not.toContain("super-secret");
  });

  it("key rotation re-encrypts with correct HKDF info", async () => {
    const oldKey = "old-key-material-for-testing-123";
    const newKey = "new-key-material-for-testing-456";
    const savedKey = process.env.STRATUM_ENCRYPTION_KEY;
    const tenant = await stratum.createTenant({ name: "Rotate HKDF", slug: uniqueSlug("rot_hkdf") });
    const readRaw = async (): Promise<string> => {
      const raw = await getPool().query<{ value: string }>(
        "SELECT value FROM config_entries WHERE tenant_id = $1 AND key = $2",
        [tenant.id, "api_token"],
      );
      return raw.rows[0].value;
    };

    try {
      // lib encrypts under the old key. setConfig encrypts the JSON text of the value.
      process.env.STRATUM_ENCRYPTION_KEY = oldKey;
      await stratum.setConfig(tenant.id, "api_token", { value: "secret-value", locked: false, sensitive: true });
      const before = await readRaw();
      expect(before).toContain("v1:");
      expect(JSON.parse(decryptAsLib(before, oldKey))).toBe("secret-value");

      // lib rotates with the same derivation that rotateEncryptionKey uses.
      const result = await stratum.rotateEncryptionKey(oldKey, newKey);
      expect(result.config_entries_rotated).toBe(1);
      expect(result.unreadable).toEqual([]);

      const after = await readRaw();
      expect(JSON.parse(decryptAsLib(after, newKey))).toBe("secret-value");
      expect(() => decryptAsLib(after, oldKey)).toThrow();

      // lib reads the rotated value back with the new key.
      process.env.STRATUM_ENCRYPTION_KEY = newKey;
      const resolved = await stratum.resolveConfig(tenant.id);
      expect(resolved.api_token.value).toBe("secret-value");
    } finally {
      process.env.STRATUM_ENCRYPTION_KEY = savedKey;
    }
  });
});

// Wraps the pool so that connect call number `failAt` throws. The rotation
// service opens one connection per batch, so this stops a run after the
// batches before it have committed, as a crash or a lost connection would.
function poolFailingOnConnect(pool: pg.Pool, failAt: number): pg.Pool {
  let calls = 0;
  return new Proxy(pool, {
    get(target, prop) {
      if (prop === "connect") {
        return async () => {
          calls += 1;
          if (calls === failAt) throw new Error("injected connection failure");
          return target.connect();
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("Key rotation resume after a partial failure (integration)", () => {
  const OLD_KEY = "resume-old-key-material-32chars!";
  const NEW_KEY = "resume-new-key-material-32chars!";
  const UNRELATED_KEY = "resume-unrelated-key-material-32!";
  // More than the default batch size of 100, so the run needs a second batch.
  const CONFIG_ROWS = 110;

  let stratum: Stratum;

  beforeAll(async () => {
    delete process.env.STRATUM_ENCRYPTION_KEY_PREVIOUS;
    await runMigrations();
    stratum = new Stratum({ pool: getPool() });
  });

  afterEach(async () => {
    delete process.env.STRATUM_ENCRYPTION_KEY;
    await cleanTestData();
  });

  afterAll(async () => {
    await closePool();
  });

  it("completes on a re-run after a failure and reports rows that decrypt with neither key", async () => {
    const tenant = await stratum.createTenant({ name: "Rotation Resume", slug: uniqueSlug("rot_resume") });

    process.env.STRATUM_ENCRYPTION_KEY = OLD_KEY;
    for (let i = 0; i < CONFIG_ROWS; i++) {
      await stratum.setConfig(tenant.id, `secret_${i}`, {
        value: `plaintext-${i}`,
        locked: false,
        sensitive: true,
      });
    }
    const hooks: Array<{ id: string }> = [];
    for (let i = 0; i < 2; i++) {
      hooks.push(
        await stratum.createWebhook({
          tenant_id: tenant.id,
          url: `https://example.com/hook-${i}`,
          secret: `webhook-secret-value-${i}`,
          events: ["tenant.created"],
        }),
      );
    }

    // Rows written under a key that is neither the old nor the new one.
    process.env.STRATUM_ENCRYPTION_KEY = UNRELATED_KEY;
    const badConfig = await stratum.setConfig(tenant.id, "secret_unrelated", {
      value: "plaintext-unrelated",
      locked: false,
      sensitive: true,
    });
    const badHook = await stratum.createWebhook({
      tenant_id: tenant.id,
      url: "https://example.com/hook-unrelated",
      secret: "webhook-secret-unrelated",
      events: ["tenant.created"],
    });
    process.env.STRATUM_ENCRYPTION_KEY = OLD_KEY;

    // First run: the first batch commits, then the second batch cannot connect.
    const interrupted = new Stratum({ pool: poolFailingOnConnect(getPool(), 2) });
    await expect(interrupted.rotateEncryptionKey(OLD_KEY, NEW_KEY)).rejects.toThrow(
      "injected connection failure",
    );

    // Re-run with the same keys finishes the rotation.
    const rerun = await stratum.rotateEncryptionKey(OLD_KEY, NEW_KEY);
    expect(rerun.already_rotated).toBeGreaterThan(0);
    expect(
      rerun.config_entries_rotated + rerun.webhooks_rotated + rerun.already_rotated + rerun.unreadable.length,
    ).toBe(CONFIG_ROWS + 1 + hooks.length + 1);
    expect(rerun.unreadable).toEqual(
      expect.arrayContaining([
        { table: "config_entries", id: badConfig.id },
        { table: "webhooks", id: badHook.id },
      ]),
    );
    expect(rerun.unreadable).toHaveLength(2);

    // Every other row now decrypts with the new key to its original plaintext.
    // setConfig encrypts the JSON text of a config value, so the test parses it.
    const configRows = await getPool().query<{ key: string; value: string }>(
      `SELECT key, value FROM config_entries WHERE tenant_id = $1 AND key <> 'secret_unrelated'`,
      [tenant.id],
    );
    expect(configRows.rows).toHaveLength(CONFIG_ROWS);
    for (const row of configRows.rows) {
      expect(JSON.parse(decryptAsLib(row.value, NEW_KEY))).toBe(`plaintext-${row.key.slice("secret_".length)}`);
    }
    const hookRows = await getPool().query<{ url: string; secret_hash: string }>(
      `SELECT url, secret_hash FROM webhooks WHERE id = ANY($1::uuid[])`,
      [hooks.map((h) => h.id)],
    );
    expect(hookRows.rows).toHaveLength(hooks.length);
    for (const row of hookRows.rows) {
      expect(decryptAsLib(row.secret_hash, NEW_KEY)).toBe(`webhook-secret-value-${row.url.slice(-1)}`);
    }

    // The unreadable rows stay unchanged, so the unrelated key still opens them.
    const badRaw = await getPool().query<{ value: string }>(
      `SELECT value FROM config_entries WHERE id = $1`,
      [badConfig.id],
    );
    expect(JSON.parse(decryptAsLib(badRaw.rows[0].value, UNRELATED_KEY))).toBe("plaintext-unrelated");

    // A third run finds nothing left to rotate.
    const again = await stratum.rotateEncryptionKey(OLD_KEY, NEW_KEY);
    expect(again.config_entries_rotated).toBe(0);
    expect(again.webhooks_rotated).toBe(0);
    expect(again.already_rotated).toBe(CONFIG_ROWS + hooks.length);
    expect(again.unreadable).toHaveLength(2);
  });
});

describe("Key rotation with an old key that opens no value (integration)", () => {
  const OLD_KEY = "wrongkey-old-key-material-32char";
  const NEW_KEY = "wrongkey-new-key-material-32char";
  const WRONG_KEY = "wrongkey-typo-key-material-32chr";

  let pool: pg.Pool;

  beforeAll(async () => {
    delete process.env.STRATUM_ENCRYPTION_KEY_PREVIOUS;
    await runMigrations();
    pool = getPool();
  });

  afterEach(async () => {
    delete process.env.STRATUM_ENCRYPTION_KEY;
    await cleanTestData();
  });

  afterAll(async () => {
    await closePool();
  });

  function recordingLogger() {
    const warnings: Array<{ msg: string; ctx?: Record<string, unknown> }> = [];
    return {
      warnings,
      logger: {
        info: () => {},
        error: () => {},
        warn: (msg: string, ctx?: Record<string, unknown>) => warnings.push({ msg, ctx }),
      },
    };
  }

  it("rejects the rotation, leaves every row unchanged, and logs no success", async () => {
    const { warnings, logger } = recordingLogger();
    const stratum = new Stratum({ pool, logger });
    const tenant = await stratum.createTenant({ name: "Rotation Wrong Key", slug: uniqueSlug("rot_wrong") });

    process.env.STRATUM_ENCRYPTION_KEY = OLD_KEY;
    const config = await stratum.setConfig(tenant.id, "db_password", {
      value: "super-secret",
      locked: false,
      sensitive: true,
    });
    const hook = await stratum.createWebhook({
      tenant_id: tenant.id,
      url: "https://example.com/hook-wrong-key",
      secret: "webhook-secret-wrong-key",
      events: ["tenant.created"],
    });
    const readRaw = async () => ({
      config: (await pool.query<{ value: string }>(`SELECT value FROM config_entries WHERE id = $1`, [config.id]))
        .rows[0].value,
      hook: (await pool.query<{ secret_hash: string }>(`SELECT secret_hash FROM webhooks WHERE id = $1`, [hook.id]))
        .rows[0].secret_hash,
    });
    const before = await readRaw();

    await expect(stratum.rotateEncryptionKey(WRONG_KEY, NEW_KEY)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 400,
    });

    expect(await readRaw()).toEqual(before);
    expect(JSON.parse(decryptAsLib(before.config, OLD_KEY))).toBe("super-secret");
    expect(warnings.map((w) => w.msg)).not.toContain("encryption key rotated");
  });

  it("logs a distinct warning when some rows decrypt with neither key", async () => {
    const { warnings, logger } = recordingLogger();
    const stratum = new Stratum({ pool, logger });
    const tenant = await stratum.createTenant({ name: "Rotation Partial", slug: uniqueSlug("rot_partial") });

    process.env.STRATUM_ENCRYPTION_KEY = OLD_KEY;
    await stratum.setConfig(tenant.id, "readable", { value: "a", locked: false, sensitive: true });
    process.env.STRATUM_ENCRYPTION_KEY = WRONG_KEY;
    const bad = await stratum.setConfig(tenant.id, "unreadable", { value: "b", locked: false, sensitive: true });

    const result = await stratum.rotateEncryptionKey(OLD_KEY, NEW_KEY);

    expect(result.config_entries_rotated).toBe(1);
    expect(result.unreadable).toEqual([{ table: "config_entries", id: bad.id }]);
    const unreadableWarning = warnings.find((w) => w.msg === "encryption key rotation left unreadable rows");
    expect(unreadableWarning?.ctx).toMatchObject({ unreadable: 1 });
  });
});
