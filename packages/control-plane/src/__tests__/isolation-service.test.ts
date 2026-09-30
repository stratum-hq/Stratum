import { describe, it, expect, vi, beforeEach } from "vitest";

const release = vi.fn();
vi.mock("../db/connection.js", () => ({
  getPool: () => ({ connect: async () => ({ release }) }),
}));

vi.mock("@stratum-hq/db-adapters", () => ({
  createSchema: vi.fn(),
  dropSchema: vi.fn(),
  replicateTableToSchema: vi.fn(),
  tenantSchemaName: (slug: string) => `tenant_${slug}`,
  createDatabase: vi.fn(),
  databaseExists: vi.fn(),
  dropDatabase: vi.fn(),
}));

import { createDatabase, databaseExists, dropDatabase } from "@stratum-hq/db-adapters";
import { setupDatabaseForTenant, teardownDatabaseForTenant } from "../services/isolation-service.js";

describe("setupDatabaseForTenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates the tenant database when none exists", async () => {
    vi.mocked(databaseExists).mockResolvedValue(false);
    await setupDatabaseForTenant("acme");
    expect(createDatabase).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("refuses to reuse a database that already exists", async () => {
    vi.mocked(databaseExists).mockResolvedValue(true);
    await expect(setupDatabaseForTenant("acme")).rejects.toThrow(/already exists/);
    expect(createDatabase).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
});

describe("teardownDatabaseForTenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drops the tenant database", async () => {
    await teardownDatabaseForTenant("acme");
    expect(dropDatabase).toHaveBeenCalledOnce();
    expect(vi.mocked(dropDatabase).mock.calls[0][1]).toBe("acme");
    expect(release).toHaveBeenCalledOnce();
  });
});
