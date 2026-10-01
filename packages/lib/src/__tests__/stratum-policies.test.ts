import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { policiesPlpgsql, stratumPolicies, STRATUM_RLS_TABLES } from "../stratum-policies.js";
import * as lib from "../index.js";

const sql032 = fs.readFileSync(path.resolve(__dirname, "../migrations/032_control_role.sql"), "utf8");
const applyBody = sql032.match(/AS \$apply\$([\s\S]*?)\$apply\$;/)![1];

describe("the canonical Stratum policies", () => {
  it("are the ones stratum_apply_control_role() of migration 032 creates, statement for statement", () => {
    expect(applyBody).toContain(policiesPlpgsql());
  });

  it("drop every policy on a Stratum table before the canonical ones are created", () => {
    const sql = policiesPlpgsql();
    expect(sql.indexOf("DROP POLICY %I")).toBeLessThan(sql.indexOf("CREATE POLICY"));
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
  });

  it("give every Stratum RLS table exactly one control policy", () => {
    const control = stratumPolicies().filter((p) => p.name === "stratum_control_plane");
    expect(control.map((p) => p.table).sort()).toEqual([...STRATUM_RLS_TABLES].sort());
  });

  it("give credential tables no subtree read", () => {
    const subtree = stratumPolicies().filter((p) => p.name === "tenant_subtree_read").map((p) => p.table);
    for (const t of ["api_keys", "webhooks", "regions", "stratum_security"]) expect(subtree).not.toContain(t);
    expect(subtree).toHaveLength(11);
  });

  it("are exported with the drift check from the package entry point", () => {
    expect(lib.stratumPolicyDrift).toBeTypeOf("function");
    expect(lib.STRATUM_RLS_TABLES).toBe(STRATUM_RLS_TABLES);
  });
});
