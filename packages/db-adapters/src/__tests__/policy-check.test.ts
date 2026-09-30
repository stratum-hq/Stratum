import { describe, it, expect } from "vitest";
import { tenantPolicyIssue, type PolicyRow } from "../rls/policy-check.js";

// Expressions below are in the deparsed form PostgreSQL 16 stores in pg_policies.
const GENERATED =
  "(tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)";
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

describe("tenantPolicyIssue", () => {
  describe("accepts a policy that filters by tenant", () => {
    const cases: Array<[string, PolicyRow]> = [
      ["the policy createPolicy generates", policy({})],
      ["without NULLIF", policy({ qual: "(tenant_id = (current_setting('app.current_tenant_id'::text))::uuid)" })],
      ["with Stratum's administrative bypass OR the tenant match", policy({ qual: WITH_BYPASS })],
      [
        "with the operands reversed",
        policy({ qual: "((NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid = tenant_id)" }),
      ],
      ["ANDed with another condition", policy({ qual: `(${GENERATED} AND (deleted_at IS NULL))` })],
      ["with a matching WITH CHECK", policy({ with_check: GENERATED })],
    ];
    for (const [name, p] of cases) {
      it(name, () => {
        expect(tenantPolicyIssue(p)).toBeNull();
      });
    }
  });

  describe("reports a policy that does not filter by tenant", () => {
    const cases: Array<[string, PolicyRow, RegExp]> = [
      ["USING (true)", policy({ qual: "true" }), /USING \(true\) does not filter by tenant/],
      [
        "a different setting",
        policy({ qual: "(tenant_id = (current_setting('app.other_tenant'::text, true))::uuid)" }),
        /does not filter by tenant/,
      ],
      ["the tenant match ORed with true", policy({ qual: `(${GENERATED} OR true)` }), /does not filter by tenant/],
      ["the bypass alone", policy({ qual: "(current_setting('app.bypass_rls'::text, true) = 'on'::text)" }), /does not filter by tenant/],
      ["a WITH CHECK of true", policy({ with_check: "true" }), /WITH CHECK \(true\) does not filter by tenant/],
      ["a restrictive policy", policy({ permissive: "RESTRICTIVE" }), /restrictive, not permissive/],
      ["a policy for SELECT only", policy({ cmd: "SELECT" }), /SELECT only, not ALL commands/],
    ];
    for (const [name, p, message] of cases) {
      it(name, () => {
        expect(tenantPolicyIssue(p)).toMatch(message);
      });
    }
  });
});
