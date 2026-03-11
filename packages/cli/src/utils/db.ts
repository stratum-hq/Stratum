import pg from "pg";

export function getConnectionString(flags: Record<string, string | boolean>): string {
  const explicit = flags["database-url"] || flags["d"];
  if (typeof explicit === "string") return explicit;

  const env = process.env.DATABASE_URL;
  if (env) return env;

  return "postgres://stratum:stratum_dev@localhost:5432/stratum";
}

export async function connectDb(flags: Record<string, string | boolean>): Promise<pg.Pool> {
  const connectionString = getConnectionString(flags);
  const pool = new pg.Pool({ connectionString, max: 3 });

  // Test connection
  const client = await pool.connect();
  client.release();

  return pool;
}

export interface TableInfo {
  table_name: string;
  has_tenant_id: boolean;
  rls_enabled: boolean;
  rls_forced: boolean;
  has_policy: boolean;
}

export async function scanTables(pool: pg.Pool): Promise<TableInfo[]> {
  const result = await pool.query(`
    SELECT
      t.tablename AS table_name,
      EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = t.tablename
          AND c.column_name = 'tenant_id'
      ) AS has_tenant_id,
      COALESCE(pc.relrowsecurity, false) AS rls_enabled,
      COALESCE(pc.relforcerowsecurity, false) AS rls_forced,
      EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.tablename = t.tablename
          AND p.schemaname = 'public'
          AND p.policyname = 'tenant_isolation'
      ) AS has_policy
    FROM pg_tables t
    JOIN pg_class pc ON pc.relname = t.tablename AND pc.relnamespace = 'public'::regnamespace
    WHERE t.schemaname = 'public'
      AND t.tablename NOT IN ('tenants', 'config_entries', 'permission_policies', 'api_keys')
      AND t.tablename NOT LIKE 'pg_%'
    ORDER BY t.tablename;
  `);

  return result.rows;
}

export async function checkExtensions(pool: pg.Pool): Promise<{ uuid_ossp: boolean; ltree: boolean }> {
  const result = await pool.query(`
    SELECT extname FROM pg_extension
    WHERE extname IN ('uuid-ossp', 'ltree');
  `);
  const names = result.rows.map((r: { extname: string }) => r.extname);
  return {
    uuid_ossp: names.includes("uuid-ossp"),
    ltree: names.includes("ltree"),
  };
}

export async function checkBypassRLS(pool: pg.Pool): Promise<boolean> {
  const result = await pool.query(`
    SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user;
  `);
  return result.rows[0]?.rolbypassrls === true;
}

export async function checkStratumTables(pool: pg.Pool): Promise<boolean> {
  const result = await pool.query(`
    SELECT COUNT(*) AS cnt FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('tenants', 'config_entries', 'permission_policies', 'api_keys');
  `);
  return parseInt(result.rows[0].cnt, 10) === 4;
}
