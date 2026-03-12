import fs from "node:fs";
import path from "node:path";
import { getPool } from "./connection.js";

async function migrate(): Promise<void> {
  const pool = getPool();

  // Create migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Get applied migrations
  const { rows: applied } = await pool.query(
    "SELECT name FROM _migrations ORDER BY id",
  );
  const appliedSet = new Set(applied.map((r: { name: string }) => r.name));

  // Get migration files
  const migrationsDir = path.resolve(__dirname, "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`  Skipping ${file} (already applied)`);
      continue;
    }

    console.log(`  Applying ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`  Applied ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`  Failed to apply ${file}:`, err);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log("Migrations complete.");
}

export { migrate };
