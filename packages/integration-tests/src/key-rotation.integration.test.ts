import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { encrypt, decrypt, reEncrypt } from "@stratum-hq/lib/src/crypto.js";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";

describe("Encryption & Key Rotation (integration)", () => {
  beforeAll(async () => {
    process.env.STRATUM_ENCRYPTION_KEY = "test-encryption-key-32chars-long!";
    await runMigrations();
  });

  afterEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    delete process.env.STRATUM_ENCRYPTION_KEY;
    await closePool();
  });

  it("encrypt/decrypt round trip works", () => {
    const plaintext = "sensitive-database-url-with-credentials";
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).toContain("v1:"); // versioned format
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("reEncrypt uses same HKDF info (rotation fix)", () => {
    const oldKey = "old-key-material-for-testing-123";
    const newKey = "new-key-material-for-testing-456";

    // Simulate what encrypt() does but with explicit key material
    const { hkdfDeriveKey } = (() => {
      // Replicate the derivation to test the fix
      const crypto = require("node:crypto");
      function hkdfDeriveKey(
        keyMaterial: string,
        info = "stratum-aes-key",
      ): Buffer {
        const salt = Buffer.alloc(32, 0);
        return Buffer.from(
          crypto.hkdfSync(
            "sha256",
            Buffer.from(keyMaterial, "utf8"),
            salt,
            info,
            32,
          ),
        );
      }
      return { hkdfDeriveKey };
    })();

    // Encrypt with old key using the same info string
    const crypto = require("node:crypto");
    const iv = crypto.randomBytes(12);
    const key = hkdfDeriveKey(oldKey);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, {
      authTagLength: 16,
    });
    const encrypted = Buffer.concat([
      cipher.update("secret-value", "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    const blob = `v1:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;

    // reEncrypt should succeed (uses same HKDF info after fix)
    const reEncrypted = reEncrypt(blob, oldKey, newKey);
    expect(reEncrypted).not.toBe(blob);
    expect(reEncrypted).toContain("v1:");

    // Decrypt with new key should work
    const newDerivedKey = hkdfDeriveKey(newKey);
    const parts = reEncrypted.split(":");
    const [, ivHex, authTagHex, ciphertextHex] = parts;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      newDerivedKey,
      Buffer.from(ivHex, "hex"),
      { authTagLength: 16 },
    );
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    const result =
      decipher.update(Buffer.from(ciphertextHex, "hex")).toString("utf8") +
      decipher.final("utf8");
    expect(result).toBe("secret-value");
  });
});
