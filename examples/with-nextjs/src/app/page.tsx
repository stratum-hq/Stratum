/**
 * Home page — Server Component
 *
 * Reads the tenant slug injected by middleware, looks up the tenant from
 * Stratum, and renders a simple tenant info card. Works for both subdomain
 * routing (acme.app.example.com) and header-based routing (X-Tenant-ID).
 */
import { headers } from "next/headers";
import { stratum } from "../lib/stratum";

async function resolveTenantFromRequest() {
  const headerList = await headers();

  // Option 1: explicit tenant ID forwarded by middleware
  const tenantId = headerList.get("x-tenant-id");
  if (tenantId) {
    return stratum.getTenant(tenantId);
  }

  // Option 2: slug from subdomain, resolved to full TenantNode
  const slug = headerList.get("x-tenant-slug");
  if (slug) {
    const page = await stratum.listTenants({ limit: 1, offset: 0 });
    // In a real app you'd add a getTenantBySlug method or a DB index lookup.
    // For the example, scan the first page (works for demos with few tenants).
    const all = await stratum.listTenants({ limit: 200, offset: 0 });
    const match = all.data.find((t) => t.slug === slug);
    if (match) return match;
  }

  return null;
}

export default async function HomePage() {
  const tenant = await resolveTenantFromRequest();

  if (!tenant) {
    return (
      <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <h1>Welcome to Stratum + Next.js</h1>
        <p>
          No tenant detected. Try accessing via subdomain (
          <code>acme.app.example.com</code>) or pass an{" "}
          <code>X-Tenant-ID</code> header.
        </p>
      </main>
    );
  }

  const config = await stratum.resolveConfig(tenant.id);
  const configEntries = Object.entries(config);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "640px" }}>
      <h1>{tenant.name}</h1>
      <dl style={{ lineHeight: 1.8 }}>
        <dt style={{ fontWeight: "bold" }}>Tenant ID</dt>
        <dd>
          <code>{tenant.id}</code>
        </dd>
        <dt style={{ fontWeight: "bold" }}>Slug</dt>
        <dd>
          <code>{tenant.slug}</code>
        </dd>
        <dt style={{ fontWeight: "bold" }}>Depth</dt>
        <dd>{tenant.depth === 0 ? "Root (organization)" : `Level ${tenant.depth}`}</dd>
        <dt style={{ fontWeight: "bold" }}>Status</dt>
        <dd>{tenant.status}</dd>
      </dl>

      <h2>Resolved Config</h2>
      {configEntries.length === 0 ? (
        <p>No config entries found.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "4px 8px" }}>Key</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "4px 8px" }}>Value</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "4px 8px" }}>Source</th>
            </tr>
          </thead>
          <tbody>
            {configEntries.map(([key, entry]) => (
              <tr key={key}>
                <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>{key}</td>
                <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>
                  {JSON.stringify(entry.value)}
                </td>
                <td style={{ padding: "4px 8px", color: "#666", fontSize: "0.85em" }}>
                  {entry.inherited ? `inherited from ${entry.source_tenant_id}` : "own"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
