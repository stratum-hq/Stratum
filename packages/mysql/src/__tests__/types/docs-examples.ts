// Type test: the documented MySQL examples must compile under `tsc --strict`
// against the installed mysql2, knex, typeorm and sequelize types.
// `npm run typecheck` compiles this file through tsconfig.types.json. It never runs.
//
// Each function holds one example from website/src/content/docs/guides/mysql.mdx,
// packages/mysql/README.md or website/src/content/docs/packages/mysql.mdx. The
// example code is copied from the documentation, with these additions:
// `declare` lines for the values that the documentation defines outside the
// example, `return` and `void` lines for values that the example leaves unused
// (the lint rejects them), and `type: "mysql"` where the guide writes
// "your TypeORM config".
// When you change an example in the documentation, change it here too.

import mysql from "mysql2/promise";
import { Pool } from "pg";
import knexFactory from "knex";
import { Model, Sequelize } from "sequelize";
import { DataSource, type Repository } from "typeorm";
import { Stratum } from "@stratum-hq/lib";
import { runWithTenantContext, type StratumClient } from "@stratum-hq/sdk";
import {
  MysqlSharedAdapter,
  MysqlTableAdapter,
  MysqlDatabaseAdapter,
  registerStratumSubscriber,
  withTenantScope,
  withMysqlTenantScope,
} from "@stratum-hq/mysql";

declare const knex: ReturnType<typeof knexFactory>;
declare const q: string;
declare const sequelize: Sequelize;
declare class Note extends Model {}
declare const repo: Repository<{ id: number; tenant_id: string; name: string }>;
declare const dataSource: DataSource;
declare const mysqlPool: ReturnType<typeof mysql.createPool>;
declare const sharedAdapter: MysqlSharedAdapter;
declare const tableAdapter: MysqlTableAdapter;
declare const dbAdapter: MysqlDatabaseAdapter;
declare const client: StratumClient;
declare const tenantId: string;

// ─── Guide: Getting Started ───

export async function guideSharedTable() {
  // Control plane: always PostgreSQL
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const stratum = new Stratum({ pool, autoMigrate: true });
  await stratum.initialize();

  // MySQL adapter for application data
  const mysqlPool = mysql.createPool(process.env.MYSQL_URL!);
  const adapter = new MysqlSharedAdapter({
    pool: mysqlPool,
    databaseName: "myapp",
  });

  // Create a tenant (stored in PostgreSQL control plane)
  const tenant = await stratum.createTenant({
    name: "Acme Corp",
    slug: "acme",
  });

  // Structured query methods auto-inject tenant_id
  const users = await adapter.scopedSelect(tenant.id, "users");
  await adapter.scopedInsert(tenant.id, "users", { name: "Alice", email: "alice@acme.com" });
  await adapter.scopedUpdate(tenant.id, "users", { name: "Bob" }, { id: 1 });
  await adapter.scopedDelete(tenant.id, "users", { id: 1 });
  return users;
}

export async function guideTablePerTenant() {
  const adapter = new MysqlTableAdapter({
    pool: mysqlPool,
    databaseName: "myapp",
    // Every base table that has a per-tenant copy. Required by scopedTable and purgeTenantData.
    baseTables: ["users", "orders"],
  });

  // Returns the escaped table name: `users_acme`
  const tableName = adapter.scopedTable("acme", "users");

  // Use the pool directly with the scoped table name
  const [rows] = await mysqlPool.query(`SELECT * FROM ${tableName}`);
  return rows;
}

export async function guideDatabasePerTenant() {
  const adapter = new MysqlDatabaseAdapter({
    createPool: (uri) => mysql.createPool(uri),
    baseUri: "mysql://root@localhost:3306/placeholder",
    maxPools: 20,         // LRU eviction beyond this count
    idleTimeoutMs: 60000, // close idle pools after 60 seconds
  });

  // Returns a pool connected to stratum_tenant_acme
  const tenantPool = await adapter.getPool("acme");
  const [rows] = await tenantPool.query("SELECT * FROM users");

  // Clean up on app shutdown
  await adapter.closeAll();
  return rows;
}

// ─── Guide: ORM Integrations ───

export async function guideTypeOrmSubscriber() {
  const dataSource = new DataSource({
    // ... your TypeORM config
    type: "mysql",
  });
  await dataSource.initialize();
  // Adds one StratumTypeOrmSubscriber. A second call adds nothing.
  registerStratumSubscriber(dataSource);
}

export async function guideTypeOrmUpsert() {
  // Allowed: the conflict update writes `name` only.
  await repo.upsert({ id: 1, name: "Renamed" }, ["id"]);

  // Rejected: the conflict update would write `tenant_id`.
  await repo.upsert({ id: 1, tenant_id: "other", name: "Renamed" }, ["id"]);
}

export async function guideKnexHelper() {
  const tenantKnex = withTenantScope(knex, "acme");
  const users = await tenantKnex("users").where("name", "like", q).orWhere("email", "like", q);
  // Compiles to: WHERE tenant_id = 'acme' AND (name LIKE ? OR email LIKE ?)
  return users;
}

export async function guideSequelizeAdapter() {
  await withMysqlTenantScope(sequelize, "acme", async (scoped, transaction) => {
    // Models with a tenant_id attribute see and change only this tenant's rows.
    const notes = await Note.findAll({ include: ["owner"], transaction });
    await Note.create({ name: "new" }, { transaction }); // tenant_id is set for you
    void scoped;
    void notes;
  });
}

// ─── Guide: GDPR Compliance ───

