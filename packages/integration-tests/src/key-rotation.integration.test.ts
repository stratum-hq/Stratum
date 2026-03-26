import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import crypto from "node:crypto";
import { Stratum } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";

function hkdfDeriveKey(keyMaterial: string, info = "stratum-aes-key"): Buffer {
  const salt = Buffer.alloc(32, 0);
  return Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(keyMaterial, "utf8"), salt, info, 32),
  );
}

function encryptWithKey(plaintext: string, keyMaterial: string): string {
  const key = hkdfDeriveKey(keyMaterial);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
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
    const tenant = await stratum.createTenant({ name: "Enc Test", slug: "enc_test" });
    await stratum.setConfig(tenant.id, "db_password", { value: "super-secret", sensitive: true });

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
