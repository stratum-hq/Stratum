import pg from "pg";
import { tenantSchemaName } from "../schema/manager.js";
import { resetSearchPath } from "../schema/session.js";

// Validate slug to prevent SQL injection — slugs follow /^[a-z][a-z0-9_]{0,62}$/
// so tenant_{slug} is always safe, but we verify the prefix is not tampered.
function validateSlug(slug: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(slug)) {
    throw new Error(`Invalid tenant slug: ${slug}`);
  }
  return slug;
}

export class SchemaRawAdapter {
  constructor(private pool: pg.Pool) {}

  async query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    tenantSlug: string,
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<T>> {
    return this.executeWithTenantContext(tenantSlug, async (client) => {
      return client.query<T>(text, values);
    });
  }

  /**
   * Executes a callback within a transaction scoped to the tenant's schema.
   * Sets `search_path` to `tenant_{slug}, public` for the duration of the transaction.
   */
  async executeWithTenantContext<T>(
    tenantSlug: string,
    fn: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const safe = validateSlug(tenantSlug);
    const schemaName = tenantSchemaName(safe);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // SET LOCAL is transaction-scoped; schemaName is derived from a validated slug.
      await client.query(`SET LOCAL search_path TO ${schemaName}, public`);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      await resetSearchPath(client);
      client.release();
    }
  }
}

export function createSchemaTenantPool(
  pool: pg.Pool,
  contextFn: () => string,
): SchemaRawAdapter {
  const adapter = new SchemaRawAdapter(pool);
  return new Proxy(adapter, {
    get(target, prop) {
      if (prop === "query") {
        return (text: string, values?: unknown[]) =>
          target.query(contextFn(), text, values);
      }
      return (target as unknown as Record<string | symbol, unknown>)[prop];
    },
  }) as SchemaRawAdapter;
}
