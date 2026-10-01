import { describe, it, expect } from "vitest";
import { evaluatePolicies, type PolicyRow } from "../policy-check.js";

// Expressions below are copied from pg_policies on PostgreSQL 16, which is how
// the CLI sees them: PostgreSQL rewrites a policy into this deparsed form.
const GENERATED =
  "(tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)";
const WITHOUT_NULLIF = "(tenant_id = (current_setting('app.current_tenant_id'::text))::uuid)";
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
    ...overrides,
  };
}

describe("evaluatePolicies", () => {
  describe("counts a table as isolated", () => {
    const cases: Array<[string, PolicyRow[]]> = [
      ["with the policy Stratum generates", [policy({})]],
      ["with the older policy without NULLIF", [policy({ qual: WITHOUT_NULLIF })]],
      ["with Stratum's administrative bypass OR the tenant match", [policy({ qual: WITH_BYPASS })]],
      [
        "with the operands reversed",
        [policy({ qual: "((NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid = tenant_id)" })],
      ],
      [
        "with a text comparison instead of a uuid cast",
        [policy({ qual: "((tenant_id)::text = current_setting('app.current_tenant_id'::text, true))" })],
      ],
      [
        "with the tenant match ANDed with another condition",
        [policy({ qual: `(${GENERATED} AND (deleted_at IS NULL))` })],
      ],
      [
        "with separate per-command policies that all filter",
        [
          policy({ policyname: "r", cmd: "SELECT" }),
          policy({ policyname: "w", cmd: "INSERT", qual: null, with_check: GENERATED }),
          policy({ policyname: "u", cmd: "UPDATE", with_check: GENERATED }),
        ],
      ],
      [
        "with the read-only subtree policy of migration 031 next to tenant_isolation",
        [policy({}), policy({ policyname: "tenant_subtree_read", cmd: "SELECT", qual: SUBTREE_READ })],
      ],
      [
        "with the subtree policy, using a schema-qualified function",
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
        "with the subtree policy, using the conditions reversed",
        [policy({}), policy({ policyname: "tenant_subtree_read", cmd: "SELECT", qual: `(${SUBTREE_IDS} AND ${SCOPE_SUBTREE})` })],
      ],
      [
        "with a restrictive policy on another condition next to a filtering one",
        [policy({}), policy({ policyname: "extra", permissive: "RESTRICTIVE", qual: "true" })],
      ],
      [
        "with the expression spread over several lines",
        [policy({ qual: "(tenant_id =\n    (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)" })],
      ],
    ];
    for (const [name, policies] of cases) {
      it(name, () => {
        expect(evaluatePolicies(policies, "public")).toEqual({ isolated: true, issue: null });
      });
    }
  });

  describe("does not count a table as isolated", () => {
    const cases: Array<[string, PolicyRow[], RegExp]> = [
      ["when tenant_isolation admits every row", [policy({ qual: "true" })], /"tenant_isolation" \(ALL\) USING \(true\)/],
      ["when the policy checks something other than the tenant", [policy({ qual: "(tenant_id IS NOT NULL)" })], /USING/],
      [
        "when the policy compares tenant_id with another setting",
        [policy({ qual: "(tenant_id = (current_setting('app.some_other_id'::text))::uuid)" })],
        /USING/,
      ],
      [
        "when another column is compared with the tenant setting",
        [policy({ qual: "(owner_id = (current_setting('app.current_tenant_id'::text))::uuid)" })],
        /USING/,
      ],
      ["when the tenant match is ORed with true", [policy({ qual: `(${GENERATED} OR true)` })], /USING/],
      [
        "when the tenant match is only negated",
        [policy({ qual: `(NOT ${GENERATED})` })],
        /USING/,
      ],
      [
        "when only the administrative bypass is checked",
        [policy({ qual: "(current_setting('app.bypass_rls'::text, true) = 'on'::text)" })],
        /USING/,
      ],
      [
        "when a second permissive policy admits every row",
        [policy({}), policy({ policyname: "allow_all", cmd: "SELECT", qual: "true" })],
        /"allow_all" \(SELECT\)/,
      ],
      [
        "when reads filter but WITH CHECK lets writes name any tenant",
        [policy({ with_check: "true" })],
        /WITH CHECK \(true\)/,
      ],
      [
        "when an INSERT policy checks nothing",
        [policy({ cmd: "INSERT", qual: null, with_check: "true" })],
        /"tenant_isolation" \(INSERT\) WITH CHECK/,
      ],
      [
        "when the tenant match sits inside a subquery on another table",
        [
          policy({
            qual:
              "(EXISTS ( SELECT 1 FROM other o WHERE (o.tenant_id = (current_setting('app.current_tenant_id'::text))::uuid)))",
          }),
        ],
        /USING/,
      ],
      [
        "with a subtree read without the scope check, which widens every session",
        [policy({}), policy({ policyname: "s", cmd: "SELECT", qual: SUBTREE_IDS })],
        /"s" \(SELECT\) USING/,
      ],
      [
        "with a subtree read whose scope check names another value",
        [policy({}), policy({ policyname: "s", cmd: "SELECT", qual: SUBTREE_READ.replace("'subtree'", "'all'") })],
        /"s" \(SELECT\) USING/,
      ],
      [
        "with a subtree read through a function whose name only ends like the subtree function",
        [
          policy({}),
          policy({
            policyname: "s",
            cmd: "SELECT",
            qual: SUBTREE_READ.replace("SELECT stratum_", "SELECT public_stratum_"),
          }),
        ],
        /"s" \(SELECT\) USING/,
      ],
      [
        "with a subtree read through evil.stratum_subtree_tenant_ids(), a schema that does not hold tenants",
        [
          policy({}),
          policy({
            policyname: "s",
            cmd: "SELECT",
            qual: SUBTREE_READ.replace("SELECT stratum_", "SELECT evil.stratum_"),
          }),
        ],
        /"s" \(SELECT\) USING/,
      ],
      [
        "with a subtree read ORed with the scope check",
        [policy({}), policy({ policyname: "s", cmd: "SELECT", qual: `(${SCOPE_SUBTREE} OR ${SUBTREE_IDS})` })],
        /"s" \(SELECT\) USING/,
      ],
      [
        "with a subtree predicate in a policy for ALL commands, which lets DELETE reach descendants",
        [policy({}), policy({ policyname: "s", cmd: "ALL", qual: SUBTREE_READ })],
        /"s" \(ALL\) USING/,
      ],
      [
        "with a subtree predicate in an INSERT WITH CHECK",
        [policy({}), policy({ policyname: "s", cmd: "INSERT", qual: null, with_check: SUBTREE_READ })],
        /"s" \(INSERT\) WITH CHECK/,
      ],
      [
        "when it has only restrictive policies",
        [policy({ permissive: "RESTRICTIVE" })],
        /only restrictive policies/,
      ],
    ];
    for (const [name, policies, reason] of cases) {
      it(name, () => {
        const verdict = evaluatePolicies(policies, "public");
        expect(verdict.isolated).toBe(false);
        expect(verdict.issue).toMatch(reason);
      });
    }
  });

  it("reports no issue for a table with no policies, so one can be added", () => {
    expect(evaluatePolicies([])).toEqual({ isolated: false, issue: null });
  });

  it("puts a multi-line policy expression on one line in the reason", () => {
    const verdict = evaluatePolicies([policy({ qual: "(true\nAND\r\ntrue)" })]);
    expect(verdict.issue).not.toMatch(/[\r\n]/);
  });

  describe("the schema that may qualify the subtree function", () => {
    const qualified = (schema: string) => [
      policy({}),
      policy({
        policyname: "tenant_subtree_read",
        cmd: "SELECT",
        qual: SUBTREE_READ.replace("SELECT stratum_", `SELECT ${schema}.stratum_`),
      }),
    ];

    it("accepts the function qualified with the schema of the tenants table", () => {
      expect(evaluatePolicies(qualified("tenancy"), "tenancy")).toEqual({ isolated: true, issue: null });
    });

    it("rejects public.stratum_subtree_tenant_ids() when tenants is in another schema", () => {
      expect(evaluatePolicies(qualified("public"), "tenancy").isolated).toBe(false);
    });

    it("rejects any qualified function when the tenants schema is unknown", () => {
      expect(evaluatePolicies(qualified("public")).isolated).toBe(false);
    });

    it("accepts the unqualified function when the tenants schema is unknown", () => {
      const policies = [policy({}), policy({ policyname: "tenant_subtree_read", cmd: "SELECT", qual: SUBTREE_READ })];
      expect(evaluatePolicies(policies)).toEqual({ isolated: true, issue: null });
    });
  });
});

