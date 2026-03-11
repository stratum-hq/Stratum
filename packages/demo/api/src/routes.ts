import { Router } from "express";
import { Pool } from "pg";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://stratum:stratum@localhost:5432/stratum",
});

const router = Router();

// Get security events for a tenant (RLS-enforced)
router.get("/events/:tenantId", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.current_tenant_id', $1, true)`,
      [req.params.tenantId]
    );
    const { rows } = await client.query(
      "SELECT * FROM security_events ORDER BY created_at DESC"
    );
    await client.query("COMMIT");
    res.json(rows);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[events] Error:", err); res.status(500).json({ error: "Internal server error" });
  } finally {
    // CRITICAL: Reset tenant context on connection release
    await client.query("RESET app.current_tenant_id").catch(() => {});
    client.release();
  }
});

export { router };
