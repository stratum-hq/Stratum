import pg from "pg";
import { validateSlug } from "@stratum-hq/core";
import { tenantSchemaName } from "./manager.js";

export async function setSchemaSearchPath(
  client: pg.PoolClient,
  tenantSlug: string,
): Promise<void> {
  // The schema name is interpolated (identifiers cannot be bound), so the slug
  // must be validated against the canonical slug charset first; validateSlug
  // throws on anything else. SET LOCAL only takes effect for the current
  // transaction. The path is the tenant schema alone (pg_catalog is always
  // searched), so a table missing from it errors instead of resolving to a
  // shared table in public.
  const schemaName = tenantSchemaName(validateSlug(tenantSlug));
  await client.query(`SET LOCAL search_path TO ${schemaName}`);
  // Outside a transaction SET LOCAL is a no-op with only a warning.
  const res = await client.query<{ search_path: string }>("SHOW search_path");
  if (res.rows[0].search_path !== schemaName) {
    throw new Error("setSchemaSearchPath must be called inside a transaction");
  }
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
