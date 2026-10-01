import { describe, it, expect } from "vitest";
import type { RoleModelReport } from "@stratum-hq/lib";
import { roleModelChecks } from "../role-model.js";

function report(overrides: Partial<RoleModelReport>): RoleModelReport {
  return {
    migrated: true,
    hardeningActive: true,
    controlRole: "stratum_control",
    adminIssues: [],
    appIssues: [],
    legacyBypass: false,
    controlMembers: [{ role: "stratum_admin", login: true }],
    adminLogin: "stratum_admin",
    ...overrides,
  };
}

function members(r: RoleModelReport) {
  return roleModelChecks(r).find((c) => c.label === "Control members");
}

describe("roleModelChecks: members of the control role", () => {
  it("passes when the admin login is the only member", () => {
    expect(members(report({}))).toMatchObject({ status: "pass", summary: "Only the admin login (stratum_admin)" });
  });

  it("warns about each member other than the admin login, with the REVOKE to run", () => {
    const check = members(
      report({ controlMembers: [{ role: "stratum_admin", login: true }, { role: "app_login", login: true }] }),
    );
    expect(check?.status).toBe("warn");
    expect(check?.summary).toContain("app_login");
    expect(check?.details).toContain('REVOKE "stratum_control" FROM "app_login";');
  });

  it("lists the members without judging them when no admin login was given", () => {
    const check = members(report({ adminLogin: null, adminIssues: null }));
    expect(check).toMatchObject({ status: "pass", summary: "Members: stratum_admin" });
  });
});
