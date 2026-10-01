import pg from "pg";
import { bootstrapRolesSql, inspectRoleModel, pinnedQuery, STRATUM_CONTROL_ROLE } from "@stratum-hq/lib";
import { connectDb, getAdminConnectionString, getConnectionString, quoteIdent, roleFlag } from "../utils/db.js";
import { roleModelChecks } from "../utils/role-model.js";
import * as log from "../utils/log.js";

/**
 * `stratum db roles | lock | unlock`: the role model of @stratum-hq/lib
 * migration 032.
 *
 * - `db roles` prints, or with --apply runs, the bootstrap SQL of
 *   bootstrapRolesSql(): the NOLOGIN control role, the admin login as its
 *   member, the Stratum tables and functions the application login owns moved
 *   to the admin login, the control role applied through
 *   stratum_apply_control_role(), and the application login limited to
 *   SELECT on the read-list tables. It touches Stratum's own objects only,
 *   never the application's tables. --grant-references adds REFERENCES on
 *   tenants(id) for the application login (opt-in).
 * - `db lock` turns the legacy app.bypass_rls switch off, `db unlock` turns it
 *   back on. They run as a member of the control role.
 */
export async function db(args: string[], flags: Record<string, string | boolean>): Promise<void> {
  switch (args[0]) {
    case "roles":
      await roles(flags);
      return;
    case "lock":
      await setLegacySwitch(flags, false);
      return;
    case "unlock":
      await setLegacySwitch(flags, true);
      return;
    default:
      console.error(args[0] ? `Unknown db command: ${args[0]}` : "Missing db command.");
      console.error("Usage: stratum db roles [--apply] | db lock | db unlock");
      process.exit(1);
  }
}

/** The `--schema` flag, default public; the schema of the Stratum tables. */
function schemaFlag(flags: Record<string, string | boolean>): string {
  return roleFlag(flags, "schema") ?? "public";
}

/**
 * The control role for --apply: the --control-role flag, else the
 * connection's stratum.control_role setting, else the role this database's
 * stratum_control_plane policies already name, else stratum_control. This is
 * the order migration 032 uses.
 */
async function resolveControlRole(pool: pg.Pool, flag: string | undefined): Promise<string> {
  if (flag !== undefined) return flag;
  const res = await pinnedQuery<{ role: string | null }>(
    pool,
    `SELECT COALESCE(
              NULLIF(current_setting('stratum.control_role', true), ''),
              (SELECT min(r::text) FROM pg_policies p, unnest(p.roles) r WHERE p.policyname = 'stratum_control_plane')
            ) AS role`,
  );
  return res.rows[0]?.role ?? STRATUM_CONTROL_ROLE;
}

/**
 * Refuses --apply on a login that is neither a superuser nor the admin login
 * named by --admin-role. stratum_apply_control_role() grants the control role
 * to the login that runs it, and only the library's admin login may be a
 * member: on a single-login install that would be the application's login.
 */
async function refuseUnnamedMigratingLogin(pool: pg.Pool, adminRole: string | undefined): Promise<void> {
  const res = await pinnedQuery<{ me: string; su: boolean }>(
    pool,
    "SELECT current_user::text AS me, rolsuper AS su FROM pg_roles WHERE rolname = current_user",
  );
  const { me, su } = res.rows[0] ?? { me: "(unknown)", su: false };
  if (su || me === adminRole) return;
  throw new Error(
    `--apply runs as "${me}", which is not a superuser${adminRole === undefined ? "" : ` and not --admin-role ${adminRole}`}. ` +
      "Applying the role model makes the login that runs it a member of the control role, which passes every " +
      "Stratum policy, so it must be the library's admin login. Run it as a superuser, or pass that login as " +
      `--admin-role (--admin-role ${me} if this login is the admin login and not the application's).`,
  );
}

/**
 * The role-model SQL, plus, with --grant-references, REFERENCES on
 * tenants(id) for the application login. That grant is opt-in: it lets the
 * application's tables have a foreign key to tenants (stratum migrate adds
 * one), and it also lets the login create references that make deleting a
 * tenant fail.
 */
function rolesSql(
  flags: Record<string, string | boolean>,
  options: { adminRole?: string; appRole?: string; controlRole?: string; schema: string },
): string {
  const sql = bootstrapRolesSql(options);
  if (flags["grant-references"] !== true) return sql;
  return (
    `${sql}-- Opt-in (--grant-references): foreign keys from the application's tables to tenants(id).\n` +
    `GRANT REFERENCES (id) ON ${quoteIdent(options.schema)}.tenants TO ${quoteIdent(options.appRole as string)};\n`
  );
}

