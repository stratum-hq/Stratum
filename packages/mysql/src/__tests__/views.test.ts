import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createTenantView,
  dropTenantView,
  setTenantSession,
} from "../views/manager.js";
import type { MysqlPoolLike, MysqlConnectionLike } from "../types.js";

function createMockPool(): MysqlPoolLike {
  return {
    getConnection: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue([]),
      release: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    }),
    query: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockConnection(): MysqlConnectionLike {
  return {
    query: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

describe("views/manager", () => {
  describe("createTenantView", () => {
    it("generates correct CREATE OR REPLACE VIEW SQL", async () => {
      const pool = createMockPool();
      await createTenantView(pool, "orders", "orders_view");
      expect(pool.query).toHaveBeenCalledWith(
        "CREATE OR REPLACE VIEW `orders_view` AS SELECT * FROM `orders` WHERE tenant_id = @stratum_tenant_id",
      );
    });

    it("uses default view name when viewName is not provided", async () => {
      const pool = createMockPool();
      await createTenantView(pool, "orders");
      expect(pool.query).toHaveBeenCalledWith(
        "CREATE OR REPLACE VIEW `orders_tenant_view` AS SELECT * FROM `orders` WHERE tenant_id = @stratum_tenant_id",
      );
    });
  });

  describe("dropTenantView", () => {
    it("generates correct DROP VIEW IF EXISTS SQL", async () => {
      const pool = createMockPool();
      await dropTenantView(pool, "orders_view");
      expect(pool.query).toHaveBeenCalledWith("DROP VIEW IF EXISTS `orders_view`");
    });
  });

  describe("setTenantSession", () => {
    let connection: MysqlConnectionLike;

    beforeEach(() => {
      connection = createMockConnection();
    });

    it("sets @stratum_tenant_id with the given tenantId", async () => {
      await setTenantSession(connection, "tenant1");
      expect(connection.execute).toHaveBeenCalledWith(
        "SET @stratum_tenant_id = ?",
        ["tenant1"],
      );
    });

    it("clears the session variable when tenantId is null", async () => {
      await setTenantSession(connection, null);
      expect(connection.execute).toHaveBeenCalledWith("SET @stratum_tenant_id = NULL");
    });
  });
});
