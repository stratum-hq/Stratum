import pg from "pg";
import { validateSlug } from "@stratum-hq/core";
import { tenantSchemaName, validateSchemaName } from "./manager.js";

/**
 * Builds the search_path list for a tenant: the tenant schema first, then any
 * explicitly opted-in extra schemas (for example one holding extension
 * functions). Every extra entry is validated as a plain identifier, the same
 * way tenant schema names are. Note that an unqualified table missing from the
 * tenant schema resolves in the extra schemas, so list only schemas that hold
 * no tenant data.
 */
export function tenantSearchPath(schemaName: string, extraSearchPath: string[] = []): string {
  return [schemaName, ...extraSearchPath.map(validateSchemaName)].join(", ");
}

export async function setSchemaSearchPath(
  client: pg.PoolClient,
  tenantSlug: string,
  extraSearchPath: string[] = [],
): Promise<void> {
  // The schema name is interpolated (identifiers cannot be bound), so the slug
  // must be validated against the canonical slug charset first; validateSlug
  // throws on anything else. SET LOCAL only takes effect for the current
  // transaction. The path is the tenant schema alone (pg_catalog is always
  // searched), so a table missing from it errors instead of resolving to a
  // shared table in public. Extra schemas are appended only when opted in.
  const searchPath = tenantSearchPath(tenantSchemaName(validateSlug(tenantSlug)), extraSearchPath);
  await client.query(`SET LOCAL search_path TO ${searchPath}`);
  // Outside a transaction SET LOCAL is a no-op with only a warning. SHOW
  // reports unquoted identifiers folded to lower case.
  const res = await client.query<{ search_path: string }>("SHOW search_path");
  if (res.rows[0].search_path !== searchPath.toLowerCase()) {
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
