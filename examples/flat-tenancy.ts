/**
 * Flat-tenancy example — SaaS with no hierarchy.
 *
 * Use createOrganization / listOrganizations / getOrganization
 * when your product has a single tier of tenants (organizations)
 * with no parent/child relationships.
 *
 * Install: npm install @stratum-hq/lib pg
 */
import pg from "pg";
import { Stratum } from "@stratum-hq/lib";

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const stratum = new Stratum({ pool, autoMigrate: true });
  await stratum.initialize();

  // --- Provision organizations at sign-up time ---

  const acme = await stratum.createOrganization({
    name: "Acme Corp",
    slug: "acme_corp",
    metadata: { plan: "pro", billing_email: "billing@acme.example" },
  });
  console.log("Created:", acme.name, acme.id);

  const globex = await stratum.createOrganization({
    name: "Globex Industries",
    slug: "globex",
    metadata: { plan: "starter", billing_email: "admin@globex.example" },
  });
  console.log("Created:", globex.name, globex.id);

  const initech = await stratum.createOrganization({
    name: "Initech Solutions",
    slug: "initech",
    metadata: { plan: "enterprise", billing_email: "ops@initech.example" },
  });
  console.log("Created:", initech.name, initech.id);

  // --- Per-org feature flags and limits ---

  await stratum.setConfig(acme.id, "feature_ai_assist", { value: true });
  await stratum.setConfig(acme.id, "seat_limit", { value: 25 });

  await stratum.setConfig(globex.id, "feature_ai_assist", { value: false });
  await stratum.setConfig(globex.id, "seat_limit", { value: 5 });

  await stratum.setConfig(initech.id, "feature_ai_assist", { value: true });
  await stratum.setConfig(initech.id, "seat_limit", { value: 500 });

  // --- Resolve config for a specific org at request time ---

  const acmeConfig = await stratum.resolveConfig(acme.id);
  console.log("\nAcme Corp config:");
  console.log("  ai_assist:", acmeConfig["feature_ai_assist"]?.value);
  console.log("  seat_limit:", acmeConfig["seat_limit"]?.value);

  // --- List all organizations (cursor-based pagination) ---

  const page = await stratum.listOrganizations({ limit: 20 });
  console.log(`\nAll organizations (${page.data.length} returned):`);
  for (const org of page.data) {
    const plan = (org.metadata as Record<string, string>)["plan"] ?? "unknown";
    console.log(`  ${org.name} [${plan}] — ${org.id}`);
  }

  // --- Look up a single org by ID ---

  const found = await stratum.getOrganization(acme.id);
  console.log("\nLooked up:", found.name, found.slug);

  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
