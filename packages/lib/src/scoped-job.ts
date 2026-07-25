import type pg from "pg";
import { runWithTenantContext } from "@stratum-hq/sdk";
import { withTenantContext } from "@stratum-hq/db-adapters";
import { IsolationStrategy } from "@stratum-hq/core";
import type { ResolvedTenantContext } from "@stratum-hq/core";

/**
 * The unit of work a background job runs. It receives the RLS-scoped pooled
 * client bound to the job's tenant; every query issued on this client is
 * confined to that tenant by Postgres row-level security.
 */
export type ScopedJobFn<T> = (client: pg.PoolClient) => Promise<T>;

export interface RunScopedJobOptions {
  /**
   * Populate the full {@link ResolvedTenantContext} placed in the
   * AsyncLocalStorage store for the job. Job code can then read it through
   * `Stratum.currentTenantContext()` exactly as a request handler does.
   *
   * When omitted, a minimal placeholder context carrying only the tenant
   * identity is used: `resolved_config` and `resolved_permissions` are empty.
   * This mirrors the default in `@stratum-hq/hono`'s middleware. The isolation
   * boundary (the RLS `app.current_tenant_id`) does NOT depend on this callback;
   * it only enriches what in-job code can read from the ALS context.
   */
  resolve?: (
    tenantId: string,
  ) => ResolvedTenantContext | Promise<ResolvedTenantContext>;
}

function placeholderContext(tenantId: string): ResolvedTenantContext {
  return {
    tenant_id: tenantId,
    ancestry_path: tenantId,
    depth: 0,
    resolved_config: {},
    resolved_permissions: {},
    isolation_strategy: IsolationStrategy.SHARED_RLS,
  };
}

/**
 * Runs a background job bound to a single tenant.
 *
 * A job scoped with this helper carries its tenant context in two layers, both
 * established before `fn` runs and both torn down when it settles:
 *
 * 1. AsyncLocalStorage: the tenant context is placed in the SDK's ALS store via
 *    `runWithTenantContext`, so code inside the job sees the same tenant through
 *    `Stratum.currentTenantId()` / `Stratum.currentTenantContext()` that a
 *    request handler would. Each job gets its own store; concurrent jobs cannot
 *    observe each other's tenant (async isolation), and the store is gone once
 *    the job settles.
 * 2. Postgres row-level security: the work runs through the data-plane
 *    `withTenantContext` (packages/db-adapters), which opens a transaction and
 *    issues `SET LOCAL app.current_tenant_id`. Every query `fn` makes on the
 *    provided client is confined to that tenant by RLS, so a job cannot read or
 *    write another tenant's rows even if it forgets a `WHERE tenant_id` filter.
 *    `SET LOCAL` resets at COMMIT / ROLLBACK, so the context cannot leak onto the
 *    next job that reuses the pooled connection.
 *
 * This is deliberately NOT the control-plane bypass path (`withClient` /
 * `withTransaction` in this package, which set `app.bypass_rls`). Background
 * jobs are tenant-scoped data-plane work and must stay subject to isolation.
 * See ADR 0001 (docs/adr/0001-postgres-rls-defense-in-depth.md).
 *
 * @param pool     A pool whose connections use a NON-superuser, NON-BYPASSRLS
 *                 role. A superuser connection bypasses RLS and the scoping is a
 *                 no-op.
 * @param tenantId The tenant the job is confined to.
 * @param fn       The job body; receives the tenant-scoped client.
 * @param options  Optionally resolve the full ALS context (see
 *                 {@link RunScopedJobOptions.resolve}).
 */
export async function runScopedJob<T>(
  pool: pg.Pool,
  tenantId: string,
  fn: ScopedJobFn<T>,
  options: RunScopedJobOptions = {},
): Promise<T> {
  const context = options.resolve
    ? await options.resolve(tenantId)
    : placeholderContext(tenantId);
  return runWithTenantContext(context, () =>
    withTenantContext(pool, tenantId, fn),
  );
}
