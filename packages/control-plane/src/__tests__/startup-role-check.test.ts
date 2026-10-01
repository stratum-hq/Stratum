import { describe, it, expect, vi } from "vitest";

/**
 * buildApp() checks the database logins against the role model at startup,
 * with and without DATABASE_ADMIN_URL. Without it, the check is whether the
 * DATABASE_URL login is a member of the control role (Stratum.initialize()).
 */

const state = vi.hoisted(() => ({ initialize: 0, adminPool: undefined as unknown }));

vi.mock("@stratum-hq/lib", () => {
  class Stratum {
    async initialize(): Promise<void> {
      state.initialize += 1;
    }
  }
  return { Stratum };
});
vi.mock("../db/connection.js", () => ({ getPool: () => ({}), getAdminPool: () => state.adminPool }));

import { buildApp } from "../app.js";

describe("control-plane startup", () => {
  it("checks the role model without DATABASE_ADMIN_URL", async () => {
    state.adminPool = undefined;
    state.initialize = 0;
    const app = await buildApp();
    await app.close();
    expect(state.initialize).toBe(1);
  });

  it("checks the role model with DATABASE_ADMIN_URL", async () => {
    state.adminPool = {};
    state.initialize = 0;
    const app = await buildApp();
    await app.close();
    expect(state.initialize).toBe(1);
  });
});
