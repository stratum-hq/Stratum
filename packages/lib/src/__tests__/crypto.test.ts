import { describe, it, expect, vi, afterEach } from "vitest";
import { encrypt, decrypt, encryptWithKeyMaterial } from "../crypto.js";
import { DecryptionError, ErrorCode, StratumError } from "@stratum-hq/core";

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
    expect(() => decrypt("invalid")).toThrow(DecryptionError);
  });

  it("wraps a wrong key or salt in a DecryptionError instead of the raw Node error", () => {
    const foreign = encryptWithKeyMaterial("secret-plaintext", "some-other-key-material");
    let caught: unknown;
    try {
      decrypt(foreign);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DecryptionError);
    expect(caught).toBeInstanceOf(StratumError);
    const err = caught as DecryptionError;
    expect(err.code).toBe(ErrorCode.DECRYPTION_FAILED);
    expect(err.message).toMatch(/STRATUM_ENCRYPTION_KEY or STRATUM_HKDF_SALT/);
    expect(err.message).not.toMatch(/Unsupported state/);
    expect(err.message).not.toContain("secret-plaintext");
    // The original error stays available for debugging.
    expect((err.cause as Error).message).toMatch(/Unsupported state or unable to authenticate data/);
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

  it("refuses to load without STRATUM_ENCRYPTION_KEY in any non-development, non-test environment", async () => {
    for (const nodeEnv of ["staging", "preview", "qa"]) {
      process.env.STRATUM_HKDF_SALT = "a1".repeat(32);
      delete process.env.STRATUM_ENCRYPTION_KEY;
      delete process.env.WEBHOOK_ENCRYPTION_KEY;
      process.env.NODE_ENV = nodeEnv;
      await expect(freshCrypto()).rejects.toThrow(/STRATUM_ENCRYPTION_KEY must be set/);
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

describe("crypto key material checks at startup outside development and test", () => {
  const names = ["STRATUM_HKDF_SALT", "STRATUM_ENCRYPTION_KEY", "WEBHOOK_ENCRYPTION_KEY", "NODE_ENV"] as const;
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  const GOOD_KEY = "k".repeat(32);
  const GOOD_SALT = "a1".repeat(32);
  const DEV_SALT_HEX = Buffer.from("stratum-non-production-hkdf-salt-v1", "utf8").toString("hex");

  afterEach(() => {
    for (const n of names) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
    vi.resetModules();
  });

  const freshCrypto = async () => {
    vi.resetModules();
    return import("../crypto.js");
  };

  const env = (vars: Partial<Record<(typeof names)[number], string>>) => {
    for (const n of names) delete process.env[n];
    Object.assign(process.env, vars);
  };

  it("refuses to load with only STRATUM_HKDF_SALT set", async () => {
    for (const nodeEnv of ["production", "staging"]) {
      env({ NODE_ENV: nodeEnv, STRATUM_HKDF_SALT: GOOD_SALT });
      await expect(freshCrypto()).rejects.toThrow(/STRATUM_ENCRYPTION_KEY must be set/);
    }
  });

  it("refuses to load with a salt that is not non-empty, even-length hex", async () => {
    for (const salt of ["not-hex-at-all", "abc", "a1g2"]) {
      env({ NODE_ENV: "production", STRATUM_HKDF_SALT: salt, STRATUM_ENCRYPTION_KEY: GOOD_KEY });
      await expect(freshCrypto()).rejects.toThrow(/STRATUM_HKDF_SALT must be a non-empty, even-length hex string/);
    }
  });

  it("refuses to load with the built-in development key or salt", async () => {
    env({ NODE_ENV: "production", STRATUM_HKDF_SALT: GOOD_SALT, STRATUM_ENCRYPTION_KEY: "stratum-dev-key" });
    await expect(freshCrypto()).rejects.toThrow(/built-in development key/);
    env({ NODE_ENV: "production", STRATUM_HKDF_SALT: DEV_SALT_HEX, STRATUM_ENCRYPTION_KEY: GOOD_KEY });
    await expect(freshCrypto()).rejects.toThrow(/built-in development salt/);
  });

  it("refuses to load with a key shorter than 32 bytes", async () => {
    for (const key of ["x", "k".repeat(31)]) {
      env({ NODE_ENV: "production", STRATUM_HKDF_SALT: GOOD_SALT, STRATUM_ENCRYPTION_KEY: key });
      await expect(freshCrypto()).rejects.toThrow(/STRATUM_ENCRYPTION_KEY must be at least 32 bytes/);
    }
  });

  it("does not read WEBHOOK_ENCRYPTION_KEY, and says so", async () => {
    env({ NODE_ENV: "production", STRATUM_HKDF_SALT: GOOD_SALT, WEBHOOK_ENCRYPTION_KEY: GOOD_KEY });
    await expect(freshCrypto()).rejects.toThrow(/WEBHOOK_ENCRYPTION_KEY is read only in development and test/);
  });

  it("loads and round-trips with a real key and salt", async () => {
    env({ NODE_ENV: "production", STRATUM_HKDF_SALT: GOOD_SALT, STRATUM_ENCRYPTION_KEY: GOOD_KEY });
    const mod = await freshCrypto();
    expect(mod.decrypt(mod.encrypt("ok"))).toBe("ok");
  });

  it("refuses a salt that is not hex in development too, instead of using an empty salt", async () => {
    env({ NODE_ENV: "development", STRATUM_HKDF_SALT: "not-hex-at-all" });
    await expect(freshCrypto()).rejects.toThrow(/STRATUM_HKDF_SALT must be a non-empty, even-length hex string/);
  });
});

describe("crypto previous HKDF salt during a salt change", () => {
  const SALT_A = "a1".repeat(32);
  const SALT_B = "b2".repeat(32);
  // Keys outside development and test must be at least 32 bytes.
  const SAME_KEY = "same-key".padEnd(32, "-");
  const OLD_KEY = "old-key".padEnd(32, "-");
  const NEW_KEY = "new-key".padEnd(32, "-");
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
    const ciphertext = await encryptUnder(SAME_KEY, SALT_A, "salt-only");

    process.env.STRATUM_HKDF_SALT = SALT_B;
    process.env.STRATUM_HKDF_SALT_PREVIOUS = SALT_A;
    expect((await freshCrypto()).decrypt(ciphertext)).toBe("salt-only");
  });

  it("decrypts a value from the previous key and previous salt together", async () => {
    process.env.NODE_ENV = "production";
    const ciphertext = await encryptUnder(OLD_KEY, SALT_A, "old-pair");

    process.env.STRATUM_ENCRYPTION_KEY = NEW_KEY;
    process.env.STRATUM_HKDF_SALT = SALT_B;
    process.env.STRATUM_ENCRYPTION_KEY_PREVIOUS = OLD_KEY;
    process.env.STRATUM_HKDF_SALT_PREVIOUS = SALT_A;
    expect((await freshCrypto()).decrypt(ciphertext)).toBe("old-pair");
  });

  it("does not decrypt a value from an earlier salt when STRATUM_HKDF_SALT_PREVIOUS is unset", async () => {
    process.env.NODE_ENV = "production";
    const ciphertext = await encryptUnder(OLD_KEY, SALT_A, "old-pair");

    process.env.STRATUM_ENCRYPTION_KEY = NEW_KEY;
    process.env.STRATUM_HKDF_SALT = SALT_B;
    process.env.STRATUM_ENCRYPTION_KEY_PREVIOUS = OLD_KEY;
    await expect(freshCrypto().then((m) => m.decrypt(ciphertext))).rejects.toMatchObject({
      name: "DecryptionError",
      code: "DECRYPTION_FAILED",
    });
  });

  it("encrypts and decrypts with an explicit salt instead of the configured salt", async () => {
    process.env.NODE_ENV = "production";
    process.env.STRATUM_ENCRYPTION_KEY = "configured-key".padEnd(32, "-");
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
