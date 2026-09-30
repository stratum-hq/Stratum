import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import type { Stratum } from "@stratum-hq/lib";
import {
  createMockStratum,
  buildTestApp,
  authHeaders,
  setupAdminApiKey,
  setupReadOnlyApiKey,
} from "./test-helpers.js";

/**
 * A request that matches no route is answered with 404 once the caller is
 * authenticated, and with 401 when it is not. Matched routes stay default-deny.
 */
describe("unmatched routes", () => {
  let app: FastifyInstance;
  let stratum: Stratum;

  beforeEach(async () => {
    stratum = createMockStratum();
    app = await buildTestApp(stratum);
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 404 for an unknown path with an authenticated admin key", async () => {
    setupAdminApiKey(stratum);
    const res = await app.inject({ method: "GET", url: "/api/v1/does-not-exist", headers: authHeaders() });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for an unknown path with an authenticated read-only key", async () => {
    setupReadOnlyApiKey(stratum);
    for (const method of ["GET", "POST", "DELETE"] as const) {
      const res = await app.inject({ method, url: "/api/v1/tenants/x/nothing-here", headers: authHeaders() });
      expect(res.statusCode).toBe(404);
    }
  });

  it("returns 401 for an unknown path without credentials", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/does-not-exist" });
    expect(res.statusCode).toBe(401);
  });
});
