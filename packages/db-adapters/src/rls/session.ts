import pg from "pg";

/**
 * Which rows a tenant context can read.
 *
 * - "exact": the rows of the tenant only. This is the default.
 * - "subtree": the rows of the tenant and of every descendant, through the
 *   tenant_subtree_read policies of migration 031. Writes stay limited to the
 *   exact tenant in both scopes, and so do reads of credential-bearing rows
 *   (api_keys, webhooks and sensitive config_entries).
 */
export type TenantScope = "exact" | "subtree";

export interface TenantContextOptions {
  /** The read scope. Default "exact". */
  scope?: TenantScope;
}

/** The value of app.tenant_scope for a scope. Only 'subtree' widens reads. */
function scopeSetting(options: TenantContextOptions): string {
  const scope = options.scope ?? "exact";
  if (scope !== "exact" && scope !== "subtree") {
    throw new Error(
      `[stratum] Unknown tenant scope: ${String(scope)} (expected "exact" or "subtree")`,
    );
  }
  return scope === "subtree" ? "subtree" : "";
}

/**
 * Sets the tenant and the read scope for the current transaction.
 *
 * It always writes both settings, so a second call in the same transaction
 * replaces an earlier "subtree" scope instead of keeping it.
 */
export async function setTenantContext(
  client: pg.PoolClient,
  tenantId: string,
  options: TenantContextOptions = {},
): Promise<void> {
  await client.query(
    "SELECT set_config('app.current_tenant_id', $1, true), set_config('app.tenant_scope', $2, true)",
    [tenantId, scopeSetting(options)],
  );
}

export async function resetTenantContext(client: pg.PoolClient): Promise<void> {
  await client.query(
    "SELECT set_config('app.current_tenant_id', '', true), set_config('app.tenant_scope', '', true)",
  );
}

/**
 * Runs `fn` in a transaction that is scoped to one tenant.
 *
 * @param options `{ scope: "subtree" }` also lets `fn` read the rows of every
 *                descendant of the tenant. Writes stay limited to the tenant.
 * @throws Error when `options.scope` is not "exact" or "subtree".
 */
export async function withTenantContext<T>(
  pool: pg.Pool,
  tenantId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
  options: TenantContextOptions = {},
): Promise<T> {
  // Fail on an unknown scope before a connection is taken.
  scopeSetting(options);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setTenantContext(client, tenantId, options);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

let warnedRlsBypass = false;

/**
 * @deprecated Since 1.8 the library reaches across tenants through the control
 * role of migration 032 (Stratum's `adminPool`), not through this setting.
 * Removed in 2.0. Once the stratum_security legacy switch is off, the setting
 * opens nothing, so this helper sees only what the pool's role sees.
 *
 * Runs `fn` inside a transaction with the RLS bypass flag set, so control-plane
 * / system operations that legitimately span tenant boundaries (provisioning,
 * cascade ops, ancestry reads) can see and write all rows.
 *
 * The flag is set with `SET LOCAL` semantics (set_config third arg `true`), so it
 * is transaction scoped and cannot leak into a later request that reuses the same
 * pooled connection. This is the audited system path referenced by the RLS
 * policies (which admit `current_setting('app.bypass_rls', true) = 'on'`).
 *
 * Use sparingly and only for operations that are known to require cross-tenant
 * access. Tenant-scoped work should use `withTenantContext` instead.
 */
export async function withRlsBypass<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (!warnedRlsBypass) {
    warnedRlsBypass = true;
    process.emitWarning(
      "withRlsBypass is deprecated and will be removed in 2.0. Run cross-tenant work on a pool whose " +
        "login is a member of the Stratum control role (migration 032) instead.",
      { type: "DeprecationWarning", code: "STRATUM_WITH_RLS_BYPASS" },
    );
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'on', true)");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getCurrentTenantId(
  client: pg.PoolClient,
): Promise<string | null> {
  const res = await client.query<{ current_setting: string }>(
    `SELECT current_setting('app.current_tenant_id', true) AS current_setting`,
  );
  const value = res.rows[0]?.current_setting;
  return value || null;
}
