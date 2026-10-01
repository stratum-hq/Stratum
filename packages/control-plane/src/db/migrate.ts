import { migrate as runMigrations } from "@stratum-hq/lib";
import { getAdminPool, getPool } from "./connection.js";

async function migrate(): Promise<void> {
  console.log("Running migrations...");
  const adminPool = getAdminPool();
  // The control role of lib migration 032 (see config.controlRole). Unset:
  // the database's, else stratum_control.
  const controlRole = process.env.STRATUM_CONTROL_ROLE ? { controlRole: process.env.STRATUM_CONTROL_ROLE } : {};
  if (adminPool) {
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
