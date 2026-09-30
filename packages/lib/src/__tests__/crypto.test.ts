import { describe, it, expect, vi, afterEach } from "vitest";
import { encrypt, decrypt } from "../crypto.js";

describe("crypto", () => {
  it("encrypts and decrypts round-trip", () => {
    const plaintext = "my-secret-value-for-testing";
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it("produces versioned format v1:iv:tag:ct", () => {
    const encrypted = encrypt("test");
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("decrypts legacy format (no version prefix)", () => {
    // Encrypt, then strip the v1: prefix to simulate legacy
    const encrypted = encrypt("legacy-test");
    const legacy = encrypted.replace(/^v1:/, "");
    expect(decrypt(legacy)).toBe("legacy-test");
  });

  it("throws on invalid format", () => {
    expect(() => decrypt("invalid")).toThrow("Invalid encrypted value format");
  });

  it("different plaintexts produce different ciphertexts", () => {
    const a = encrypt("value-a");
    const b = encrypt("value-b");
    expect(a).not.toBe(b);
  });

  it("same plaintext produces different ciphertexts (random IV)", () => {
    const a = encrypt("same-value");
    const b = encrypt("same-value");
    expect(a).not.toBe(b);
    // But both decrypt to same value
    expect(decrypt(a)).toBe("same-value");
    expect(decrypt(b)).toBe("same-value");
  });
});

describe("crypto HKDF salt across process restarts", () => {
  const saved = {
    salt: process.env.STRATUM_HKDF_SALT,
    key: process.env.STRATUM_ENCRYPTION_KEY,
    nodeEnv: process.env.NODE_ENV,
  };

  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };

  afterEach(() => {
    restore("STRATUM_HKDF_SALT", saved.salt);
    restore("STRATUM_ENCRYPTION_KEY", saved.key);
    restore("NODE_ENV", saved.nodeEnv);
    vi.resetModules();
  });

  // Each fresh module instance models a new process (or another replica).
  const freshCrypto = async () => {
    vi.resetModules();
    return import("../crypto.js");
  };

  it("decrypts values written by an earlier process when no salt is configured outside production", async () => {
    delete process.env.STRATUM_HKDF_SALT;
    process.env.NODE_ENV = "development";
    process.env.STRATUM_ENCRYPTION_KEY = "restart-test-key";

    const first = await freshCrypto();
    const ciphertext = first.encrypt("survives-restart");

    const second = await freshCrypto();
    expect(second.decrypt(ciphertext)).toBe("survives-restart");
  });

  it("decrypts values written by an earlier process with the dev key and no salt", async () => {
    delete process.env.STRATUM_HKDF_SALT;
    delete process.env.STRATUM_ENCRYPTION_KEY;
    process.env.NODE_ENV = "test";

    const ciphertext = (await freshCrypto()).encrypt("dev-restart");
    expect((await freshCrypto()).decrypt(ciphertext)).toBe("dev-restart");
  });

  it("keeps using a configured salt, so data encrypted under it stays decryptable", async () => {
    process.env.STRATUM_HKDF_SALT = "a1".repeat(32);
    process.env.STRATUM_ENCRYPTION_KEY = "salted-key";
    process.env.NODE_ENV = "development";

    const salted = await freshCrypto();
    const ciphertext = salted.encrypt("salted-value");

    // A different configured salt derives a different key: the salt is honored.
    process.env.STRATUM_HKDF_SALT = "b2".repeat(32);
    const otherSalt = await freshCrypto();
    expect(() => otherSalt.decrypt(ciphertext)).toThrow();

    process.env.STRATUM_HKDF_SALT = "a1".repeat(32);
    expect((await freshCrypto()).decrypt(ciphertext)).toBe("salted-value");
  });

  it("still requires STRATUM_HKDF_SALT in production", async () => {
    delete process.env.STRATUM_HKDF_SALT;
    process.env.NODE_ENV = "production";
    process.env.STRATUM_ENCRYPTION_KEY = "prod-key";

    await expect(freshCrypto()).rejects.toThrow("STRATUM_HKDF_SALT must be set in production");
  });
});

describe("crypto key material outside development and test", () => {
  const saved = {
    salt: process.env.STRATUM_HKDF_SALT,
    key: process.env.STRATUM_ENCRYPTION_KEY,
    webhookKey: process.env.WEBHOOK_ENCRYPTION_KEY,
    nodeEnv: process.env.NODE_ENV,
  };

  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };

  afterEach(() => {
    restore("STRATUM_HKDF_SALT", saved.salt);
    restore("STRATUM_ENCRYPTION_KEY", saved.key);
    restore("WEBHOOK_ENCRYPTION_KEY", saved.webhookKey);
    restore("NODE_ENV", saved.nodeEnv);
    vi.resetModules();
  });

  const freshCrypto = async () => {
    vi.resetModules();
    return import("../crypto.js");
  };

  it("refuses to load without STRATUM_HKDF_SALT in any non-development, non-test environment", async () => {
    for (const nodeEnv of ["staging", "preview", "qa"]) {
      delete process.env.STRATUM_HKDF_SALT;
      process.env.NODE_ENV = nodeEnv;
      process.env.STRATUM_ENCRYPTION_KEY = "real-key-material";
      await expect(freshCrypto()).rejects.toThrow(/STRATUM_HKDF_SALT must be set/);
    }
  });

  it("refuses to encrypt with the built-in dev key in any non-development, non-test environment", async () => {
    for (const nodeEnv of ["staging", "preview", "qa"]) {
      process.env.STRATUM_HKDF_SALT = "a1".repeat(32);
      delete process.env.STRATUM_ENCRYPTION_KEY;
      delete process.env.WEBHOOK_ENCRYPTION_KEY;
      process.env.NODE_ENV = nodeEnv;
      const mod = await freshCrypto();
      expect(() => mod.encrypt("x")).toThrow(/STRATUM_ENCRYPTION_KEY must be set/);
    }
  });

  it("falls back to the built-in dev key and salt when NODE_ENV is unset", async () => {
    delete process.env.STRATUM_HKDF_SALT;
    delete process.env.STRATUM_ENCRYPTION_KEY;
    delete process.env.WEBHOOK_ENCRYPTION_KEY;
    delete process.env.NODE_ENV;
    const mod = await freshCrypto();
    expect(mod.decrypt(mod.encrypt("unset-env"))).toBe("unset-env");
  });
});

describe("crypto previous HKDF salt during a salt change", () => {
  const SALT_A = "a1".repeat(32);
  const SALT_B = "b2".repeat(32);
  const names = [
    "STRATUM_HKDF_SALT",
    "STRATUM_HKDF_SALT_PREVIOUS",
    "STRATUM_ENCRYPTION_KEY",
    "STRATUM_ENCRYPTION_KEY_PREVIOUS",
    "NODE_ENV",
  ] as const;
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));

  afterEach(() => {
    for (const n of names) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
    vi.resetModules();
  });

  // Each fresh module instance models a process that starts with the current environment.
  const freshCrypto = async () => {
    vi.resetModules();
    return import("../crypto.js");
  };

  const encryptUnder = async (key: string, salt: string, plaintext: string) => {
    process.env.STRATUM_ENCRYPTION_KEY = key;
    process.env.STRATUM_HKDF_SALT = salt;
    delete process.env.STRATUM_ENCRYPTION_KEY_PREVIOUS;
    delete process.env.STRATUM_HKDF_SALT_PREVIOUS;
    return (await freshCrypto()).encrypt(plaintext);
  };

  it("decrypts a value from the previous salt when only the salt changed", async () => {
    process.env.NODE_ENV = "production";
    const ciphertext = await encryptUnder("same-key", SALT_A, "salt-only");

    process.env.STRATUM_HKDF_SALT = SALT_B;
    process.env.STRATUM_HKDF_SALT_PREVIOUS = SALT_A;
    expect((await freshCrypto()).decrypt(ciphertext)).toBe("salt-only");
  });

  it("decrypts a value from the previous key and previous salt together", async () => {
    process.env.NODE_ENV = "production";
    const ciphertext = await encryptUnder("old-key", SALT_A, "old-pair");

    process.env.STRATUM_ENCRYPTION_KEY = "new-key";
    process.env.STRATUM_HKDF_SALT = SALT_B;
    process.env.STRATUM_ENCRYPTION_KEY_PREVIOUS = "old-key";
    process.env.STRATUM_HKDF_SALT_PREVIOUS = SALT_A;
    expect((await freshCrypto()).decrypt(ciphertext)).toBe("old-pair");
  });

  it("does not decrypt a value from an earlier salt when STRATUM_HKDF_SALT_PREVIOUS is unset", async () => {
    process.env.NODE_ENV = "production";
    const ciphertext = await encryptUnder("old-key", SALT_A, "old-pair");

    process.env.STRATUM_ENCRYPTION_KEY = "new-key";
    process.env.STRATUM_HKDF_SALT = SALT_B;
    process.env.STRATUM_ENCRYPTION_KEY_PREVIOUS = "old-key";
    await expect(freshCrypto().then((m) => m.decrypt(ciphertext))).rejects.toThrow();
  });

  it("encrypts and decrypts with an explicit salt instead of the configured salt", async () => {
    process.env.NODE_ENV = "production";
    process.env.STRATUM_ENCRYPTION_KEY = "configured-key";
    process.env.STRATUM_HKDF_SALT = SALT_A;
    const mod = await freshCrypto();

    const onB = mod.encryptWithKeyMaterial("explicit", "explicit-key", SALT_B);
    expect(mod.decryptWithKeyMaterial(onB, "explicit-key", SALT_B)).toBe("explicit");
    expect(mod.decryptWithKeyMaterial(onB, "explicit-key", SALT_A)).toBeNull();
    expect(mod.decryptWithKeyMaterial(onB, "explicit-key")).toBeNull();

    // With no salt argument, the configured salt applies.
    const onConfigured = mod.encryptWithKeyMaterial("default", "explicit-key");
    expect(mod.decryptWithKeyMaterial(onConfigured, "explicit-key", SALT_A)).toBe("default");
  });
});
