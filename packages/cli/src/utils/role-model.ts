import type { RoleModelReport } from "@stratum-hq/lib";

/** One line of a role-model check, for `doctor` and `health`. */
export interface RoleModelCheck {
  status: "pass" | "fail" | "warn";
  label: string;
  summary: string;
  details?: string[];
}

/**
 * The checks of the role model of @stratum-hq/lib migration 032, from an
 * inspectRoleModel() report. In `doctor` and `health` the application login
 * is the one of `--database-url` and the admin login the one of
 * `--admin-database-url`. In 1.x every problem is a warning: the hardening
 * is opt-in.
 *
 * Before the control role is applied, only the hardening line is reported;
 * the other checks have nothing to check against yet.
 */
export function roleModelChecks(report: RoleModelReport): RoleModelCheck[] {
  if (!report.migrated) {
    return [{ status: "warn", label: "Control role", summary: "Migration 032 not applied; run the Stratum migrations" }];
  }
  if (!report.hardeningActive) {
    return [
      {
        status: "warn",
        label: "Control role",
        summary: "Hardening not active: migration 032 did not apply the control role",
        details: ["Run `stratum db roles --apply` as a superuser (or the SQL it prints) to apply it."],
      },
    ];
  }

  const checks: RoleModelCheck[] = [
    { status: "pass", label: "Control role", summary: `Hardening active (control role ${report.controlRole})` },
  ];

  const app = report.appIssues ?? [];
  checks.push(
    app.length === 0
      ? { status: "pass", label: "App role", summary: "Not a member or owner; no writes or credential reads" }
      : {
          status: "warn",
          label: "App role",
          summary: `${app.length} problem(s) with the application login`,
          details: [
            ...app,
            "Fix: stratum db roles --apply --app-role <app login> --admin-role <admin login>",
          ],
        },
  );

  if (report.adminIssues !== null) {
    checks.push(
      report.adminIssues.length === 0
        ? { status: "pass", label: "Admin role", summary: `Can act as the control plane (${report.controlRole})` }
        : {
            status: "warn",
            label: "Admin role",
            summary: "The admin login cannot act as the control plane",
            details: report.adminIssues,
          },
    );
  }

  // Every member of the control role passes every Stratum policy.
  const others = report.controlMembers.filter((m) => m.role !== report.adminLogin);
  if (others.length === 0) {
    checks.push({
      status: "pass",
      label: "Control members",
      summary: report.adminLogin ? `Only the admin login (${report.adminLogin})` : "No member other than superusers",
    });
  } else if (report.adminLogin === null) {
    checks.push({
      status: "pass",
      label: "Control members",
      summary: `Members: ${others.map((m) => m.role).join(", ")}`,
      details: ["Each should be an admin login of the library. Pass --admin-database-url to check them against it."],
    });
  } else {
    checks.push({
      status: "warn",
      label: "Control members",
      summary: `Members other than the admin login: ${others.map((m) => m.role).join(", ")}`,
      details: [
        "A member of the control role passes every Stratum policy. Remove each one that is not an admin login of the library:",
        ...others.map((m) => `REVOKE "${report.controlRole}" FROM "${m.role}";`),
      ],
    });
  }

  if (report.legacyBypass === false) {
    checks.push({ status: "pass", label: "Legacy switch", summary: "Off: app.bypass_rls admits nothing (stratum db lock)" });
  } else if (report.legacyBypass === true) {
    checks.push({
      status: "warn",
      label: "Legacy switch",
      summary: "On: a session that sets app.bypass_rls passes the tenant policies",
      details: ["Once every client uses adminPool, run: stratum db lock"],
    });
  } else {
    checks.push({
      status: "warn",
      label: "Legacy switch",
      summary: "Not checked",
      details: ["Pass --admin-database-url (or DATABASE_ADMIN_URL), a member of the control role, to read it."],
    });
  }

  return checks;
}
