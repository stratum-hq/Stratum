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

function hkdfDeriveKey(keyMaterial: string, info = "stratum-aes-key"): Buffer {
  const salt = Buffer.alloc(32, 0);
  return Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(keyMaterial, "utf8"), salt, info, 32),
  );
}

function encryptWithKey(plaintext: string, keyMaterial: string): string {
  const key = hkdfDeriveKey(keyMaterial);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: 16,
  });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptWithKey(blob: string, keyMaterial: string): string {
  const key = hkdfDeriveKey(keyMaterial);
  const [, ivHex, authTagHex, ciphertextHex] = blob.split(":");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex"),
    { authTagLength: 16 },
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  return (
    decipher.update(Buffer.from(ciphertextHex, "hex")).toString("utf8") +
    decipher.final("utf8")
  );
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

  it("key rotation re-encrypts with correct HKDF info", () => {
    const oldKey = "old-key-material-for-testing-123";
    const newKey = "new-key-material-for-testing-456";

    // Encrypt with old key
    const blob = encryptWithKey("secret-value", oldKey);
    expect(blob).toContain("v1:");

    // Verify decrypt with old key works
    expect(decryptWithKey(blob, oldKey)).toBe("secret-value");

    // After the HKDF fix, deriveKey uses "stratum-aes-key" (same as encrypt).
    // Simulate reEncrypt: decrypt with old key, encrypt with new key
    const plaintext = decryptWithKey(blob, oldKey);
    const reEncrypted = encryptWithKey(plaintext, newKey);

    // Verify new key can decrypt
    expect(decryptWithKey(reEncrypted, newKey)).toBe("secret-value");

    // Verify old key CANNOT decrypt the re-encrypted value
    expect(() => decryptWithKey(reEncrypted, oldKey)).toThrow();
  });
});

// The library derives keys with this salt when STRATUM_HKDF_SALT is unset,
// which is the case in this suite. See NON_PRODUCTION_DEFAULT_SALT in crypto.ts.
const LIB_TEST_SALT = Buffer.from("stratum-non-production-hkdf-salt-v1", "utf8");

function decryptAsLib(blob: string, keyMaterial: string): string {
  const key = Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(keyMaterial, "utf8"), LIB_TEST_SALT, "stratum-aes-key", 32),
  );
  const [, ivHex, authTagHex, ciphertextHex] = blob.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"), {
    authTagLength: 16,
  });
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  return decipher.update(Buffer.from(ciphertextHex, "hex")).toString("utf8") + decipher.final("utf8");
}

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
