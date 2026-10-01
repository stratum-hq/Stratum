import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { Stratum, migrate, migrateAllSchemas } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations } from "./helpers/db.js";

/**
 * enforceRls checks the connecting role every time, not only while migration
 * 001 runs. The test connection (stratum_test) has BYPASSRLS, and the database
 * is already migrated, so no migration would run the check again.
 */

const APP_ROLE = "stratum_enforce_rls_test";
const URL = process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";
const quiet = { info: () => {}, warn: () => {}, error: () => {} };

let appPool: pg.Pool;

beforeAll(async () => {
  await runMigrations();
  const admin = getPool();
  await admin.query(`DO $$ BEGIN
    CREATE ROLE ${APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  appPool = new pg.Pool({ connectionString: URL, max: 1 });
  appPool.on("connect", (c) => {
    c.query(`SET ROLE ${APP_ROLE}`).catch(() => {});
  });
});

afterAll(async () => {
  await appPool.end();
  await closePool();
});

describe("enforceRls on an already-migrated database", () => {
  it("initialize() with autoMigrate refuses a role with BYPASSRLS", async () => {
    const stratum = new Stratum({ pool: getPool(), logger: quiet, autoMigrate: true, enforceRls: true });
    await expect(stratum.initialize()).rejects.toThrow(/BYPASSRLS/);
  });

  it("initialize() without autoMigrate refuses a role with BYPASSRLS", async () => {
    const stratum = new Stratum({ pool: getPool(), logger: quiet, enforceRls: true });
    await expect(stratum.initialize()).rejects.toThrow(/BYPASSRLS/);
  });

  it("migrate() and migrateAllSchemas() refuse a role with BYPASSRLS", async () => {
    await expect(migrate({ pool: getPool(), enforceRls: true })).rejects.toThrow(/BYPASSRLS/);
    await expect(migrateAllSchemas({ pool: getPool(), enforceRls: true })).rejects.toThrow(/BYPASSRLS/);
  });

  it("initialize() accepts a role without BYPASSRLS", async () => {
    const stratum = new Stratum({ pool: appPool, logger: quiet, enforceRls: true });
    await expect(stratum.initialize()).resolves.toBeUndefined();
  });

  it("initialize() without enforceRls does not check the role", async () => {
    const stratum = new Stratum({ pool: getPool(), logger: quiet });
    await expect(stratum.initialize()).resolves.toBeUndefined();
  });
});
