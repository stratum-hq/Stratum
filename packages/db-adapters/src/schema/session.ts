import pg from "pg";
import { tenantSchemaName } from "./manager.js";

export async function setSchemaSearchPath(
  client: pg.PoolClient,
  tenantSlug: string,
): Promise<void> {
  const schemaName = tenantSchemaName(tenantSlug);
  // Schema name is derived from a validated slug — safe for interpolation.
  // SET LOCAL only takes effect for the current transaction.
  await client.query(`SET LOCAL search_path TO ${schemaName}, public`);
}

export async function resetSearchPath(client: pg.PoolClient): Promise<void> {
  await client.query("RESET search_path");
}

export async function getCurrentSearchPath(
  client: pg.PoolClient,
): Promise<string> {
  const res = await client.query<{ search_path: string }>("SHOW search_path");
  return res.rows[0].search_path;
}
