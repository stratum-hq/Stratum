import React from "react";
import { ConfigEditor, PermissionEditor, useTenant } from "@stratum/react";

export function ConfigAdmin() {
  const { tenant } = useTenant();

  if (!tenant) {
    return (
      <div style={{ color: "#94a3b8", textAlign: "center", padding: 48 }}>
        Select a tenant first to manage config and permissions
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Configuration — {tenant.name}</h2>
      <ConfigEditor />

      <h2 style={{ marginTop: 32 }}>Permissions — {tenant.name}</h2>
      <PermissionEditor />
    </div>
  );
}
