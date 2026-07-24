import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Stratum } from "@stratum-hq/lib";
import {
  createMockStratum,
  buildTestApp,
  authHeaders,
  setupReadOnlyApiKey,
  setupWriteApiKey,
  setupAdminApiKey,
  SAMPLE_TENANT,
} from "./test-helpers.js";

/**
 * Admin-scope enforcement must depend on the resolved request PATH only, not on
 * the raw URL. A query string appended to an admin-only route must not change
 * which scope the route requires.
 */
describe("admin scope is enforced independent of the query string", () => {
  let app: FastifyInstance;
  let stratum: Stratum;
  const id = SAMPLE_TENANT.id;

  beforeEach(async () => {
    stratum = createMockStratum();
    (stratum.getTenant as ReturnType<typeof vi.fn>).mockResolvedValue(
      SAMPLE_TENANT,
    );
    (stratum.purgeTenant as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );
    // getTenantContext is not stubbed by the shared helper; add it locally.
    (stratum as unknown as Record<string, unknown>).getTenantContext = vi
      .fn()
      .mockResolvedValue({ tenant: SAMPLE_TENANT });
    app = await buildTestApp(stratum);
  });

  afterEach(async () => {
    await app.close();
  });

  it("write-scope key is refused on an admin route (baseline, no query string)", async () => {
    setupWriteApiKey(stratum);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/tenants/${id}/purge`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(403);
    expect(stratum.purgeTenant).not.toHaveBeenCalled();
  });

  it("write-scope key stays refused on an admin route carrying a query string", async () => {
    setupWriteApiKey(stratum);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/tenants/${id}/purge?probe=1`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(403);
    expect(stratum.purgeTenant).not.toHaveBeenCalled();
  });

  it("read-scope key stays refused on an admin GET route carrying a query string", async () => {
    setupReadOnlyApiKey(stratum);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/tenants/${id}/context?probe=1`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(403);
    expect(
      (stratum as unknown as { getTenantContext: ReturnType<typeof vi.fn> })
        .getTenantContext,
    ).not.toHaveBeenCalled();
  });

  it("admin-scope key is still allowed on an admin route with a query string", async () => {
    setupAdminApiKey(stratum);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/tenants/${id}/purge?probe=1`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(204);
    expect(stratum.purgeTenant).toHaveBeenCalled();
  });
});
