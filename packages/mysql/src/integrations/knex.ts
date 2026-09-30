// ─── Structural type for Knex (no hard dependency on knex) ───

export interface KnexQueryBuilderLike {
  where(col: string, val: unknown): this;
  select(...cols: string[]): this;
  insert(data: Record<string, unknown> | Record<string, unknown>[]): Promise<unknown>;
  update(data: Record<string, unknown>): this;
  delete(): this;
  first(): Promise<unknown>;
}

export interface KnexLike {
  (tableName: string): KnexQueryBuilderLike;
}

/** A where statement as Knex stores it on `builder._statements`. */
interface KnexStatement {
  grouping: string;
  [key: string]: unknown;
}

interface KnexBuilderInternals {
  _statements: KnexStatement[];
  [key: string]: unknown;
}

const TENANT_COLUMN = "tenant_id";

/** Builder methods that would write or destroy rows without the tenant filter. */
const REFUSED_METHODS = new Set(["upsert", "truncate"]);

function isTenantColumn(name: string): boolean {
  return name.toLowerCase() === TENANT_COLUMN;
}

function withoutTenantColumn(row: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!isTenantColumn(key)) copy[key] = value;
  }
  return copy;
}

/**
 * Returns a wrapper function that pre-scopes queries to the given tenant.
 * Call the returned function with a table name to get a builder whose query
 * always compiles to `WHERE tenant_id = ? AND (<your where clauses>)`.
 *
 * The caller's where clauses (including orWhere, whereRaw and clearWhere) are
 * kept together in one parenthesized group, so they cannot widen the query
 * past the tenant. This also holds for clones and for the builder used as a
 * subquery.
 *
 * INSERT operations automatically inject tenant_id into the data object, so
 * you do not need to include it yourself:
 *   await scoped("users").insert({ name: "Alice" });
 *
 * UPDATE never changes tenant_id: the column is dropped from the update data.
 * onConflict().merge(), upsert() and truncate() throw, because MySQL applies
 * none of them through the WHERE clause. onConflict().ignore() is allowed.
 */
export function withTenantScope(
  knex: KnexLike,
  tenantId: string,
): (tableName: string) => KnexQueryBuilderLike {
  // Statement objects this module created, so they can be recognized again on
  // clones, which copy the statement array but share the statement objects.
  const tenantStatements = new WeakSet<object>();
  const groupedStatements = new WeakMap<object, KnexStatement[]>();

  function normalize(builder: KnexBuilderInternals): void {
    const statements = builder._statements;
    const others: KnexStatement[] = [];
    let userWheres: KnexStatement[] = [];

    for (const stmt of statements) {
      if (stmt.grouping !== "where") {
        others.push(stmt);
      } else if (tenantStatements.has(stmt)) {
        continue;
      } else if (groupedStatements.has(stmt)) {
        userWheres = [...userWheres, ...(groupedStatements.get(stmt) as KnexStatement[])];
      } else {
        userWheres = [...userWheres, stmt];
      }
    }

    const tenantStmt: KnexStatement = {
      grouping: "where",
      type: "whereBasic",
      column: TENANT_COLUMN,
      operator: "=",
      value: tenantId,
      not: false,
      bool: "and",
      asColumn: false,
    };
    tenantStatements.add(tenantStmt);
    const next = [...others, tenantStmt];

    if (userWheres.length > 0) {
      const captured = userWheres;
      const groupStmt: KnexStatement = {
        grouping: "where",
        type: "whereWrapped",
        value: function (this: KnexBuilderInternals) {
          this._statements.push(...captured);
        },
        not: false,
        bool: "and",
      };
      groupedStatements.set(groupStmt, captured);
      next.push(groupStmt);
    }

    builder._statements = next;
  }

  function scope(target: KnexBuilderInternals): KnexQueryBuilderLike {
    // Knex methods call other methods on `this`. Only the outermost call is
    // intercepted and normalized, so a statement array is never swapped out
    // while a Knex method is still writing to it.
    let depth = 0;
    const proxy: KnexBuilderInternals = new Proxy(target, {
      get(obj, prop, receiver) {
        const value = Reflect.get(obj, prop, receiver);
        if (typeof value !== "function" || typeof prop !== "string" || prop === "constructor") {
          return value;
        }

        if (REFUSED_METHODS.has(prop)) {
          return () => {
            throw new Error(
              `withTenantScope: ${prop}() is not allowed on a tenant-scoped builder, ` +
                `because MySQL does not apply the tenant filter to it`,
            );
          };
        }

        if (depth > 0) {
          return (...args: unknown[]) => (value as (...a: unknown[]) => unknown).apply(proxy, args);
        }

        if (prop === "onConflict") {
          return (...args: unknown[]) => {
            const onConflict = (value as (...a: unknown[]) => { ignore(): unknown }).apply(proxy, args);
            return {
              ignore: () => onConflict.ignore(),
              merge: () => {
                throw new Error(
                  "withTenantScope: onConflict().merge() is not allowed on a tenant-scoped builder, " +
                    "because MySQL does not apply the tenant filter to it",
                );
              },
            };
          };
        }

        return (...args: unknown[]) => {
          if (prop === "insert") {
            const data = args[0] as Record<string, unknown> | Record<string, unknown>[];
            const inject = (row: Record<string, unknown>) => ({ ...row, tenant_id: tenantId });
            args[0] = Array.isArray(data) ? data.map(inject) : inject(data);
          } else if (prop === "update") {
            if (typeof args[0] === "string") {
              if (isTenantColumn(args[0])) {
                throw new Error(`withTenantScope: update() cannot change ${TENANT_COLUMN}`);
              }
            } else if (args[0] && typeof args[0] === "object") {
              args[0] = withoutTenantColumn(args[0] as Record<string, unknown>);
            }
          } else if (prop === "increment" || prop === "decrement") {
            const cols =
              typeof args[0] === "string" ? [args[0]] : Object.keys((args[0] ?? {}) as object);
            if (cols.some(isTenantColumn)) {
              throw new Error(`withTenantScope: ${prop}() cannot change ${TENANT_COLUMN}`);
            }
          }

          normalize(obj);
          let result: unknown;
          depth++;
          try {
            result = (value as (...a: unknown[]) => unknown).apply(proxy, args);
          } finally {
            depth--;
          }
          normalize(obj);

          if (prop === "clone") return scope(result as KnexBuilderInternals);
          return result === obj ? proxy : result;
        };
      },
    });
    normalize(target);
    return proxy as unknown as KnexQueryBuilderLike;
  }

  return (tableName: string) =>
    scope(knex(tableName) as unknown as KnexBuilderInternals);
}
