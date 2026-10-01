import { describe, it, expect, vi, afterEach } from "vitest";
import type pg from "pg";

vi.mock("../migrate.js", () => ({ migrate: vi.fn().mockResolvedValue(undefined) }));

import { Stratum } from "../stratum.js";

/**
 * initialize() with autoMigrate warns when enforceRls is off in any
 * environment other than development and test. An unset NODE_ENV counts as
 * development.
 */
async function warningsFor(nodeEnv: string | undefined, enforceRls = false): Promise<string[]> {
  vi.stubEnv("NODE_ENV", nodeEnv);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  // initialize() also reads the catalog for the control-role check (role-model.ts).
  const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as pg.Pool;
  const stratum = new Stratum({ pool, logger, autoMigrate: true, enforceRls });
  await stratum.initialize();
  return logger.warn.mock.calls.map((c) => String(c[0]));
}

describe("autoMigrate enforceRls warning", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("warns when enforceRls is off in any non-development, non-test environment", async () => {
    for (const nodeEnv of ["production", "staging", "preview", "qa"]) {
      expect((await warningsFor(nodeEnv)).some((m) => m.includes("enforceRls"))).toBe(true);
    }
  });

  it("does not warn in development, test, or when NODE_ENV is unset", async () => {
    for (const nodeEnv of ["development", "test", undefined]) {
      expect((await warningsFor(nodeEnv)).some((m) => m.includes("enforceRls"))).toBe(false);
    }
  });

  it("does not warn when enforceRls is on", async () => {
    expect((await warningsFor("staging", true)).some((m) => m.includes("enforceRls"))).toBe(false);
  });
});
