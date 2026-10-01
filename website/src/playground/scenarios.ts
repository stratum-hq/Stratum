// The scripts that the Playground runs. Each one is the body of an async
// function. The page shows the same text that it runs, so what a visitor
// reads is what the library does.
//
// Names in scope: stratum, pool, appPool, withTenantContext, enableRLS,
// createPolicy, ConfigLockedError, PermissionLockedError, StratumError. The
// tour steps also get `t`, which holds the tenants that earlier steps created.

export interface TourStep {
  id: string;
  title: string;
  text: string;
  code: string;
  /** The key in `t` of the tenant to show in the inspector after the step. */
  inspect?: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "hierarchy",
    title: "Build the hierarchy",
    text:
      "An MSSP serves MSPs, an MSP serves clients, and a client has AWS accounts. " +
      "Each one is a tenant in one tree, stored in PostgreSQL.",
    inspect: "prod",
    code: `t.mssp = await stratum.createTenant({ name: "Sentinel MSSP", slug: "sentinel" });
t.msp = await stratum.createTenant({ name: "NorthStar MSP", slug: "northstar", parent_id: t.mssp.id });
t.acme = await stratum.createTenant({ name: "Acme Corp", slug: "acme", parent_id: t.msp.id });
t.prod = await stratum.createTenant({ name: "Acme AWS prod", slug: "acme_aws_prod", parent_id: t.acme.id });
t.dev = await stratum.createTenant({ name: "Acme AWS dev", slug: "acme_aws_dev", parent_id: t.acme.id });
t.globex = await stratum.createTenant({ name: "Globex", slug: "globex", parent_id: t.msp.id });

const ancestors = await stratum.getAncestors(t.prod.id);
console.log("Acme AWS prod is at depth", t.prod.depth);
console.log("Its ancestors:", ancestors.map((a) => a.name).join(" > "));`,
  },
  {
    id: "config",
    title: "Inherit config",
    text:
      "The MSSP sets the data region for everyone below it and locks it. " +
      "Acme sets its own retention, and its AWS accounts inherit both values.",
    inspect: "prod",
    code: `await stratum.setConfig(t.mssp.id, "data_region", { value: "us-east-1", locked: true });
await stratum.setConfig(t.mssp.id, "retention_days", { value: 365 });
await stratum.setConfig(t.acme.id, "retention_days", { value: 90 });

const config = await stratum.resolveConfig(t.prod.id);
for (const entry of Object.values(config)) {
  const state = entry.locked ? "LOCKED" : entry.inherited ? "inherited" : "own";
  console.log(entry.key, "=", JSON.stringify(entry.value), "(" + state + ")");
}`,
  },
  {
    id: "locked",
    title: "Try to override a locked key",
    text:
      "The prod account tries to move its data to Europe. The MSSP locked the region, " +
      "so the library refuses the write with ConfigLockedError.",
    inspect: "prod",
    code: `try {
  await stratum.setConfig(t.prod.id, "data_region", { value: "eu-west-1" });
  console.log("override accepted");
} catch (err) {
  console.log("refused: " + err.name);
  console.log(err.message);
}`,
  },
  {
    id: "permissions",
    title: "Lock and delegate permissions",
    text:
      "The MSSP keeps host isolation for itself (LOCKED). The MSP lets its clients " +
      "manage tickets and pass that right on (DELEGATED).",
    inspect: "prod",
    code: `await stratum.createPermission(t.mssp.id, { key: "edr.isolate_host", mode: "LOCKED" });
await stratum.createPermission(t.msp.id, { key: "tickets.manage", mode: "DELEGATED" });

const permissions = await stratum.resolvePermissions(t.prod.id);
for (const entry of Object.values(permissions)) {
  console.log(entry.key, entry.mode, entry.delegated ? "(delegated)" : "");
}`,
  },
  {
    id: "rls",
    title: "Isolation (RLS)",
    text:
      "An application table gets tenant row-level security from the Stratum helpers. " +
      "The superuser sees every row. The app role in a tenant context sees only that " +
      "tenant's rows, and PostgreSQL refuses its insert for another tenant.",
    code: `await pool.query("CREATE TABLE findings (id serial PRIMARY KEY, tenant_id uuid NOT NULL, title text NOT NULL)");
const admin = await pool.connect();
try {
  await enableRLS(admin, "findings");
  await createPolicy(admin, "findings");
} finally {
  admin.release();
}
await pool.query(
  "INSERT INTO findings (tenant_id, title) VALUES ($1, 'S3 bucket is public'), ($2, 'IAM key is 400 days old'), ($3, 'RDP is open')",
  [t.prod.id, t.dev.id, t.globex.id],
);

const all = await pool.query("SELECT title FROM findings");
console.log("superuser sees " + all.rowCount + " rows");

const none = await appPool.query("SELECT title FROM findings");
console.log("app role without a tenant sees " + none.rowCount + " rows");

const own = await withTenantContext(appPool, t.prod.id, (c) => c.query("SELECT title FROM findings"));
console.log("app role as Acme AWS prod sees " + own.rowCount + " row: " + own.rows.map((r) => r.title).join(", "));

try {
  await withTenantContext(appPool, t.prod.id, (c) =>
    c.query("INSERT INTO findings (tenant_id, title) VALUES ($1, 'written across tenants')", [t.globex.id]),
  );
  console.log("cross-tenant insert accepted");
} catch (err) {
  console.log("cross-tenant insert refused: " + err.message);
}`,
  },
  {
    id: "subtree",
    title: "Subtree reads (opt-in)",
    text:
      "A parent can opt in to read the rows of every tenant below it. Acme reads both " +
      "of its AWS accounts but not its sibling Globex. Writes stay limited to the exact tenant.",
    code: `const admin = await pool.connect();
try {
  await createPolicy(admin, "findings", { subtreeRead: true });
} finally {
  admin.release();
}
const read = (tenant, scope) =>
  withTenantContext(appPool, tenant.id, (c) => c.query("SELECT title FROM findings"), { scope });

console.log("NorthStar MSP, exact scope, sees " + (await read(t.msp, "exact")).rowCount + " rows");
console.log("NorthStar MSP, subtree scope, sees " + (await read(t.msp, "subtree")).rowCount + " rows");
const acme = await read(t.acme, "subtree");
console.log("Acme Corp, subtree scope, sees " + acme.rowCount + " rows: " + acme.rows.map((r) => r.title).join(", "));

try {
  await withTenantContext(
    appPool,
    t.acme.id,
    (c) => c.query("INSERT INTO findings (tenant_id, title) VALUES ($1, 'written by the parent')", [t.prod.id]),
    { scope: "subtree" },
  );
  console.log("insert for a child accepted");
} catch (err) {
  console.log("insert for a child refused: " + err.message);
}`,
  },
];

