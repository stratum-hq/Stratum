/**
 * Decides whether a table's row-level security policies isolate its rows by
 * tenant, from the policy expressions PostgreSQL stores in pg_policies.
 *
 * PostgreSQL ORs permissive policies together, so a table is isolated only
 * when every permissive policy restricts rows to the current tenant, for
 * reads (USING) and for writes (WITH CHECK). A policy's name proves nothing.
 * Restrictive policies can only narrow access further, so they are not
 * required to filter, but they cannot stand in for a permissive policy.
 *
 * The expression rules live in `@stratum-hq/db-adapters` (the checker that
 * `createPolicy` uses), so the CLI and `createPolicy` accept the same forms:
 * the ones Stratum and its adapters generate, with the operands in either
 * order, with casts, inside an AND with other conditions, ORed with the
 * legacy bypass of migration 032 or the older direct check of app.bypass_rls,
 * and the subtree read of migration 031 in the USING clause of a SELECT
 * policy. Anything else is reported as not isolated with a reason, so an
 * unusual but correct policy is a false alarm, never a false all-clear.
 *
 * A policy named stratum_control_plane that applies to exactly the control
 * role (default stratum_control) is skipped. Other policies for that role
 * must filter like any other.
 */
import { DEFAULT_CONTROL_ROLE, isControlPlanePolicy, permissivePolicyIssue } from "@stratum-hq/db-adapters";

export { DEFAULT_CONTROL_ROLE };

/** One row of pg_policies for a table. */
export interface PolicyRow {
  policyname: string;
  /** "PERMISSIVE" or "RESTRICTIVE". */
  permissive: string;
  /** "ALL", "SELECT", "INSERT", "UPDATE" or "DELETE". */
  cmd: string;
  qual: string | null;
  with_check: string | null;
  /** The roles the policy applies to; ["public"] for PUBLIC. Needed to accept stratum_control_plane. */
  roles?: string[];
}

export interface PolicyVerdict {
  /** True when a permissive policy exists and every permissive policy filters by tenant. */
  isolated: boolean;
  /**
   * Why the existing policies do not isolate the table, or null when they do
   * or when the table has no policies at all (a new policy can be added).
   */
  issue: string | null;
}

/** The session setting that holds the current tenant (set by @stratum-hq/db-adapters, see rls/session.ts). */
const TENANT_SETTING = "app.current_tenant_id";

/**
 * @param functionSchema - The schema of Stratum's tenants table, the only
 *   schema that may qualify stratum_subtree_tenant_ids(). When it is
 *   undefined, only the unqualified function counts.
 * @param controlRole - The control role of migration 032. A policy named
 *   stratum_control_plane that applies to exactly this role is skipped.
 */
export function evaluatePolicies(
  policies: PolicyRow[],
  functionSchema?: string,
  controlRole: string = DEFAULT_CONTROL_ROLE,
): PolicyVerdict {
  if (policies.length === 0) return { isolated: false, issue: null };

  const permissive = policies.filter(
    (p) => p.permissive === "PERMISSIVE" && !isControlPlanePolicy(p, controlRole),
  );
  if (permissive.length === 0) {
    return {
      isolated: false,
      issue: "has only restrictive policies; add a permissive policy that filters by tenant",
    };
  }

  const issues = permissive
    .map((p) => permissivePolicyIssue(p, functionSchema))
    .filter((i): i is string => i !== null);
  if (issues.length > 0) {
    return {
      isolated: false,
      issue: `${issues.join("; ")} (expected tenant_id = current_setting('${TENANT_SETTING}'))`,
    };
  }
  return { isolated: true, issue: null };
}
