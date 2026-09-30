import pg from "pg";

/**
 * A minimal stand-in for a generated Prisma 5 client, used because running a
 * real Prisma client here would need the Prisma CLI, a generate step and the
 * native query-engine binaries. It reproduces the documented connection
 * behavior the db-adapters Prisma integrations depend on, verified against
 * @prisma/client 5.22.0:
 *
 *   - Model operations return lazy PrismaPromises. Awaited on their own they
 *     run on any free pooled connection, outside every transaction.
 *   - Interactive `$transaction(fn)` holds one connection for the callback.
 *     Only operations issued through `tx` run on it.
 *   - Inside a `$extends({ query: { $allOperations } })` hook, `query(args)`
 *     re-dispatches the operation with the ORIGINAL call's params, so it does
 *     not inherit an interactive `tx`.
 *   - Batch `$transaction([p1, p2])` runs every PrismaPromise in order on one
 *     connection inside BEGIN / COMMIT, including those from `query(args)`.
 *   - Table names are schema-qualified with the datasource URL's `schema`
 *     parameter (default "public"), so `search_path` never routes them.
 *
 * It models a single `widget` model with `findMany` and `create`.
 */

type Runner = (client: pg.PoolClient) => Promise<unknown>;

class PrismaPromise<T> implements PromiseLike<T> {
  private started?: Promise<T>;
  constructor(
    private readonly pool: pg.Pool,
    readonly run: Runner,
  ) {}
  then<A = T, B = never>(
    ok?: ((v: T) => A | PromiseLike<A>) | null,
    fail?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    if (!this.started) {
      this.started = (async () => {
        const client = await this.pool.connect();
        try {
          return (await this.run(client)) as T;
        } finally {
          client.release();
        }
      })();
    }
    return this.started.then(ok, fail);
  }
}

interface WidgetRow {
  id: number;
  name: string;
  tenant_id: string | null;
}

type Operation = "findMany" | "create";
type AllOperationsHook = (params: {
  model: string;
  operation: Operation;
  args: unknown;
  query: (args: unknown) => PrismaPromise<unknown>;
}) => Promise<unknown>;

export interface StandInOptions {
  datasources: { db: { url: string } };
  /** Role every pooled connection runs as, like connecting as that login role. */
  role?: string;
  /** Pool size, like Prisma's `connection_limit`. */
  connectionLimit?: number;
  /** Pool acquire timeout in ms, like Prisma's `pool_timeout`. */
  poolTimeoutMs?: number;
}

export class PrismaStandIn {
  readonly pool: pg.Pool;
  readonly schema: string;
  readonly url: string;

  constructor(options: StandInOptions) {
    this.url = options.datasources.db.url;
    const parsed = new URL(this.url);
    this.schema = parsed.searchParams.get("schema") ?? "public";
    parsed.searchParams.delete("schema");
    this.pool = new pg.Pool({
      connectionString: parsed.toString(),
      max: options.connectionLimit ?? 5,
      connectionTimeoutMillis: options.poolTimeoutMs ?? 10_000,
    });
    if (options.role) {
      const role = options.role;
      this.pool.on("connect", (c) => {
        c.query(`SET ROLE ${role}`).catch(() => {});
      });
    }
  }

  private table(): string {
    return `"${this.schema}"."widget"`;
  }

  private op(operation: Operation, args: unknown): PrismaPromise<unknown> {
    const table = this.table();
    return new PrismaPromise(this.pool, async (client) => {
      if (operation === "findMany") {
        const r = await client.query<WidgetRow>(`SELECT * FROM ${table} ORDER BY id`);
        return r.rows;
      }
      const data = (args as { data: { name: string; tenant_id?: string } }).data;
      const r = await client.query<WidgetRow>(
        `INSERT INTO ${table} (name, tenant_id) VALUES ($1, $2) RETURNING *`,
        [data.name, data.tenant_id ?? null],
      );
      return r.rows[0];
    });
  }

  get widget() {
    return {
      findMany: (args?: unknown) => this.op("findMany", args),
      create: (args: unknown) => this.op("create", args),
    };
  }

  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): PrismaPromise<number> {
    const text = strings.reduce((acc, s, i) => acc + (i === 0 ? "" : `$${i}`) + s, "");
    return new PrismaPromise(this.pool, async (c) => (await c.query(text, values)).rowCount ?? 0);
  }

  $executeRawUnsafe(text: string, ...values: unknown[]): PrismaPromise<number> {
    return new PrismaPromise(this.pool, async (c) => (await c.query(text, values)).rowCount ?? 0);
  }

  async $transaction(arg: unknown): Promise<unknown> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      let result: unknown;
      if (Array.isArray(arg)) {
        const out: unknown[] = [];
        for (const p of arg as PrismaPromise<unknown>[]) out.push(await p.run(client));
        result = out;
      } else {
        result = await (arg as (tx: unknown) => Promise<unknown>)(this.txView(client));
      }
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /** A `tx` whose operations run eagerly on the interactive transaction's connection. */
  private txView(client: pg.PoolClient) {
    const onTx = <T>(p: PrismaPromise<T>) => p.run(client) as Promise<T>;
    return {
      widget: {
        findMany: (args?: unknown) => onTx(this.op("findMany", args)),
        create: (args: unknown) => onTx(this.op("create", args)),
      },
      $executeRaw: (s: TemplateStringsArray, ...v: unknown[]) => onTx(this.$executeRaw(s, ...v)),
      $executeRawUnsafe: (t: string, ...v: unknown[]) => onTx(this.$executeRawUnsafe(t, ...v)),
    };
  }

  $extends(extension: { query: { $allOperations: AllOperationsHook } }) {
    const hook = extension.query.$allOperations;
    const base = this;
    const dispatch = (operation: Operation) => (args: unknown) =>
      hook({ model: "Widget", operation, args, query: (a) => base.op(operation, a) });
    return {
      widget: { findMany: dispatch("findMany"), create: dispatch("create") },
      $transaction: (arg: unknown) => base.$transaction(arg),
      $executeRaw: (s: TemplateStringsArray, ...v: unknown[]) => base.$executeRaw(s, ...v),
      $executeRawUnsafe: (t: string, ...v: unknown[]) => base.$executeRawUnsafe(t, ...v),
      $extends: (e: { query: { $allOperations: AllOperationsHook } }) => base.$extends(e),
      $connect: async () => {},
      $disconnect: () => base.$disconnect(),
    };
  }

  async $connect(): Promise<void> {}

  async $disconnect(): Promise<void> {
    await this.pool.end();
  }
}
