import pg from "pg";
import { validateSlug } from "@stratum-hq/core";
import { tenantSchemaName, validateSchemaName } from "../schema/manager.js";
import { resetSearchPath, tenantSearchPath } from "../schema/session.js";

export interface SchemaAdapterOptions {
  /**
   * Schemas searched after the tenant schema, for example one holding
   * extension functions or types. Default: none. An unqualified table missing
   * from the tenant schema resolves in these schemas, so list only schemas
   * that hold no tenant data.
   */
  extraSearchPath?: string[];
}

export class SchemaRawAdapter {
  private readonly extraSearchPath: string[];

  constructor(
    private pool: pg.Pool,
    options: SchemaAdapterOptions = {},
  ) {
    // Validate up front so a bad entry fails at construction, not per query.
    this.extraSearchPath = (options.extraSearchPath ?? []).map(validateSchemaName);
  }

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
   * Sets `search_path` to `tenant_{slug}`, followed only by any `extraSearchPath`
   * schemas, for the duration of the transaction.
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
      await client.query(
        `SET LOCAL search_path TO ${tenantSearchPath(schemaName, this.extraSearchPath)}`,
      );
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      // A failed RESET must not replace the result or the caller's error.
      // The RESET error goes to client.release instead: a truthy argument makes
      // pg-pool destroy the connection, so no later caller gets a connection
      // with an unknown search_path.
      let resetErr: Error | undefined;
      try {
        await resetSearchPath(client);
      } catch (err) {
        resetErr = err instanceof Error ? err : new Error(String(err));
      }
      client.release(resetErr);
    }
  }
}

export function createSchemaTenantPool(
  pool: pg.Pool,
  contextFn: () => string,
  options: SchemaAdapterOptions = {},
): SchemaRawAdapter {
  const adapter = new SchemaRawAdapter(pool, options);
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