describe("evaluatePolicies with the control role model of migration 032", () => {
  const LEGACY = `(( SELECT stratum_legacy_bypass() AS stratum_legacy_bypass) OR ${GENERATED})`;
  const control = (roles: string[]) =>
    policy({ policyname: "stratum_control_plane", qual: "true", with_check: "true", roles });

  it("counts the legacy form of tenant_isolation as isolated", () => {
    expect(evaluatePolicies([policy({ qual: LEGACY, with_check: LEGACY })], "public")).toEqual({
      isolated: true,
      issue: null,
    });
  });

  it("counts a table as isolated with stratum_control_plane for exactly the control role", () => {
    expect(evaluatePolicies([policy({ qual: LEGACY }), control(["stratum_control"])], "public")).toEqual({
      isolated: true,
      issue: null,
    });
    expect(evaluatePolicies([policy({}), control(["acme_control"])], "public", "acme_control")).toEqual({
      isolated: true,
      issue: null,
    });
  });

  it("reports stratum_control_plane for PUBLIC, another role, or without its roles", () => {
    for (const p of [control(["public"]), control(["stratum_control", "stratum_app"]), policy({ policyname: "stratum_control_plane", qual: "true" })]) {
      expect(evaluatePolicies([policy({}), p], "public").issue).toMatch(/stratum_control_plane/);
    }
  });

  it("does not count the legacy function without a tenant match", () => {
    const qual = "( SELECT stratum_legacy_bypass() AS stratum_legacy_bypass)";
    expect(evaluatePolicies([policy({ qual })], "public").isolated).toBe(false);
  });
});
