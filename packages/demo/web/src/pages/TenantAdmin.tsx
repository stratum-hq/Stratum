import React from "react";
import { TenantSwitcher, TenantTree, useTenant } from "@stratum/react";

export function TenantAdmin() {
  const { tenant } = useTenant();

  return (
    <div style={{ display: "flex", gap: 24 }}>
      <div style={{ width: 300, flexShrink: 0 }}>
        <h3 style={{ marginTop: 0 }}>Switch Tenant</h3>
        <TenantSwitcher />
        <h3>Tenant Hierarchy</h3>
        <TenantTree />
      </div>
      <div style={{ flex: 1 }}>
        {tenant ? (
          <div>
            <h2 style={{ marginTop: 0 }}>{tenant.name}</h2>
            <table style={{ fontSize: 14, borderCollapse: "collapse" }}>
              <tbody>
                {Object.entries({
                  ID: tenant.id,
                  Slug: tenant.slug,
                  "Ancestry Path": tenant.ancestry_path,
                  Isolation: tenant.isolation_strategy,
                  Depth: tenant.depth,
                  Status: tenant.status,
                }).map(([label, value]) => (
                  <tr key={label} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "8px 12px", fontWeight: 600, color: "#64748b" }}>{label}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>{String(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ color: "#94a3b8", textAlign: "center", padding: 48 }}>
            Select a tenant from the tree or switcher
          </div>
        )}
      </div>
    </div>
  );
}