export async function guidePurgeShared() {
  // Shared table: discovers tenant tables via INFORMATION_SCHEMA, deletes rows
  const result = await sharedAdapter.purgeTenantData("acme");
  return result;
}

export async function guidePurgeTable() {
  // Table-per-tenant: drops exactly {base}_acme for each entry in baseTables
  const result = await tableAdapter.purgeTenantData("acme");
  return result;
}

export async function guidePurgeDatabase() {
  // Database-per-tenant: drops the entire tenant database
  const result = await dbAdapter.purgeTenantData("acme");

  if (!result.success) {
    console.error("Purge incomplete:", result.errors);
    // result.errors lists tables that failed with the error
  }
}

// ─── Guide: Performance ───

export function guidePoolTuning() {
  const adapter = new MysqlDatabaseAdapter({
    createPool: (uri) => mysql.createPool(uri),
    baseUri: process.env.MYSQL_URL!,
    maxPools: 50,          // max concurrent tenant pools (default: 20)
    idleTimeoutMs: 60000,  // close idle pools after 60s (default: 60000)
  });
  return adapter;
}

// ─── README and package page ───

export async function readmeSharedTable() {
  const pool = mysql.createPool(process.env.MYSQL_URL!);
  const adapter = new MysqlSharedAdapter({ pool, databaseName: "myapp" });

  // Structured query methods auto-inject tenant_id
  const users = await adapter.scopedSelect("tenant-a", "users");
  await adapter.scopedInsert("tenant-a", "users", { name: "Alice" });
  await adapter.scopedUpdate("tenant-a", "users", { name: "Bob" }, { id: 1 });
  await adapter.scopedDelete("tenant-a", "users", { id: 1 });

  // Raw escape hatch (you own the WHERE clause)
  await adapter.unscopedRawQuery("SELECT * FROM users WHERE tenant_id = ? AND active = ?", ["tenant-a", true]);

  // GDPR purge
  await adapter.purgeTenantData("tenant-a");
  return users;
}

export async function readmeTablePerTenant() {
  const pool = mysql.createPool(process.env.MYSQL_URL!);
  const adapter = new MysqlTableAdapter({
    pool,
    databaseName: "myapp",
    // Every base table that has a per-tenant copy. Required by scopedTable and purgeTenantData.
    baseTables: ["users", "orders"],
  });

  // Returns escaped table name: `users_tenanta`
  const tableName = adapter.scopedTable("tenanta", "users");

  // Use the pool directly with the scoped table name
  const [rows] = await pool.query(`SELECT * FROM ${tableName}`);
  return rows;
}

export async function readmeDatabasePerTenant() {
  const adapter = new MysqlDatabaseAdapter({
    createPool: (uri) => mysql.createPool(uri),
    baseUri: "mysql://root@localhost:3306/placeholder",
    maxPools: 20,
    idleTimeoutMs: 60000,
  });

  // Returns a pool connected to stratum_tenant_tenanta
  const tenantPool = await adapter.getPool("tenanta");
  const [rows] = await tenantPool.query("SELECT * FROM users");

  // Clean up on shutdown
  await adapter.closeAll();
  return rows;
}

export async function readmeTypeOrmSubscriber() {
  await dataSource.initialize();
  // Adds one StratumTypeOrmSubscriber. A second call adds nothing.
  registerStratumSubscriber(dataSource);
}

export async function guideTypeOrmRunWithTenantContext() {
  // `client` is a StratumClient; resolveTenant returns the tenant's context.
  const context = await client.resolveTenant(tenantId);
  const notes = await runWithTenantContext(context, async () => {
    return await repo.find();
  });
  return notes;
}

export async function readmeKnexHelper() {
  const tenantKnex = withTenantScope(knex, "tenant-a");
  const users = await tenantKnex("users").where("name", "like", q).orWhere("email", "like", q);
  // Compiles to: WHERE tenant_id = 'tenant-a' AND (name LIKE ? OR email LIKE ?)
  return users;
}

export async function readmeSequelizeAdapter() {
  await withMysqlTenantScope(sequelize, "tenant-a", async (scoped, transaction) => {
    // Models with a tenant_id attribute see and change only this tenant's rows.
    const notes = await Note.findAll({ include: ["owner"], transaction });
    await Note.create({ name: "new" }, { transaction }); // tenant_id is set for you
    void scoped;
    void notes;
  });
}

export async function packagePageQuickStart() {
  const pool = mysql.createPool(process.env.MYSQL_URL!);
  const adapter = new MysqlSharedAdapter({ pool, databaseName: "myapp" });

  // Structured methods auto-inject tenant_id
  const users = await adapter.scopedSelect("acme", "users");
  await adapter.scopedInsert("acme", "users", { name: "Alice" });
  return users;
}

// ─── The fixed types are not `any` ───
// A builder or transaction typed `any` would compile every example above, and
// prove nothing. These checks fail when a type falls back to `any`.

export function knexBuilderIsTheKnexQueryBuilder() {
  const tenantKnex = withTenantScope(knex, "acme");
  // @ts-expect-error: The builder is Knex's QueryBuilder, so a method that Knex does not have is an error.
  tenantKnex("users").notAKnexMethod();
}

export async function sequelizeTransactionIsTheSequelizeTransaction() {
  await withMysqlTenantScope(sequelize, "acme", async (_scoped, transaction) => {
    // @ts-expect-error: The transaction is Sequelize's Transaction, so a method that it does not have is an error.
    transaction.notATransactionMethod();
  });
}
