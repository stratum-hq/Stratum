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
  // transaction.
  const schemaName = tenantSchemaName(validateSlug(tenantSlug));
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
