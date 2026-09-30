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
        expect(evaluatePolicies(policies)).toEqual({ isolated: true, issue: null });
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
        "when it has only restrictive policies",
        [policy({ permissive: "RESTRICTIVE" })],
        /only restrictive policies/,
      ],
    ];
    for (const [name, policies, reason] of cases) {
      it(name, () => {
        const verdict = evaluatePolicies(policies);
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
});
