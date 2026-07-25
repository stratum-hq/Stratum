import { describe, it, expect, afterEach } from "vitest";
import crypto from "node:crypto";
import { generateKey } from "../api-key-service.js";

// These are pure-logic tests of key generation and hashing: real crypto, no
// database. They lock down the two properties that make the key store safe:
// the raw key is never derivable from what gets stored, and the stored hash is
// HMAC-SHA256 (keyed) when a secret is configured, SHA-256 otherwise.

const HMAC_SECRET_ENV = "STRATUM_API_KEY_HMAC_SECRET";

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function hmacSha256(input: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(input).digest("hex");
}

afterEach(() => {
  delete process.env[HMAC_SECRET_ENV];
});

describe("generateKey", () => {
  it("prefixes the plaintext key and appends a base64url random of 32 bytes", () => {
    const { plaintextKey } = generateKey("sk_live_");
    expect(plaintextKey.startsWith("sk_live_")).toBe(true);
    const random = plaintextKey.slice("sk_live_".length);
    // 32 random bytes encode to 43 base64url chars (no padding).
    expect(random).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("produces a distinct plaintext and hash on every call", () => {
    const a = generateKey("sk_live_");
    const b = generateKey("sk_live_");
    expect(a.plaintextKey).not.toBe(b.plaintextKey);
    expect(a.keyHash).not.toBe(b.keyHash);
  });

  it("never stores anything from which the raw key can be read back", () => {
    const { plaintextKey, keyHash } = generateKey("sk_live_");
    expect(keyHash).not.toBe(plaintextKey);
    expect(keyHash).not.toContain(plaintextKey);
    expect(plaintextKey).not.toContain(keyHash);
    // A hex SHA/HMAC digest is exactly 64 chars.
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  describe("without an HMAC secret", () => {
    it("hashes with SHA-256 and tags the row as version 1", () => {
      const { plaintextKey, keyHash, hashVersion } = generateKey("sk_live_");
      expect(hashVersion).toBe(1);
      expect(keyHash).toBe(sha256(plaintextKey));
    });
  });

  describe("with an HMAC secret", () => {
    it("hashes with HMAC-SHA256 and tags the row as version 2", () => {
      process.env[HMAC_SECRET_ENV] = "top-secret-hmac-key";
      const { plaintextKey, keyHash, hashVersion } = generateKey("sk_live_");
      expect(hashVersion).toBe(2);
      expect(keyHash).toBe(hmacSha256(plaintextKey, "top-secret-hmac-key"));
    });

    it("differs from the unkeyed SHA-256 of the same key", () => {
      process.env[HMAC_SECRET_ENV] = "top-secret-hmac-key";
      const { plaintextKey, keyHash } = generateKey("sk_live_");
      expect(keyHash).not.toBe(sha256(plaintextKey));
    });

    it("actually depends on the secret: a different secret yields a different hash", () => {
      process.env[HMAC_SECRET_ENV] = "secret-a";
      const { plaintextKey, keyHash } = generateKey("sk_live_");
      // Same plaintext hashed under a different secret must not match.
      expect(keyHash).toBe(hmacSha256(plaintextKey, "secret-a"));
      expect(keyHash).not.toBe(hmacSha256(plaintextKey, "secret-b"));
    });

    it("is deterministic for a given key and secret (so lookup can find it)", () => {
      process.env[HMAC_SECRET_ENV] = "top-secret-hmac-key";
      const { plaintextKey, keyHash } = generateKey("sk_live_");
      expect(hmacSha256(plaintextKey, "top-secret-hmac-key")).toBe(keyHash);
    });
  });
});
