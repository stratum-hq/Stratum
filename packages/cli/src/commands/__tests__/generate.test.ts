import { describe, it, expect, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import { hashApiKey } from "../generate.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hashApiKey", () => {
  it("hashes with HMAC-SHA256 (version 2) when STRATUM_API_KEY_HMAC_SECRET is set", () => {
    vi.stubEnv("STRATUM_API_KEY_HMAC_SECRET", "s".repeat(40));
    const expected = crypto.createHmac("sha256", "s".repeat(40)).update("sk_test_abc").digest("hex");
    expect(hashApiKey("sk_test_abc")).toEqual({ keyHash: expected, hashVersion: 2 });
  });

  it("hashes with SHA-256 (version 1) when no HMAC secret is set", () => {
    vi.stubEnv("STRATUM_API_KEY_HMAC_SECRET", "");
    const expected = crypto.createHash("sha256").update("sk_test_abc").digest("hex");
    expect(hashApiKey("sk_test_abc")).toEqual({ keyHash: expected, hashVersion: 1 });
  });

  it("refuses an HMAC secret shorter than 32 bytes outside development and test", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STRATUM_API_KEY_HMAC_SECRET", "s".repeat(31));
    expect(() => hashApiKey("sk_live_abc")).toThrow(
      "STRATUM_API_KEY_HMAC_SECRET must be at least 32 bytes in production",
    );
  });

  it("counts the HMAC secret length in UTF-8 bytes", () => {
    vi.stubEnv("NODE_ENV", "staging");
    vi.stubEnv("STRATUM_API_KEY_HMAC_SECRET", "\u00e9".repeat(16));
    expect(hashApiKey("sk_test_abc").hashVersion).toBe(2);
  });

  it("accepts a 32-byte HMAC secret in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STRATUM_API_KEY_HMAC_SECRET", "s".repeat(32));
    expect(hashApiKey("sk_live_abc").hashVersion).toBe(2);
  });

  it.each(["development", "test", ""])("accepts a shorter HMAC secret when NODE_ENV is %j", (nodeEnv) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("STRATUM_API_KEY_HMAC_SECRET", "short");
    expect(hashApiKey("sk_test_abc").hashVersion).toBe(2);
  });
});
