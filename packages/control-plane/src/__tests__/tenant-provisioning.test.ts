import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Mock } from "vitest";
import { FastifyInstance } from "fastify";
import {
  createMockStratum,
  buildTestApp,
  authHeaders,
  setupAdminApiKey,
  SAMPLE_TENANT,
} from "./test-helpers.js";
import type { Stratum } from "@stratum-hq/lib";

vi.mock("../services/isolation-service.js", () => ({
  setupSchemaForTenant: vi.fn(),
  setupDatabaseForTenant: vi.fn(),
}));

import { setupSchemaForTenant, setupDatabaseForTenant } from "../services/isolation-service.js";

describe("Tenant isolation provisioning", () => {
  let app: FastifyInstance;
  let stratum: Stratum;

  beforeEach(async () => {
    vi.clearAllMocks();
    stratum = createMockStratum();
    setupAdminApiKey(stratum);
    app = await buildTestApp(stratum);
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ["SCHEMA_PER_TENANT", setupSchemaForTenant],
    ["DB_PER_TENANT", setupDatabaseForTenant],
  ] as const)(
    "removes the new %s tenant when provisioning its storage fails",
    async (strategy, provision) => {
      const tenant = { ...SAMPLE_TENANT, isolation_strategy: strategy };
      (stratum.createTenant as Mock).mockResolvedValue(tenant);
      (provision as Mock).mockRejectedValue(new Error("provisioning failed"));

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/tenants",
        headers: authHeaders(),
        payload: { slug: tenant.slug, name: tenant.name, isolation_strategy: strategy },
      });

      expect(response.statusCode).toBe(500);
      expect(stratum.purgeTenant).toHaveBeenCalledOnce();
      expect((stratum.purgeTenant as Mock).mock.calls[0][0]).toBe(tenant.id);
    },
  );

  it("keeps the tenant when provisioning succeeds", async () => {
    const tenant = { ...SAMPLE_TENANT, isolation_strategy: "SCHEMA_PER_TENANT" };
    (stratum.createTenant as Mock).mockResolvedValue(tenant);
    (setupSchemaForTenant as Mock).mockResolvedValue(undefined);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tenants",
      headers: authHeaders(),
      payload: { slug: tenant.slug, name: tenant.name, isolation_strategy: "SCHEMA_PER_TENANT" },
    });

    expect(response.statusCode).toBe(201);
    expect(stratum.purgeTenant).not.toHaveBeenCalled();
  });

  it.each(["SCHEMA_PER_TENANT", "DB_PER_TENANT"])(
    "batch create rejects %s tenants, which it cannot provision",
    async (strategy) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/tenants/batch",
        headers: authHeaders(),
        payload: {
          tenants: [
            { slug: "batch_ok", name: "OK" },
            { slug: "batch_iso", name: "Iso", isolation_strategy: strategy },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
      expect(stratum.batchCreateTenants).not.toHaveBeenCalled();
    },
  );
});
