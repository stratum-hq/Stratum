import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify from "fastify";

/**
 * DATABASE_ADMIN_URL gives the control plane an admin pool (a member of the
 * control role of lib migration 032). Without it, the control plane behaves
 * as before: one pool from DATABASE_URL.
 */

const pools = vi.hoisted(() => ({
  app: { query: vi.fn() },
  admin: undefined as { query: ReturnType<typeof vi.fn> } | undefined,
}));
vi.mock("../db/connection.js", () => ({
  getPool: () => pools.app,
  getAdminPool: () => pools.admin,
}));

import { healthRoutes } from "../routes/health.js";

async function health() {
  const app = Fastify({ logger: false });
  await app.register(healthRoutes(async () => "not_configured" as const));
  const res = await app.inject({ method: "GET", url: "/api/v1/health" });
  await app.close();
  return res.json();
}

afterEach(() => {
  pools.app.query.mockReset();
  pools.admin = undefined;
  vi.unstubAllEnvs();
});

describe("GET /api/v1/health", () => {
  it("reports only the application pool when DATABASE_ADMIN_URL is not set", async () => {
    pools.app.query.mockResolvedValue({ rows: [] });
    const body = await health();
    expect(body.db).toBe("connected");
    expect(body).not.toHaveProperty("admin_db");
  });

  it("checks both pools when an admin pool is configured", async () => {
    pools.app.query.mockResolvedValue({ rows: [] });
    pools.admin = { query: vi.fn().mockRejectedValue(new Error("down")) };
    const body = await health();
    expect(body.db).toBe("connected");
    expect(body.admin_db).toBe("disconnected");
    expect(pools.admin.query).toHaveBeenCalledWith("SELECT 1");
  });
});

describe("control-plane configuration from the environment", () => {
  async function loadConfig(env: Record<string, string>) {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.resetModules();
    return (await import("../config.js")).config;
  }

  it("leaves the admin URL, control role and legacy key hash option unset by default", async () => {
    const config = await loadConfig({ DATABASE_ADMIN_URL: "", STRATUM_CONTROL_ROLE: "", STRATUM_ALLOW_LEGACY_KEY_HASHES: "" });
    expect(config.databaseAdminUrl).toBeUndefined();
    expect(config.controlRole).toBeUndefined();
    expect(config.allowLegacyKeyHashes).toBeUndefined();
  });

  it("reads DATABASE_ADMIN_URL, STRATUM_CONTROL_ROLE and STRATUM_ALLOW_LEGACY_KEY_HASHES", async () => {
    const config = await loadConfig({
      DATABASE_ADMIN_URL: "postgres://admin@db/stratum",
      STRATUM_CONTROL_ROLE: "acme_control",
      STRATUM_ALLOW_LEGACY_KEY_HASHES: "false",
    });
    expect(config.databaseAdminUrl).toBe("postgres://admin@db/stratum");
    expect(config.controlRole).toBe("acme_control");
    expect(config.allowLegacyKeyHashes).toBe(false);
  });

  it("refuses a STRATUM_ALLOW_LEGACY_KEY_HASHES value that is not true or false", async () => {
    await expect(loadConfig({ STRATUM_ALLOW_LEGACY_KEY_HASHES: "no" })).rejects.toThrow(/must be true or false/);
  });
});
