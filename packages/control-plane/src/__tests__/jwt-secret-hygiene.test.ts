import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Startup checks on JWT_SECRET. config.ts validates at import time, so each
 * case stubs the environment and imports a fresh copy of the module.
 */
async function loadConfig(env: { NODE_ENV: string; JWT_SECRET?: string }) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", env.NODE_ENV);
  vi.stubEnv("JWT_SECRET", env.JWT_SECRET ?? "");
  return import("../config.js");
}

describe("JWT_SECRET startup checks", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("refuses to start in production with the placeholder secret", async () => {
    await expect(
      loadConfig({ NODE_ENV: "production", JWT_SECRET: "change-me-in-production" }),
    ).rejects.toThrow(/JWT_SECRET/);
  });

  it("refuses to start in production with other placeholder secrets published in this repository", async () => {
    for (const placeholder of [
      "stratum-demo-secret-do-not-use-in-production",
      "your-jwt-secret-change-in-production",
    ]) {
      await expect(
        loadConfig({ NODE_ENV: "production", JWT_SECRET: placeholder }),
      ).rejects.toThrow(/JWT_SECRET/);
    }
  });

  it("refuses to start in production with a secret shorter than 32 bytes", async () => {
    await expect(
      loadConfig({ NODE_ENV: "production", JWT_SECRET: "x".repeat(31) }),
    ).rejects.toThrow(/32 bytes/);
  });

  it("starts in production with a secret of at least 32 bytes", async () => {
    const secret = "k".repeat(32);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { config } = await loadConfig({ NODE_ENV: "production", JWT_SECRET: secret });
    expect(config.jwtSecret).toBe(secret);
  });

  it("still starts outside production with a short or placeholder secret", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { config } = await loadConfig({
      NODE_ENV: "development",
      JWT_SECRET: "change-me-in-production",
    });
    expect(config.jwtSecret).toBe("change-me-in-production");
  });
});
