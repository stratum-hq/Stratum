import { migrate as runMigrations } from "@stratum-hq/lib";
import type pg from "pg";
import { getAdminPool, getPool } from "./connection.js";

async function currentLogin(pool: pg.Pool): Promise<string> {
  const res = await pool.query<{ me: string }>("SELECT current_user::text AS me");
  return res.rows[0].me;
}

async function migrate(): Promise<void> {
  console.log("Running migrations...");
  const adminPool = getAdminPool();
  // The control role of lib migration 032 (see config.controlRole). Unset:
  // the database's, else stratum_control.
  const controlRole = process.env.STRATUM_CONTROL_ROLE ? { controlRole: process.env.STRATUM_CONTROL_ROLE } : {};
  if (adminPool) {
    // Migration 032 grants the control role to the admin login, so it must
    // not be the application's login.
    const admin = await currentLogin(adminPool);
    if (admin === (await currentLogin(getPool()))) {
      throw new Error(
        `DATABASE_ADMIN_URL and DATABASE_URL log in as the same role "${admin}". DATABASE_ADMIN_URL must be a ` +
          "separate login: the migrations make it a member of the control role, which passes every Stratum policy.",
      );
    }
    // The admin login owns the Stratum objects and is a member of the control
    // role. It may have BYPASSRLS, so the RLS check below is about the
    // application login, which Stratum.initialize() checks in buildApp().
    // It is the admin login, so migration 032 may grant it the control role.
    await runMigrations({ pool: adminPool, applyControlRole: true, ...controlRole });
  } else {
    // RLS is enforced everywhere except local development and test runs (an
    // unset NODE_ENV counts as development), matching the JWT_SECRET checks.
    const nodeEnv = process.env.NODE_ENV || "development";
    const enforceRls = nodeEnv !== "development" && nodeEnv !== "test";
    await runMigrations({ pool: getPool(), enforceRls, ...controlRole });
  }
  console.log("Migrations complete.");
}

export { migrate };
