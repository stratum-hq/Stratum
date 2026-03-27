/**
 * Stratum Quickstart — tenant hierarchy + config in ~15 lines.
 * Install: npm install @stratum-hq/lib pg
 */
import pg from "pg";
import { Stratum } from "@stratum-hq/lib";

async function main() {
  // 1. Create a PostgreSQL connection pool.
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  // 2. Create the Stratum instance. autoMigrate runs schema migrations on initialize().
  const stratum = new Stratum({ pool, autoMigrate: true });
  await stratum.initialize();

  // 3. Create a root tenant (MSP) and a child tenant (its customer).
  const msp = await stratum.createTenant({ name: "NorthStar MSP", slug: "northstar_msp", parent_id: null });
  const customer = await stratum.createTenant({ name: "Acme Corp", slug: "acme_corp", parent_id: msp.id });

  // 4. Set a config value on the MSP — child tenants inherit it automatically.
  await stratum.setConfig(msp.id, "max_seats", { value: 500 });

  // 5. Resolve config for the child: inherited values are merged from ancestors.
  const config = await stratum.resolveConfig(customer.id);
  console.log("Acme Corp max_seats:", config["max_seats"]?.value); // 500 (inherited)

  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
