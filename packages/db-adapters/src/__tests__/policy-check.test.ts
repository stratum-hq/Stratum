import { describe, it, expect } from "vitest";
import { tablePolicyIssues, type PolicyRow } from "../rls/policy-check.js";

// Expressions below are in the deparsed form PostgreSQL 16 stores in pg_policies.
const GENERATED =
  "(tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)";
const WITH_BYPASS =
  "((current_setting('app.bypass_rls'::text, true) = 'on'::text) OR " +
  "(tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid))";

// The read-only subtree policy of migration 031, as pg_policies stores it.
const SUBTREE_IDS =
  "(tenant_id = ANY (( SELECT stratum_subtree_tenant_ids() AS stratum_subtree_tenant_ids)::uuid[]))";
const SCOPE_SUBTREE = "(current_setting('app.tenant_scope'::text, true) = 'subtree'::text)";
const SUBTREE_READ = `(${SCOPE_SUBTREE} AND ${SUBTREE_IDS})`;

function policy(overrides: Partial<PolicyRow>): PolicyRow {
  return {
    policyname: "tenant_isolation",
    permissive: "PERMISSIVE",
    cmd: "ALL",
    qual: GENERATED,
    with_check: null,
    roles: ["public"],
    ...overrides,
  };
}

describe("tablePolicyIssues", () => {
  describe("accepts policies that filter by tenant", () => {
    const cases: Array<[string, PolicyRow[]]> = [
      ["no policies", []],
      ["the policy createPolicy generates", [policy({})]],
      ["without NULLIF", [policy({ qual: "(tenant_id = (current_setting('app.current_tenant_id'::text))::uuid)" })]],
      ["with Stratum's administrative bypass OR the tenant match", [policy({ qual: WITH_BYPASS })]],
      [
        "with the operands reversed",
        [policy({ qual: "((NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid = tenant_id)" })],
      ],
      ["ANDed with another condition", [policy({ qual: `(${GENERATED} AND (deleted_at IS NULL))` })]],
      ["with a matching WITH CHECK", [policy({ with_check: GENERATED })]],
      [
        "other per-command permissive policies that filter",
        [
          policy({}),
          policy({ policyname: "r", cmd: "SELECT", roles: ["app_user"] }),
          policy({ policyname: "w", cmd: "INSERT", qual: null, with_check: GENERATED }),
        ],
      ],
      [
        "the read-only subtree policy of migration 031 next to tenant_isolation",
        [policy({}), policy({ policyname: "tenant_subtree_read", cmd: "SELECT", qual: SUBTREE_READ })],
      ],
      [
        "the subtree policy with a schema-qualified function",
        [
          policy({}),
          policy({
            policyname: "tenant_subtree_read",
            cmd: "SELECT",
            qual: SUBTREE_READ.replace("SELECT stratum_", "SELECT public.stratum_"),
          }),
        ],
      ],
      [
        "the subtree policy with the conditions reversed",
        [policy({}), policy({ policyname: "tenant_subtree_read", cmd: "SELECT", qual: `(${SUBTREE_IDS} AND ${SCOPE_SUBTREE})` })],
      ],
      [
        "a restrictive policy on another condition",
        [policy({}), policy({ policyname: "extra", permissive: "RESTRICTIVE", qual: "true" })],
      ],
    ];
    for (const [name, policies] of cases) {
      it(name, () => {
        expect(tablePolicyIssues(policies)).toEqual([]);
      });
    }
  });

  describe("reports policies that do not isolate by tenant", () => {
    const cases: Array<[string, PolicyRow[], RegExp]> = [
      ["USING (true)", [policy({ qual: "true" })], /USING \(true\) does not filter by tenant/],
      [
        "a different setting",
        [policy({ qual: "(tenant_id = (current_setting('app.other_tenant'::text, true))::uuid)" })],
        /does not filter by tenant/,
      ],
      ["the tenant match ORed with true", [policy({ qual: `(${GENERATED} OR true)` })], /does not filter by tenant/],
      [
        "the bypass alone",
        [policy({ qual: "(current_setting('app.bypass_rls'::text, true) = 'on'::text)" })],
        /does not filter by tenant/,
      ],
      ["a WITH CHECK of true", [policy({ with_check: "true" })], /WITH CHECK \(true\) does not filter by tenant/],
      ["a restrictive tenant_isolation", [policy({ permissive: "RESTRICTIVE" })], /restrictive, not permissive/],
      ["a tenant_isolation for SELECT only", [policy({ cmd: "SELECT" })], /SELECT only, not ALL commands/],
      ["a tenant_isolation for specific roles", [policy({ roles: ["app_user"] })], /roles app_user, not PUBLIC/],
      [
        "another permissive policy that does not filter",
        [policy({}), policy({ policyname: "open_read", cmd: "SELECT", qual: "true" })],
        /"open_read" \(SELECT\) USING \(true\) does not filter by tenant/,
      ],
      [
        "another permissive policy for a specific role that does not filter",
        [policy({}), policy({ policyname: "admin_all", roles: ["admin"], qual: "true" })],
        /"admin_all" \(ALL\) USING \(true\)/,
      ],
      [
        "a subtree read without the scope check, which widens every session",
        [policy({}), policy({ policyname: "s", cmd: "SELECT", qual: SUBTREE_IDS })],
        /"s" \(SELECT\) USING/,
      ],
      [
        "a subtree read whose scope check names another value",
        [policy({}), policy({ policyname: "s", cmd: "SELECT", qual: SUBTREE_READ.replace("'subtree'", "'all'") })],
        /"s" \(SELECT\) USING/,
      ],
      [
        "a subtree read ORed with the scope check",
        [policy({}), policy({ policyname: "s", cmd: "SELECT", qual: `(${SCOPE_SUBTREE} OR ${SUBTREE_IDS})` })],
        /"s" \(SELECT\) USING/,
      ],
      [
        "a subtree predicate in a policy for ALL commands, which lets DELETE reach descendants",
        [policy({}), policy({ policyname: "s", cmd: "ALL", qual: SUBTREE_READ })],
        /"s" \(ALL\) USING/,
      ],
      [
        "a subtree predicate in an INSERT WITH CHECK",
        [policy({}), policy({ policyname: "s", cmd: "INSERT", qual: null, with_check: SUBTREE_READ })],
        /"s" \(INSERT\) WITH CHECK/,
      ],
      [
        "a permissive INSERT policy with WITH CHECK (true)",
        [policy({}), policy({ policyname: "open_insert", cmd: "INSERT", qual: null, with_check: "true" })],
        /"open_insert" \(INSERT\) WITH CHECK \(true\)/,
      ],
    ];
    for (const [name, policies, message] of cases) {
      it(name, () => {
        expect(tablePolicyIssues(policies).join("; ")).toMatch(message);
      });
    }
  });
});
