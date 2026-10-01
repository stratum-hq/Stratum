# @stratum-hq/db-adapters

PostgreSQL adapters for [Stratum](https://github.com/stratum-hq/Stratum) that automatically scope queries to the current tenant using Row-Level Security. Supports raw `pg`, Prisma, Drizzle, and Sequelize, plus helpers for enabling RLS on your tables.

## Installation

```bash
npm install @stratum-hq/db-adapters @stratum-hq/core pg
```

## Raw PostgreSQL

```typescript
import { Pool } from "pg";
import { RawAdapter, createTenantPool } from "@stratum-hq/db-adapters";
import { getTenantContext } from "@stratum-hq/sdk";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Automatic context from AsyncLocalStorage
const tenantPool = createTenantPool(pool, () => getTenantContext().tenant_id);
const orders = await tenantPool.query("SELECT * FROM orders");

// Or manual, per-query
const adapter = new RawAdapter(pool);
await adapter.query("tenant-id", "SELECT * FROM orders");
```

Every query is wrapped in a transaction that sets `app.current_tenant_id` via a parameterized `set_config()` (SQL-injection-safe), runs your query under the RLS policy, commits, and resets the tenant context before releasing the connection.

## ORM Adapters

```typescript
import { prismaWithTenant } from "@stratum-hq/db-adapters";        // Prisma
import { drizzleWithTenant } from "@stratum-hq/db-adapters";  // Drizzle
import { SequelizeAdapter, sequelizeWithTenantScope } from "@stratum-hq/db-adapters"; // Sequelize

// Prisma: all queries scoped to the current tenant
const tenantPrisma = prismaWithTenant(prisma, () => getTenantContext().tenant_id, pool);
const orders = await tenantPrisma.order.findMany();
```

## RLS & Migration Helpers

```typescript
import { enableRLS, createPolicy, migrateTable } from "@stratum-hq/db-adapters";

const client = await pool.connect();
try {
  await client.query("BEGIN");
  // One step: add tenant_id, enable FORCE RLS, create the isolation policy
  await migrateTable(client, "orders");
  await client.query("COMMIT");
} finally {
  client.release();
}
```

`createPolicy` checks every row-level security policy already on the table (the table the name resolves to through the `search_path`) before it adds the `tenant_isolation` policy or keeps an existing one, and throws without changing anything if any check fails:

- PostgreSQL ORs permissive policies together, so every permissive policy, whatever its name or roles, must compare `tenant_id` with the current tenant setting `app.current_tenant_id` for the commands it covers (`USING` for reads, updates and deletes; `WITH CHECK` for inserts, and for updates when set). A role-specific permissive policy counts too, because `createPolicy` cannot know which role your application connects as.
- Restrictive policies can only narrow access, so they may check anything.
- An existing `tenant_isolation` policy must be permissive, apply to all commands, and apply to `PUBLIC` (no `TO` clause), like the one `createPolicy` generates and every policy Stratum ships.

The check recognizes the form Stratum generates, with the operands in either order, with casts, ANDed with other conditions, or ORed with Stratum's `app.bypass_rls` bypass. A policy that isolates correctly but is written in another form is also refused; replace it with the generated form. This is a breaking change for callers that relied on the old skip, shipped in a minor release.

`isRLSEnabled` reports on the table that the name resolves to through the `search_path`, not on a table with the same name in another schema.

Also available: `disableRLS`, `dropPolicy`, `isRLSEnabled`, `addTenantColumn`, `createIsolationPolicy`, and low-level session helpers `setTenantContext` / `resetTenantContext` / `getCurrentTenantId`. Schema-per-tenant and database-per-tenant variants (`SchemaRawAdapter`, `DatabasePoolManager`, …) are exported too.

## Schema-per-tenant search_path

`SchemaRawAdapter`, `createSchemaTenantPool` and `setSchemaSearchPath` set `search_path` to the tenant schema (`tenant_<slug>`) **alone**, inside a transaction. `public` is not on the path, so an unqualified table missing from the tenant schema is an error instead of silently reading or writing a table every tenant shares. (`setSchemaSearchPath` throws if it is called outside a transaction.)

If your queries call extension functions or types that live in another schema (for example `uuid_generate_v4()`, `ltree` operators, `citext` or `pgcrypto` installed in `public`), either schema-qualify them or opt that schema in explicitly:

```typescript
import { SchemaRawAdapter, createSchemaTenantPool, setSchemaSearchPath } from "@stratum-hq/db-adapters";

const adapter = new SchemaRawAdapter(pool, { extraSearchPath: ["extensions"] });
const tenantPool = createSchemaTenantPool(pool, getTenantSlug, { extraSearchPath: ["extensions"] });
await setSchemaSearchPath(client, "acme", ["extensions"]); // inside BEGIN ... COMMIT
```

Extra schemas come **after** the tenant schema, and each entry must be a plain identifier (`/^[a-zA-Z_][a-zA-Z0-9_]*$/`, validated like tenant schema names). The trade-off: an unqualified table name missing from the tenant schema resolves in the extra schemas too, so list only schemas that hold no tenant data. Prefer a dedicated extensions schema over `public`. Column defaults such as `DEFAULT uuid_generate_v4()` are bound when the table is created and work without any extra schema.

Prisma qualifies every table with its datasource schema, so `search_path` does not route it. For Prisma, use `new SchemaPrismaAdapter(PrismaClient, datasourceUrl).getClient(tenantSlug)`, which gives each tenant a client bound to its own schema.

## Database-per-tenant pools

`DatabasePoolManager` keeps one `pg.Pool` for each tenant database. Each `getPool(slug)` call holds the pool until you call `releasePool(slug)` with the same arguments. The manager never ends a held pool. Thus a request that is using a pool cannot lose it to eviction.

```typescript
const pool = await poolManager.getPool("acme");
try {
  await pool.query("SELECT 1");
} finally {
  poolManager.releasePool("acme");
}
```

When the pool count reaches `maxPools`, the manager ends the least recently used pool that no caller holds. If every pool is held, the count goes above `maxPools` until a caller releases one. A pool that you never release stays open until `closePool` or `closeAll`. `DatabaseRawAdapter` releases its pool after each call.

Concurrent first requests for one tenant share one pool.

## PGlite

`@stratum-hq/db-adapters/pglite` runs `@stratum-hq/lib` on [PGlite](https://pglite.dev), which is PostgreSQL compiled to WebAssembly. It works in Node and in the browser, and it needs no database server. Use it for fast local tests and for demos.

Install PGlite. It is an optional peer dependency, so npm does not install it for you.

```bash
npm install @electric-sql/pglite
```

```typescript
import { Stratum } from "@stratum-hq/lib";
import { withTenantContext } from "@stratum-hq/db-adapters";
import { createPglitePool, createRestrictedPool } from "@stratum-hq/db-adapters/pglite";

// In-memory database. Pass PGlite options, such as { dataDir: "idb://my-db" }, to keep data.
const pool = await createPglitePool();
const stratum = new Stratum({ pool, autoMigrate: true });
await stratum.initialize();

const acme = await stratum.createTenant({ name: "Acme", slug: "acme" });

// Row-level security applies only to a role that is not a superuser.
const appPool = await createRestrictedPool(pool);
await withTenantContext(appPool, acme.id, (client) => client.query("SELECT * FROM config_entries"));
```

`createPglitePool(source?)` returns a `pg.Pool`-compatible object:

- `source` is a PGlite instance or PGlite options. When you pass options, the pool creates the instance and loads the `ltree` and `uuid_ossp` extensions. `pool.end()` then closes the instance.
- When you pass your own instance, load `ltree` and `uuid_ossp` yourself. `pool.end()` does not close your instance.
- `pool.pglite` is the PGlite instance.

`createRestrictedPool(pool, { role? })` creates the role `stratum_app` (or the name you give) with `NOSUPERUSER NOBYPASSRLS`. It grants the role read and write access to every table and sequence in the `public` schema. Default privileges extend the grants to tables that the superuser creates later. The returned pool runs every query as that role.

Limits:

- **One connection.** A client from `connect()` holds the only connection until `release()`. Other callers wait in order. If you hold a client and call `pool.query()`, the call waits forever.
- **No concurrency.** Queries run one at a time. Do not use this adapter to test race conditions or lock contention.
- **Superuser by default.** PGlite connects as the superuser `postgres`, and a superuser bypasses row-level security. Use `createRestrictedPool` when a test must prove isolation.
- **Only part of `pg.Pool`.** The pool supports `query`, `connect`, `end` and `on`. Callbacks, cursors, `totalCount` and the other pool counters do not exist.
- PGlite `^0.4.2` is the supported version.

## Security

- All DDL validates table names against `/^[a-zA-Z_][a-zA-Z0-9_]*$/`.
- Tenant ID is always set via `set_config($1, true)`, fully parameterized.
- `enableRLS()` always applies `FORCE ROW LEVEL SECURITY`, preventing bypass by table owners.
- Always reset the tenant context when returning connections to the pool; `createTenantPool` handles this for you.

## Links

- Documentation: https://docs.stratum-hq.org/packages/db-adapters/
- GitHub: https://github.com/stratum-hq/Stratum

## License

MIT © Christian Crank
