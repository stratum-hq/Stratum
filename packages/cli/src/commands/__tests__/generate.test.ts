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
});