export type ScenarioKey = "flat" | "hierarchy" | "config" | "gdpr";

export const SCENARIOS: Record<ScenarioKey, { description: string; code: string }> = {
  flat: {
    description: "Create organizations with no hierarchy.",
    code: `// Create organizations (flat, no hierarchy)
const org1 = await stratum.createOrganization({ name: "Acme Corp", slug: "acme" });
console.log("Created:", org1.name, "(id: " + org1.id + ")");

const org2 = await stratum.createOrganization({ name: "Globex Inc", slug: "globex" });
console.log("Created:", org2.name, "(id: " + org2.id + ")");

const orgs = await stratum.listOrganizations({ limit: 50 });
console.log("\\nAll organizations:");
orgs.data.forEach((o) => console.log("  -", o.name, "(" + o.slug + ")"));`,
  },
  hierarchy: {
    description: "Build a 3-level MSP tenant hierarchy.",
    code: `// Build a 3-level MSP hierarchy
const root = await stratum.createTenant({ name: "AcmeSec", slug: "acmesec" });
const msp = await stratum.createTenant({ name: "NorthStar MSP", slug: "northstar", parent_id: root.id });
const client = await stratum.createTenant({ name: "Client Alpha", slug: "alpha", parent_id: msp.id });

const ancestors = await stratum.getAncestors(client.id);
console.log("Ancestors of", client.name + ":", ancestors.map((a) => a.name).join(" > "));

const descendants = await stratum.getDescendants(root.id);
console.log("\\nDescendants of", root.name + ":");
descendants.forEach((t) => console.log("  " + "  ".repeat(t.depth) + t.name + " (depth: " + t.depth + ")"));`,
  },
  config: {
    description: "Set config at the root, resolve it on a child, and try to override a locked key.",
    code: `// Build a hierarchy for the config demo
const root = await stratum.createTenant({ name: "AcmeSec", slug: "acmesec" });
const child = await stratum.createTenant({ name: "NorthStar", slug: "northstar", parent_id: root.id });

// Set config on the root
await stratum.setConfig(root.id, "max_users", { value: 1000 });
await stratum.setConfig(root.id, "data_region", { value: "us-east-1", locked: true });
console.log("Config set on root: max_users=1000, data_region=us-east-1 (locked)");

// Resolve on the child (inherits from the parent)
const config = await stratum.resolveConfig(child.id);
console.log("\\nResolved config for", child.name + ":");
Object.values(config).forEach((entry) => {
  console.log("  " + entry.key + ":", JSON.stringify(entry.value), entry.inherited ? "(inherited)" : "(own)", entry.locked ? "[LOCKED]" : "");
});

// The child cannot override a locked key
try {
  await stratum.setConfig(child.id, "data_region", { value: "eu-west-1" });
  console.log("\\noverride accepted");
} catch (err) {
  console.log("\\nrefused: " + err.name);
}`,
  },
  gdpr: {
    description: "Export (Article 20) and purge (Article 17) tenant data.",
    code: `// Create a tenant with config
const org = await stratum.createTenant({ name: "Acme Corp", slug: "acme" });
await stratum.setConfig(org.id, "plan", { value: "enterprise" });
console.log("Created tenant with config");

// Export tenant data (Article 20)
const exported = await stratum.exportTenantData(org.id);
console.log("\\nExported data keys:", Object.keys(exported).join(", "));

// Purge tenant data (Article 17)
await stratum.purgeTenant(org.id);
console.log("\\nTenant purged");

// Verify the purge
try {
  await stratum.getTenant(org.id);
  console.log("Tenant after purge: STILL EXISTS (error!)");
} catch (err) {
  console.log("Tenant after purge: " + err.name + " (correct)");
}`,
  },
};
