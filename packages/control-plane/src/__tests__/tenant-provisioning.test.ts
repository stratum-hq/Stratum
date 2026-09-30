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
  teardownSchemaForTenant: vi.fn(),
  teardownDatabaseForTenant: vi.fn(),
}));

import {
  setupSchemaForTenant,
  setupDatabaseForTenant,
  teardownSchemaForTenant,
  teardownDatabaseForTenant,
} from "../services/isolation-service.js";

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
    "leaves the new %s tenant pending when provisioning its storage fails",
    async (strategy, provision) => {
      const tenant = { ...SAMPLE_TENANT, isolation_strategy: strategy, status: "pending" };
      (stratum.createTenant as Mock).mockResolvedValue(tenant);
      (provision as Mock).mockRejectedValue(new Error("provisioning failed"));

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/tenants",
        headers: authHeaders(),
        payload: { slug: tenant.slug, name: tenant.name, isolation_strategy: strategy },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe("TENANT_PROVISIONING_FAILED");
      expect(response.json().error.details.tenant_id).toBe(tenant.id);
      expect(stratum.activateTenant).not.toHaveBeenCalled();
      expect(stratum.purgeTenant).not.toHaveBeenCalled();
    },
  );

  it("activates the tenant once provisioning succeeds", async () => {
    const tenant = { ...SAMPLE_TENANT, isolation_strategy: "SCHEMA_PER_TENANT", status: "pending" };
    (stratum.createTenant as Mock).mockResolvedValue(tenant);
    (setupSchemaForTenant as Mock).mockResolvedValue(undefined);
    (stratum.activateTenant as Mock).mockResolvedValue({ ...tenant, status: "active" });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tenants",
      headers: authHeaders(),
      payload: { slug: tenant.slug, name: tenant.name, isolation_strategy: "SCHEMA_PER_TENANT" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe("active");
    expect((stratum.activateTenant as Mock).mock.calls[0][0]).toBe(tenant.id);
    expect(stratum.purgeTenant).not.toHaveBeenCalled();
  });

  function createIsolated(strategy: string) {
    return app.inject({
      method: "POST",
      url: "/api/v1/tenants",
      headers: authHeaders(),
      payload: { slug: SAMPLE_TENANT.slug, name: SAMPLE_TENANT.name, isolation_strategy: strategy },
    });
  }

  it.each([
    ["SCHEMA_PER_TENANT", teardownSchemaForTenant, teardownDatabaseForTenant],
    ["DB_PER_TENANT", teardownDatabaseForTenant, teardownSchemaForTenant],
  ] as const)(
    "removes the %s storage it provisioned when activation fails, and leaves the tenant pending",
    async (strategy, teardown, otherTeardown) => {
      const tenant = { ...SAMPLE_TENANT, isolation_strategy: strategy, status: "pending" };
      (stratum.createTenant as Mock).mockResolvedValue(tenant);
      (stratum.activateTenant as Mock).mockRejectedValue(new Error("activation failed"));
      (stratum.getTenant as Mock).mockResolvedValue(tenant);

      const response = await createIsolated(strategy);

      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe("TENANT_PROVISIONING_FAILED");
      expect(response.json().error.details).toEqual({
        tenant_id: tenant.id,
        status: "pending",
        stage: "activation",
        storage_removed: true,
      });
      expect(teardown).toHaveBeenCalledWith(tenant.slug);
      expect(otherTeardown).not.toHaveBeenCalled();
      expect(stratum.purgeTenant).not.toHaveBeenCalled();
    },
  );

  it("reports storage_removed false when removing the provisioned storage also fails", async () => {
    const tenant = { ...SAMPLE_TENANT, isolation_strategy: "SCHEMA_PER_TENANT", status: "pending" };
    (stratum.createTenant as Mock).mockResolvedValue(tenant);
    (stratum.activateTenant as Mock).mockRejectedValue(new Error("activation failed"));
    (stratum.getTenant as Mock).mockResolvedValue(tenant);
    (teardownSchemaForTenant as Mock).mockRejectedValue(new Error("drop failed"));

    const response = await createIsolated("SCHEMA_PER_TENANT");

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe("TENANT_PROVISIONING_FAILED");
    expect(response.json().error.details).toMatchObject({ stage: "activation", storage_removed: false });
  });

  it("keeps the storage and returns the tenant when activation reports an error but the tenant is active", async () => {
    const tenant = { ...SAMPLE_TENANT, isolation_strategy: "SCHEMA_PER_TENANT", status: "pending" };
    (stratum.createTenant as Mock).mockResolvedValue(tenant);
    (stratum.activateTenant as Mock).mockRejectedValue(new Error("connection lost after commit"));
    (stratum.getTenant as Mock).mockResolvedValue({ ...tenant, status: "active" });

    const response = await createIsolated("SCHEMA_PER_TENANT");

    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe("active");
    expect(teardownSchemaForTenant).not.toHaveBeenCalled();
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