async function roles(flags: Record<string, string | boolean>): Promise<void> {
  const adminRole = roleFlag(flags, "admin-role");
  const appRole = roleFlag(flags, "app-role");
  const controlFlag = roleFlag(flags, "control-role");
  const schema = schemaFlag(flags);
  if (adminRole !== undefined && adminRole === appRole) {
    throw new Error("--admin-role and --app-role must be different logins.");
  }
  if (flags["grant-references"] === true && appRole === undefined) {
    throw new Error("--grant-references needs --app-role: it grants REFERENCES on tenants(id) to that login.");
  }

  if (flags["apply"] !== true) {
    // Print only: no connection, so the output is SQL that can be piped to psql.
    const sql = rolesSql(flags, { adminRole, appRole, controlRole: controlFlag, schema });
    console.log("-- Generated by `stratum db roles`. Review it, then run it once as a superuser,");
    console.log("-- or apply it with `stratum db roles --apply --database-url <superuser url>`.");
    console.log("-- On managed PostgreSQL, where that login is not a superuser, run it as the admin login");
    console.log("-- and name it: --admin-role <that login>.");
    if (adminRole === undefined || appRole === undefined) {
      console.log("-- Without --admin-role and --app-role this only creates and applies the control role.");
      console.log("-- A login that is not a superuser can apply it only with --admin-role <that login>.");
    }
    console.log(sql);
    return;
  }

  log.heading("Stratum role model: apply");
  const pool = await connectDb(flags);
  try {
    await refuseUnnamedMigratingLogin(pool, adminRole);
    const controlRole = await resolveControlRole(pool, controlFlag);
    for (const [flag, role] of [["--admin-role", adminRole], ["--app-role", appRole]] as const) {
      if (role === undefined) continue;
      const exists = await pinnedQuery(pool, "SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
      if (exists.rows.length === 0) {
        throw new Error(
          `${flag} ${role}: no such role. Create the login first, for example: ` +
            `CREATE ROLE ${quoteIdent(role)} LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS;`,
        );
      }
    }
    if (adminRole === undefined || appRole === undefined) {
      log.info(
        "Without --admin-role and --app-role only the control role is created and applied. On managed " +
          "PostgreSQL, where the login that runs this is not a superuser, run it as the admin login with " +
          "--admin-role <that login>.",
      );
    }

    const sql = rolesSql(flags, { adminRole, appRole, controlRole, schema });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Applying the role model failed: ${msg}\n` +
          "  Run it as a superuser, or as a role with CREATEROLE that owns the Stratum tables.",
      );
    } finally {
      client.release();
    }
    log.success(`Applied the role model (control role ${controlRole}, schema ${schema})`);
    if (flags["grant-references"] === true) log.info(`Granted REFERENCES (id) on tenants to ${appRole}.`);

    const report = await withSchemaPool(flags, schema, (verify) =>
      inspectRoleModel({ pool: verify, appRole, adminRole, controlRole }),
    );
    console.log();
    let active = true;
    for (const check of roleModelChecks(report)) {
      if (check.label === "Control role" && check.status !== "pass") active = false;
      const line = `${check.label}: ${check.summary}`;
      if (check.status === "pass") log.success(line);
      else if (check.status === "warn") log.warn(line);
      else log.fail(line);
      check.details?.forEach((d) => log.dim(`  ${d}`));
    }
    console.log();
    if (!active) {
      log.fail("The control role is not applied; the hardening is not active.");
      process.exit(1);
    }
    log.info("Next: deploy with adminPool (DATABASE_ADMIN_URL), then run `stratum db lock`.");
    console.log();
  } finally {
    await pool.end();
  }
}

/** Runs `fn` with a pool on the --database-url connection whose search_path is `schema`. */
async function withSchemaPool<T>(
  flags: Record<string, string | boolean>,
  schema: string,
  fn: (pool: pg.Pool) => Promise<T>,
): Promise<T> {
  const pool = new pg.Pool({
    connectionString: getConnectionString(flags),
    max: 1,
    options: `-c search_path=${quoteIdent(schema)}`,
  });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

/**
 * The application login: --app-role, else, when an admin connection is
 * given, the user of --database-url (or DATABASE_URL). Undefined when it
 * cannot be told apart from the admin login.
 */
function appLogin(flags: Record<string, string | boolean>): string | undefined {
  const named = roleFlag(flags, "app-role");
  if (named !== undefined) return named;
  if (getAdminConnectionString(flags) === undefined) return undefined;
  const explicit = flags["database-url"] || flags["d"];
  const url = typeof explicit === "string" ? explicit : process.env.DATABASE_URL;
  if (!url) return undefined;
  try {
    return decodeURIComponent(new URL(url).username) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Refuses to lock while the application login is a member of the control
 * role: such a login passes every Stratum policy, so turning the legacy
 * switch off would not limit it.
 */
async function refuseAppLoginInControlRole(
  pool: pg.Pool,
  flags: Record<string, string | boolean>,
  schema: string,
): Promise<void> {
  const app = appLogin(flags);
  if (app === undefined) return;
  const res = await pinnedQuery<{ control: string; member: boolean }>(
    pool,
    `SELECT c.rolname::text AS control, NOT r.rolsuper AND pg_has_role(r.oid, c.oid, 'MEMBER') AS member
       FROM pg_roles r, pg_roles c
      WHERE r.rolname = $1
        AND c.rolname IN (SELECT x::text FROM pg_policies p, unnest(p.roles) x
                           WHERE p.schemaname = $2 AND p.tablename = 'tenants' AND p.policyname = 'stratum_control_plane')`,
    [app, schema],
  );
  const hit = res.rows.find((r) => r.member);
  if (hit) {
    throw new Error(
      `The application login "${app}" is a member of the control role "${hit.control}", so it passes every Stratum ` +
        `policy and locking would not limit it. Remove it first (REVOKE ${quoteIdent(hit.control)} FROM ${quoteIdent(app)}), ` +
        "and give the library a separate admin login.",
    );
  }
}

/**
 * Sets the legacy switch of migration 032 in one schema. The UPDATE runs as
 * the login of --admin-database-url (DATABASE_ADMIN_URL), else of
 * --database-url. Only a member of the control role (or a superuser) sees
 * the row, so for any other login the UPDATE matches nothing and the command
 * fails instead of reporting a change it did not make.
 */
async function setLegacySwitch(flags: Record<string, string | boolean>, on: boolean): Promise<void> {
  const schema = schemaFlag(flags);
  log.heading(on ? "Stratum: unlock the legacy app.bypass_rls path" : "Stratum: lock the legacy app.bypass_rls path");
  const connectionString = getAdminConnectionString(flags) ?? getConnectionString(flags);
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    const state = await pinnedQuery<{ migrated: boolean; applied: boolean }>(
      pool,
      `SELECT to_regclass($1) IS NOT NULL AS migrated,
              EXISTS (SELECT 1 FROM pg_policies
                       WHERE schemaname = $2 AND tablename = 'tenants' AND policyname = 'stratum_control_plane') AS applied`,
      [`${quoteIdent(schema)}.stratum_security`, schema],
    );
    if (!state.rows[0]?.migrated) {
      throw new Error(`Migration 032 has not run in schema "${schema}": there is no legacy switch to set.`);
    }
    if (!on && !state.rows[0].applied) {
      throw new Error(
        "The control role is not applied (hardening not active), so the library still needs the legacy path. " +
          "Run `stratum db roles --apply` first.",
      );
    }

    if (!on) await refuseAppLoginInControlRole(pool, flags, schema);

    let updated;
    try {
      updated = await pinnedQuery<{ legacy_guc_bypass: boolean }>(
        pool,
        `UPDATE ${quoteIdent(schema)}.stratum_security
            SET legacy_guc_bypass = $1, updated_at = now()
          RETURNING legacy_guc_bypass`,
        [on],
      );
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "42501") throw err;
      updated = { rows: [] };
    }
    if (updated.rows.length === 0) {
      throw new Error(
        "This login cannot change the legacy switch. Connect as a member of the control role: " +
          "--admin-database-url or DATABASE_ADMIN_URL.",
      );
    }

    if (on) {
      log.success(`Legacy switch on in schema "${schema}": a session that sets app.bypass_rls passes the tenant policies again.`);
      log.warn("This reopens the legacy path. Turn it off again with `stratum db lock`.");
    } else {
      log.success(`Legacy switch off in schema "${schema}": app.bypass_rls admits nothing.`);
      log.info(
        "Clients that still use the legacy path (Stratum without adminPool, the CLI without " +
          "--admin-database-url, withRlsBypass) no longer reach rows across tenants. Undo with `stratum db unlock`.",
      );
    }
    console.log();
  } finally {
    await pool.end();
  }
}
