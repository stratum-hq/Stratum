import type { StackPreset } from "../matrix.js";
import { PRISMA_APP_SCHEMA, tenantIsolationPolicySql } from "./init-sql.js";

export interface DbSetupFile {
  filename: string;
  content: string;
}

export function generateDbSetup(preset: StackPreset): DbSetupFile[] {
  switch (preset.orm) {
    case "prisma":
      return generatePrismaSetup(preset);
    case "drizzle":
      return generateDrizzleSetup(preset);
    case "sequelize":
      return generateSequelizeSetup(preset);
    case "knex":
      return generateKnexSetup(preset);
    case "mongoose":
      return generateMongooseSetup(preset);
    case "pg":
      return generatePgSetup(preset);
  }
}

function generatePrismaSetup(preset: StackPreset): DbSetupFile[] {
  const provider = preset.database === "mysql" ? "mysql" : "postgresql";
  const isolated = isIsolatedPostgres(preset);
  // On the rls preset, Stratum's own tables share the database with the
  // models, so the models get their own schema (see prismaSharedModels).
  const ownSchema = preset.database === "postgres" && preset.strategy === "rls";

  const files: DbSetupFile[] = [
    {
      filename: "prisma/schema.prisma",
      content: `// Prisma schema for Stratum multi-tenancy
generator client {
  provider = "prisma-client-js"${ownSchema ? `
  previewFeatures = ["multiSchema"]` : ""}
}

datasource db {
  provider = "${provider}"
  url      = env("DATABASE_URL")${ownSchema ? `
  schemas  = ["${PRISMA_APP_SCHEMA}"]` : ""}
}

${isolated ? prismaIsolatedModels(preset.strategy) : prismaSharedModels(ownSchema)}`,
    },
  ];

  if (preset.database !== "postgres" || preset.strategy === "rls") {
    files.push({
      filename: "src/stratum-prisma.ts",
      content: `// Prisma client with Stratum tenant-scoped queries
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { prismaWithTenant } from "@stratum-hq/db-adapters";

const prisma = new PrismaClient();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Create a tenant-scoped Prisma client. Each query runs in a transaction that
// sets app.current_tenant_id, the setting that the row-level security
// policies in prisma/rls.sql read. A table without such a policy is not
// filtered.
export function createTenantPrisma(getTenantId: () => string) {
  return prismaWithTenant(prisma, getTenantId, pool);
}

// Usage:
// const tenantPrisma = createTenantPrisma(() => currentTenantId);
// const notes = await tenantPrisma.note.findMany();

export { prisma, pool };
`,
    });
  }

  if (preset.database === "postgres" && preset.strategy === "rls") {
    files.push({ filename: "prisma/rls.sql", content: PRISMA_RLS_SQL });
    files.push({ filename: "scripts/db-push.mjs", content: PRISMA_DB_PUSH });
  }

  if (isolated) {
    files.push({ filename: "src/stratum-tenant.ts", content: TENANT_SLUG_LOOKUP });
    files.push({ filename: "src/stratum-prisma.ts", content: prismaIsolatedClient(preset.strategy) });
    files.push({ filename: "scripts/provision-tenant.mjs", content: provisionTenantScript(preset) });
  }

  return files;
}

function prismaSharedModels(ownSchema: boolean): string {
  return `// An example tenant-scoped model: every row carries the tenant it belongs to.
// Stratum's own tables, such as tenants, are created by Stratum, not here.
// Each tenant-scoped model needs a tenantId column and a row-level security
// policy in prisma/rls.sql.${ownSchema ? `
//
// Every model is in the ${PRISMA_APP_SCHEMA} schema (@@schema("${PRISMA_APP_SCHEMA}")). Stratum's tables are in
// public, and prisma db push changes only the schemas listed in the
// datasource, so it never drops or alters them. Give each model you add
// @@schema("${PRISMA_APP_SCHEMA}") too.` : ""}
model Note {
  id        String   @id @default(uuid()) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  body      String
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([tenantId])
  @@map("notes")${ownSchema ? `
  @@schema("${PRISMA_APP_SCHEMA}")` : ""}
}
`;
}

function prismaIsolatedModels(strategy: string): string {
  const where = strategy === "schema" ? "schema" : "database";
  return `// Your tenant-scoped models. Every tenant has its own ${where}, which
// \`npm run tenant:provision\` creates and pushes these models into, so the
// tables need no tenant column. Stratum's own tables, such as tenants, are
// created by Stratum, not here.
model Note {
  id        String   @id @default(uuid())
  body      String
  createdAt DateTime @default(now()) @map("created_at")

  @@map("notes")
}
`;
}

/**
 * True for the PostgreSQL presets that isolate tenants by schema or by
 * database. Their generated code routes each tenant to its own schema or
 * database and uses no row-level security.
 */
function isIsolatedPostgres(preset: StackPreset): boolean {
  return preset.database === "postgres" && (preset.strategy === "schema" || preset.strategy === "database");
}

const PRISMA_RLS_SQL = `-- Row-level security for the tenant-scoped tables of prisma/schema.prisma.
-- npm run db:push applies this file as the superuser after prisma db push.
-- Add the same statements for every tenant-scoped table you add: a table
-- without a policy is not filtered by tenant. The tables are in the
-- ${PRISMA_APP_SCHEMA} schema.
--
-- FORCE makes the policy apply to the table owner too. The app role does not
-- own the tables (the superuser creates them), and it is not a superuser and
-- has no BYPASSRLS, so the policy applies to it.
${tenantIsolationPolicySql(`${PRISMA_APP_SCHEMA}.notes`)}`;

const PRISMA_DB_PUSH = `// Creates the tables of prisma/schema.prisma and their row-level security
// policies (prisma/rls.sql). Run it with: npm run db:push
//
// Both steps run as the superuser in DATABASE_SUPERUSER_URL. The app role
// (DATABASE_URL) cannot create tables, and must not own them. prisma db push
// changes only the ${PRISMA_APP_SCHEMA} schema, which the datasource lists, so Stratum's
// tables in public are left alone.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import pg from "pg";

const superuserUrl = process.env.DATABASE_SUPERUSER_URL;
if (!superuserUrl) throw new Error("DATABASE_SUPERUSER_URL must be set (see .env.example)");

execFileSync("npx", ["prisma", "db", "push", "--skip-generate"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: superuserUrl },
});

const client = new pg.Client({ connectionString: superuserUrl });
await client.connect();
try {
  await client.query(readFileSync("prisma/rls.sql", "utf8"));
} finally {
  await client.end();
}
console.log("Applied prisma/rls.sql");
`;

/**
 * src/stratum-tenant.ts of the schema and database presets: the schema and
 * database adapters take a tenant slug, and the verified token carries the
 * tenant ID, so the generated code looks the slug up in Stratum.
 */
const TENANT_SLUG_LOOKUP = `// Maps a verified tenant ID to the tenant's Stratum slug. The slug names the
// tenant's own schema (tenant_{slug}) or database (stratum_tenant_{slug}).
import { Pool } from "pg";
import { Stratum } from "@stratum-hq/lib";

// Stratum reads its own tables through its own login,
// STRATUM_ADMIN_DATABASE_URL (see init.sql). The app role has no access to them.
export const stratum = new Stratum({
  pool: new Pool({ connectionString: process.env.DATABASE_URL }),
  adminPool: new Pool({ connectionString: process.env.STRATUM_ADMIN_DATABASE_URL }),
});

/**
 * The slug of the tenant with this ID. Pass only the tenant_id claim of a
 * verified token, as the generated server resolves it. Never take the slug
 * from the hostname or from a header such as x-tenant-slug: any caller can
 * choose those. Throws when no active tenant has this ID.
 *
 * Do not change a tenant's slug after it is provisioned: the name of its
 * schema or database is fixed at provisioning and does not follow the slug.
 * Never give a tenant a slug that another tenant had.
 */
export async function tenantSlug(tenantId: string): Promise<string> {
  return (await stratum.getTenant(tenantId)).slug;
}
`;

/**
 * The DatabasePoolManager of the database presets. pg lets a connectionString
 * override the database name, which would send every tenant to the database
 * in DATABASE_URL, so the manager gets the parts of the URL instead.
 */
const DATABASE_POOL_MANAGER = `// The manager opens one pool per tenant database and sets its name. It gets
// the parts of DATABASE_URL, not the URL: pg lets a connectionString override
// the database name, which would send every tenant to the same database.
// Add any other connection settings you need, such as ssl, here.
const url = new URL(process.env.DATABASE_URL!);
export const poolManager = new DatabasePoolManager({
  baseConnectionConfig: {
    host: url.hostname,
    port: Number(url.port) || 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  },
});`;

function prismaIsolatedClient(strategy: string): string {
  if (strategy === "schema") {
    return `// Prisma with Stratum schema-per-tenant isolation: each tenant's tables are in
// its own schema, tenant_{slug}, and each tenant gets a Prisma client bound to
// that schema.
import { PrismaClient } from "@prisma/client";
import { SchemaPrismaAdapter } from "@stratum-hq/db-adapters";
import { tenantSlug } from "./stratum-tenant.js";

// Connects as the app role in DATABASE_URL. Prisma schema-qualifies every
// table, so the adapter sets the schema in each tenant's datasource URL.
export const adapter = new SchemaPrismaAdapter(PrismaClient, process.env.DATABASE_URL!);

/** The Prisma client of the tenant's schema. Pass the tenant ID of a verified token. */
export async function getTenantPrisma(tenantId: string): Promise<PrismaClient> {
  return adapter.getClient(await tenantSlug(tenantId));
}

// Usage:
// const prisma = await getTenantPrisma(tenantId);
// const notes = await prisma.note.findMany();
`;
  }
  return `// Prisma with Stratum database-per-tenant isolation: each tenant's tables are
// in its own database, stratum_tenant_{slug}, and each tenant gets a Prisma
// client bound to that database.
import { PrismaClient } from "@prisma/client";
import { DatabasePoolManager, DatabasePrismaAdapter } from "@stratum-hq/db-adapters";
import { tenantSlug } from "./stratum-tenant.js";

${DATABASE_POOL_MANAGER}

// Connects as the app role in DATABASE_URL, with the tenant's database name.
export const adapter = new DatabasePrismaAdapter(poolManager, PrismaClient, process.env.DATABASE_URL!);

/** The Prisma client of the tenant's database. Pass the tenant ID of a verified token. */
export async function getTenantPrisma(tenantId: string): Promise<PrismaClient> {
  return adapter.getClient(await tenantSlug(tenantId));
}

// Usage:
// const prisma = await getTenantPrisma(tenantId);
// const notes = await prisma.note.findMany();
`;
}

function pgIsolatedClient(strategy: string): string {
  if (strategy === "schema") {
    return `// PostgreSQL client with Stratum schema-per-tenant isolation: each tenant's
// tables are in its own schema, tenant_{slug}.
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { SchemaRawAdapter } from "@stratum-hq/db-adapters";
import { tenantSlug } from "./stratum-tenant.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Runs each query in a transaction whose search_path is only the tenant's
// schema, so an unqualified table name resolves to the tenant's table.
const adapter = new SchemaRawAdapter(pool);

/** Runs one query in the tenant's schema. Pass the tenant ID of a verified token. */
export async function tenantQuery<T extends QueryResultRow = QueryResultRow>(
  tenantId: string,
  text: string,
  values?: unknown[],
): Promise<QueryResult<T>> {
  return adapter.query<T>(await tenantSlug(tenantId), text, values);
}

/** Runs fn in one transaction in the tenant's schema. */
export async function withTenantTransaction<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return adapter.executeWithTenantContext(await tenantSlug(tenantId), fn);
}

// Usage:
// const { rows } = await tenantQuery(tenantId, "SELECT * FROM notes");

export { pool };
`;
  }
  return `// PostgreSQL client with Stratum database-per-tenant isolation: each tenant's
// tables are in its own database, stratum_tenant_{slug}.
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { DatabasePoolManager, DatabaseRawAdapter } from "@stratum-hq/db-adapters";
import { tenantSlug } from "./stratum-tenant.js";

${DATABASE_POOL_MANAGER}

const adapter = new DatabaseRawAdapter(poolManager);

/** Runs one query in the tenant's database. Pass the tenant ID of a verified token. */
export async function tenantQuery<T extends QueryResultRow = QueryResultRow>(
  tenantId: string,
  text: string,
  values?: unknown[],
): Promise<QueryResult<T>> {
  return adapter.query<T>(await tenantSlug(tenantId), text, values);
}

/** Runs fn in one transaction in the tenant's database. */
export async function withTenantTransaction<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return adapter.executeWithTenantContext(await tenantSlug(tenantId), fn);
}

// Usage:
// const { rows } = await tenantQuery(tenantId, "SELECT * FROM notes");
`;
}

const PG_TENANT_SQL = `-- The tables of one tenant. npm run tenant:provision runs this file as the
-- superuser in each new tenant's own schema or database, so the tables need
-- no tenant column. Add your tenant-scoped tables here.
CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

/**
 * scripts/provision-tenant.mjs: creates one tenant's schema or database and
 * its tables, as the superuser, and gives the app role read and write access.
 */
function provisionTenantScript(preset: StackPreset): string {
  const schema = preset.strategy === "schema";
  const prisma = preset.orm === "prisma";
  const what = schema ? "schema (tenant_{slug})" : "database (stratum_tenant_{slug})";
  const tables = prisma ? "pushes prisma/schema.prisma into it" : "runs sql/tenant.sql in it";
  const adapterImport = schema
    ? `import { createSchema, tenantSchemaName } from "@stratum-hq/db-adapters";`
    : `import { createDatabase, getDatabaseName } from "@stratum-hq/db-adapters";`;

  const grants = (target: string) => `await client.query(\`GRANT USAGE ON SCHEMA ${target} TO \${appRole}\`);
  await client.query(\`ALTER DEFAULT PRIVILEGES IN SCHEMA ${target} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO \${appRole}\`);
  await client.query(\`ALTER DEFAULT PRIVILEGES IN SCHEMA ${target} GRANT USAGE, SELECT ON SEQUENCES TO \${appRole}\`);`;

  const pushPrisma = (urlVar: string) => `
// Push prisma/schema.prisma as the superuser, which then owns the tables.
execFileSync("npx", ["prisma", "db", "push", "--skip-generate"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: ${urlVar} },
});`;

  const body = schema
    ? `const schema = tenantSchemaName(slug);
const client = new pg.Client({ connectionString: superuserUrl });
await client.connect();
try {
  await client.query("BEGIN");
  // Fails if the schema exists: it may hold another tenant's data.
  await createSchema(client, slug);
  ${grants("${schema}")}${
    prisma
      ? ""
      : `
  await client.query(\`SET LOCAL search_path TO \${schema}\`);
  await client.query(readFileSync("sql/tenant.sql", "utf8"));`
  }
  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}
${
  prisma
    ? `
const schemaUrl = new URL(superuserUrl);
schemaUrl.searchParams.set("schema", schema);${pushPrisma("schemaUrl.toString()")}
`
    : ""
}console.log(\`Provisioned schema \${schema} for tenant \${tenantId}\`);
`
    : `const database = getDatabaseName(slug);
const admin = new pg.Client({ connectionString: superuserUrl });
await admin.connect();
try {
  // Fails if the database exists: it may hold another tenant's data.
  await createDatabase(admin, slug);
} finally {
  await admin.end();
}

const databaseUrl = new URL(superuserUrl);
databaseUrl.pathname = \`/\${database}\`;
const client = new pg.Client({ connectionString: databaseUrl.toString() });
await client.connect();
try {
  ${grants("public")}${
    prisma
      ? ""
      : `
  await client.query(readFileSync("sql/tenant.sql", "utf8"));`
  }
} finally {
  await client.end();
}
${prisma ? `${pushPrisma("databaseUrl.toString()")}
` : ""}console.log(\`Provisioned database \${database} for tenant \${tenantId}\`);
`;

  return `// Provisions one tenant: creates its own ${what}
// and ${tables}.
//
// Create the tenant with Stratum first, then run:
//   npm run tenant:provision -- <tenant-id>
//
// It runs as the superuser in DATABASE_SUPERUSER_URL, which creates and owns
// the tenant's tables, and gives the app role in DATABASE_URL read and write
// access to them. It reads the tenant's slug through Stratum's own login,
// STRATUM_ADMIN_DATABASE_URL.
${prisma ? `import { execFileSync } from "node:child_process";
` : `import { readFileSync } from "node:fs";
`}import pg from "pg";
import { Stratum } from "@stratum-hq/lib";
${adapterImport}

const tenantId = process.argv[2];
if (!tenantId) {
  console.error("Usage: npm run tenant:provision -- <tenant-id>");
  process.exit(1);
}
for (const key of ["DATABASE_URL", "DATABASE_SUPERUSER_URL", "STRATUM_ADMIN_DATABASE_URL"]) {
  if (!process.env[key]) throw new Error(\`\${key} must be set (see .env.example)\`);
}
const superuserUrl = process.env.DATABASE_SUPERUSER_URL;
const appRoleName = decodeURIComponent(new URL(process.env.DATABASE_URL).username);
if (!/^[a-z_][a-z0-9_]*$/.test(appRoleName)) throw new Error(\`Unexpected app role name: \${appRoleName}\`);
const appRole = \`"\${appRoleName}"\`;

const appPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const stratumPool = new pg.Pool({ connectionString: process.env.STRATUM_ADMIN_DATABASE_URL });
let slug;
try {
  slug = (await new Stratum({ pool: appPool, adminPool: stratumPool }).getTenant(tenantId)).slug;
} finally {
  await appPool.end();
  await stratumPool.end();
}

${body}`;
}

function generateDrizzleSetup(preset: StackPreset): DbSetupFile[] {
  const files: DbSetupFile[] = [];

  if (preset.database === "mysql") {
    files.push({
      filename: "src/stratum-drizzle.ts",
      content: `// Drizzle ORM with Stratum tenant-scoped queries (MySQL)
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

const connection = await mysql.createConnection({
  uri: process.env.DATABASE_URL,
});

export const db = drizzle(connection);

// For tenant scoping, prefix table access with the tenant database name
// or use the @stratum-hq/mysql adapter for automatic routing.
`,
    });
  } else {
    files.push({
      filename: "src/stratum-drizzle.ts",
      content: `// Drizzle ORM with Stratum tenant-scoped queries
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { drizzleWithTenant } from "@stratum-hq/db-adapters";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool);

// Create a tenant-scoped Drizzle instance.
// Queries are automatically filtered by RLS policy.
export function createTenantDb(getTenantId: () => string) {
  return drizzleWithTenant(db, getTenantId, pool);
}

// Usage: run tenant queries inside transaction() so the tenant context and
// the query share one connection.
// const tenantDb = createTenantDb(() => currentTenantId);
// const rows = await tenantDb.transaction((tx) => tx.select().from(orders));

export { pool };
`,
    });
  }

  files.push({
    filename: "src/schema.ts",
    content: drizzleSchema(preset),
  });

  // drizzle-kit creates tables, so on PostgreSQL it connects as the superuser
  // in DATABASE_SUPERUSER_URL, kept for migrations. A table the app role owned
  // would not be subject to its own RLS policies; init.sql grants the app role
  // access to the tables the superuser creates.
  files.push({
    filename: "drizzle.config.ts",
    content: `import type { Config } from "drizzle-kit";

export default {
  schema: "./src/schema.ts",
  out: "./drizzle",
  ${preset.database === "mysql" ? 'dialect: "mysql",' : 'dialect: "postgresql",'}
  dbCredentials: {
    url: ${preset.database === "mysql" ? "process.env.DATABASE_URL!" : "(process.env.DATABASE_SUPERUSER_URL ?? process.env.DATABASE_URL)!"},
  },
} satisfies Config;
`,
  });

  return files;
}

/** src/schema.ts, the Drizzle table definitions that drizzle.config.ts points at. */
function drizzleSchema(preset: StackPreset): string {
  if (preset.database === "mysql") {
    return `// Drizzle table definitions. drizzle.config.ts reads this file.
import { mysqlTable, varchar, text, timestamp } from "drizzle-orm/mysql-core";

// An example tenant-scoped table: every row carries the tenant it belongs to.
export const notes = mysqlTable("notes", {
  id: varchar("id", { length: 36 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 36 }).notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
`;
  }
  return `// Drizzle table definitions. drizzle.config.ts reads this file.
import { sql } from "drizzle-orm";
import { pgTable, pgPolicy, uuid, text, timestamp, index } from "drizzle-orm/pg-core";

// The tenant a query runs for: app.current_tenant_id, which createTenantDb in
// src/stratum-drizzle.ts sets. NULLIF turns the '' that a pooled connection
// reads after a tenant transaction into NULL, which matches no rows.
const currentTenant = sql\`NULLIF(current_setting('app.current_tenant_id', true), '')::uuid\`;

// An example tenant-scoped table: every row carries the tenant it belongs to,
// and the tenant_isolation policy lets a query see and write only the rows of
// its tenant. drizzle-kit turns on row-level security for a table with a
// policy. Each tenant-scoped table needs the same policy: a table without one
// is not filtered by tenant. The superuser that runs drizzle-kit owns the
// table, so the policy applies to the app role.
// Stratum's own tables, such as tenants, are created by Stratum, not here.
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("notes_tenant_id_idx").on(table.tenantId),
    pgPolicy("tenant_isolation", {
      as: "permissive",
      for: "all",
      using: sql\`\${table.tenantId} = \${currentTenant}\`,
      withCheck: sql\`\${table.tenantId} = \${currentTenant}\`,
    }),
  ],
);
`;
}

function generateSequelizeSetup(preset: StackPreset): DbSetupFile[] {
  const dialect = preset.database === "mysql" ? "mysql" : "postgres";

  return [
    {
      filename: "src/stratum-sequelize.ts",
      content: `// Sequelize with Stratum tenant-scoped queries
import { Sequelize, DataTypes, Model${preset.database === "postgres" ? ", type Transaction" : ""} } from "sequelize";

const sequelize = new Sequelize(process.env.DATABASE_URL!, {
  dialect: "${dialect}",
  logging: false,
});

// Define a tenant-scoped model example
class Tenant extends Model {}
Tenant.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    name: { type: DataTypes.STRING, allowNull: false },
  },
  { sequelize, tableName: "tenants", underscored: true },
);

${SEQUELIZE_POSTGRES_SCOPE}
export { sequelize, Tenant };
`,
    },
  ];
}

// The row-level security policies of init.sql read app.current_tenant_id, so
// a tenant query runs in a transaction that sets it.
const SEQUELIZE_POSTGRES_SCOPE = `// Run fn in a transaction that sets app.current_tenant_id, the setting that
// the row-level security policies in init.sql read. The setting ends with the
// transaction, so pass the transaction to every tenant query.
export async function withTenantScope<T>(
  tenantId: string,
  fn: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  return sequelize.transaction(async (transaction) => {
    await sequelize.query("SELECT set_config('app.current_tenant_id', $1, true)", {
      bind: [tenantId],
      transaction,
    });
    return fn(transaction);
  });
}

// Usage:
// const notes = await withTenantScope(currentTenantId, (transaction) =>
//   sequelize.query("SELECT * FROM notes", { transaction }),
// );
`;

function generateKnexSetup(preset: StackPreset): DbSetupFile[] {
  const client = preset.database === "mysql" ? "mysql2" : "pg";

  return [
    {
      filename: "knexfile.ts",
      content: `// Knex configuration for Stratum
import type { Knex } from "knex";

const config: Knex.Config = {
  client: "${client}",
  connection: process.env.DATABASE_URL,
  migrations: {
    directory: "./migrations",
    extension: "ts",
  },
};

export default config;
`,
    },
    {
      filename: "src/stratum-knex.ts",
      content: KNEX_POSTGRES_SCOPE,
    },
  ];
}

// PostgreSQL does not accept a bind parameter in SET, so the generated code
// calls set_config. The third argument (is_local = true) ends the setting with
// the transaction, so a pooled connection never keeps another tenant's ID.
const KNEX_POSTGRES_SCOPE = `// Knex with Stratum tenant-scoped queries
import createKnex, { type Knex } from "knex";
import config from "../knexfile.js";

const knex = createKnex(config);

// Run fn in a transaction that sets app.current_tenant_id, the setting that
// the RLS policies read. The setting ends with the transaction, so run every
// tenant query through trx, not through knex.
export async function withTenantScope<T>(
  tenantId: string,
  fn: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  return knex.transaction(async (trx) => {
    await trx.raw("SELECT set_config('app.current_tenant_id', ?, true)", [tenantId]);
    return fn(trx);
  });
}

// Usage:
// const orders = await withTenantScope(currentTenantId, (trx) => trx("orders").select());

export { knex };
`;

// @stratum-hq/mongodb has no Mongoose connection helper. The generated code uses
// Mongoose directly and copies the tenant names of the @stratum-hq/mongodb
// adapters, so MongoDatabaseAdapter and MongoCollectionAdapter find the same
// data, for example for purgeTenantData.
function generateMongooseSetup(preset: StackPreset): DbSetupFile[] {
  const tenantAccess =
    preset.strategy === "collection"
      ? `// Return the tenant's model for a base collection. The tenant's documents are
// in the collection {baseCollection}_{tenantSlug}, the name that
// MongoCollectionAdapter from @stratum-hq/mongodb uses.
export function getTenantModel<T>(
  baseCollection: string,
  schema: mongoose.Schema<T>,
  tenantSlug: string,
) {
  const name = \`\${baseCollection}_\${assertSlug(tenantSlug)}\`;
  return mainConnection.models[name] ?? mainConnection.model(name, schema, name);
}

// Usage:
// const Order = getTenantModel("orders", OrderSchema, "tenant_abc");
// const orders = await Order.find();`
      : `// Return a connection to the tenant's own database. The database name is
// stratum_tenant_{tenantSlug}, the name that MongoDatabaseAdapter from
// @stratum-hq/mongodb uses. useCache returns the same connection on each call.
export function getTenantConnection(tenantSlug: string) {
  return mainConnection.useDb(\`stratum_tenant_\${assertSlug(tenantSlug)}\`, { useCache: true });
}

// Usage:
// const conn = getTenantConnection("tenant_abc");
// const Order = conn.model("Order", OrderSchema);
// const orders = await Order.find();`;

  return [
    {
      filename: "src/stratum-mongoose.ts",
      content: `// Mongoose with Stratum multi-tenant support
import mongoose from "mongoose";

// Main connection (used for tenant metadata)
const mainConnection = mongoose.createConnection(
  process.env.MONGODB_URI || "mongodb://localhost:27017/main",
);

// A tenant slug becomes part of a MongoDB name, so it must match the Stratum
// slug rule: a lowercase letter, then lowercase letters, digits or underscores.
const SLUG_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

function assertSlug(tenantSlug: string): string {
  if (!SLUG_PATTERN.test(tenantSlug)) {
    throw new Error(\`Invalid tenant slug: "\${tenantSlug}"\`);
  }
  return tenantSlug;
}

${tenantAccess}

// Define schemas that work across tenant connections
export const TenantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

export { mainConnection };
`,
    },
  ];
}

function generatePgSetup(preset: StackPreset): DbSetupFile[] {
  if (preset.database === "mysql") {
    return generateMysqlSetup(preset);
  }

  if (isIsolatedPostgres(preset)) {
    return [
      { filename: "src/stratum-tenant.ts", content: TENANT_SLUG_LOOKUP },
      { filename: "src/stratum-db.ts", content: pgIsolatedClient(preset.strategy) },
      { filename: "sql/tenant.sql", content: PG_TENANT_SQL },
      { filename: "scripts/provision-tenant.mjs", content: provisionTenantScript(preset) },
    ];
  }

  return [
    {
      filename: "src/stratum-db.ts",
      content: `// PostgreSQL client with Stratum tenant-scoped queries
import { Pool } from "pg";
import { createTenantPool } from "@stratum-hq/db-adapters";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Create a tenant-scoped pool.
// Each query runs in a transaction that sets app.current_tenant_id, the
// setting that the RLS policies read.
export function getTenantPool(tenantId: string) {
  return createTenantPool(pool, () => tenantId);
}

// Usage:
// const tenantPool = getTenantPool(currentTenantId);
// const { rows } = await tenantPool.query("SELECT * FROM notes");

export { pool };
`,
    },
  ];
}

// ─── MySQL ───────────────────────────────────────────────────────────────────
// The MySQL presets route each tenant with the @stratum-hq/mysql adapter of
// the strategy: MysqlDatabaseAdapter (a database per tenant) or
// MysqlTableAdapter (a copy of each table per tenant). Both take the tenant's
// slug, which the generated code looks up in _stratum_tenants by the tenant ID
// of the verified token.

function generateMysqlSetup(preset: StackPreset): DbSetupFile[] {
  const database = preset.strategy === "database";
  return [
    { filename: "src/stratum-tenant.ts", content: mysqlTenantLookup(database ? "database" : "tables") },
    { filename: "src/stratum-db.ts", content: database ? MYSQL_DATABASE_CLIENT : MYSQL_TABLE_CLIENT },
    { filename: "sql/tenant.sql", content: database ? MYSQL_DATABASE_TENANT_SQL : MYSQL_TABLE_TENANT_SQL },
    { filename: "scripts/provision-tenant.mjs", content: mysqlProvisionScript(database) },
  ];
}

function mysqlTenantLookup(where: string): string {
  return `// Maps a verified tenant ID to the tenant's slug. The slug names the tenant's
// own database (stratum_tenant_{slug}) or tables ({table}_{slug}).
import mysql, { type RowDataPacket } from "mysql2/promise";

// The app's own database, as the app user in DATABASE_URL.
export const pool = mysql.createPool({ uri: process.env.DATABASE_URL! });

/**
 * The slug of the tenant with this ID, from _stratum_tenants, where npm run
 * tenant:provision records it. Pass only the tenant_id claim of a verified
 * token, as the generated server resolves it. Never take the slug from the
 * request, such as its host name or a header: any caller can choose those.
 * Throws when no tenant with this ID is provisioned.
 *
 * Do not change a slug in _stratum_tenants: the names of the tenant's
 * ${where} are fixed at provisioning and do not follow the slug.
 */
export async function tenantSlug(tenantId: string): Promise<string> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT slug FROM _stratum_tenants WHERE id = ?", [tenantId]);
  if (rows.length === 0) throw new Error(\`No provisioned tenant has the ID \${tenantId}\`);
  return rows[0].slug as string;
}
`;
}

const MYSQL_DATABASE_CLIENT = `// MySQL client with Stratum database-per-tenant isolation: each tenant's
// tables are in its own database, stratum_tenant_{slug}.
import mysql from "mysql2/promise";
import { MysqlDatabaseAdapter } from "@stratum-hq/mysql";
import { tenantSlug } from "./stratum-tenant.js";

// Opens one pool per tenant database, as the app user in DATABASE_URL, with
// the tenant's database name in place of the one in the URL.
export const adapter = new MysqlDatabaseAdapter({
  createPool: (uri) => mysql.createPool(uri),
  baseUri: process.env.DATABASE_URL!,
});

/** Runs one query in the tenant's database. Pass the tenant ID of a verified token. */
export async function tenantQuery<T = unknown>(tenantId: string, sql: string, params: unknown[] = []): Promise<T> {
  const slug = await tenantSlug(tenantId);
  const pool = await adapter.getPool(slug);
  try {
    const [result] = await pool.query(sql, params);
    return result as T;
  } finally {
    adapter.releasePool(slug);
  }
}

// Usage:
// const notes = await tenantQuery(tenantId, "SELECT * FROM notes");
`;

const MYSQL_TABLE_CLIENT = `// MySQL client with Stratum table-per-tenant isolation: each tenant has its
// own copy of each table, {table}_{slug}, in the app's database.
import { MysqlTableAdapter } from "@stratum-hq/mysql";
import { pool, tenantSlug } from "./stratum-tenant.js";

// Every table of sql/tenant.sql, by its name without the slug. Add each table
// you add there.
export const BASE_TABLES = ["notes"] as const;
export type BaseTable = (typeof BASE_TABLES)[number];

export const adapter = new MysqlTableAdapter({
  pool,
  databaseName: decodeURIComponent(new URL(process.env.DATABASE_URL!).pathname.slice(1)),
  baseTables: [...BASE_TABLES],
});

/**
 * Runs one query on the tenant's tables. sql gets table(), which returns the
 * escaped name of the tenant's copy of a table: name every table with
 * table("notes"), never by its plain name. Pass the tenant ID of a verified
 * token.
 */
export async function tenantQuery<T = unknown>(
  tenantId: string,
  sql: (table: (base: BaseTable) => string) => string,
  params: unknown[] = [],
): Promise<T> {
  const slug = await tenantSlug(tenantId);
  const [result] = await pool.query(sql((base) => adapter.scopedTable(slug, base)), params);
  return result as T;
}

// Usage:
// const notes = await tenantQuery(tenantId, (table) => \`SELECT * FROM \${table("notes")}\`);
`;

const MYSQL_DATABASE_TENANT_SQL = `-- The tables of one tenant. npm run tenant:provision runs this file as the
-- admin user in each new tenant's own database, so the tables need no tenant
-- column. Add your tenant tables here.
CREATE TABLE notes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

const MYSQL_TABLE_TENANT_SQL = `-- The tables of one tenant. npm run tenant:provision runs this file as the
-- admin user for each new tenant, with {slug} replaced by the tenant's slug,
-- so each tenant gets its own copy of each table and the tables need no
-- tenant column. Name each table \`{table}_{slug}\`, and add {table} to
-- BASE_TABLES in src/stratum-db.ts.
CREATE TABLE \`notes_{slug}\` (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

/**
 * scripts/provision-tenant.mjs of the MySQL presets: creates one tenant's
 * database or tables as the admin user, gives the app user read and write
 * access to them, and records its slug. A run that fails removes what it
 * created, so it can run again.
 */
function mysqlProvisionScript(database: boolean): string {
  const what = database
    ? "its own database (stratum_tenant_{slug}) and runs sql/tenant.sql in it"
    : "its copy of each table of sql/tenant.sql ({table}_{slug})";
  const create = database
    ? `    // Fails if the database exists: it may hold another tenant's data.
    await admin.query(\`CREATE DATABASE \\\`\${database}\\\`\`);
    created.push(\`DROP DATABASE \\\`\${database}\\\`\`);
    // In a GRANT, _ in a database name matches any character, and \\_ only _.
    const grantTarget = \`\\\`\${database.replaceAll("_", "\\\\_")}\\\`.*\`;
    await admin.query(\`GRANT SELECT, INSERT, UPDATE, DELETE ON \${grantTarget} TO ?@?\`, appUser);
    created.push(mysql.format(\`REVOKE IF EXISTS SELECT, INSERT, UPDATE, DELETE ON \${grantTarget} FROM ?@?\`, appUser));
    const databaseUrl = new URL(superuserUrl);
    databaseUrl.pathname = \`/\${database}\`;
    const tenant = await mysql.createConnection({ uri: databaseUrl.toString(), multipleStatements: true });
    try {
      await tenant.query(readFileSync("sql/tenant.sql", "utf8"));
    } finally {
      await tenant.end();
    }`
    : `    // Fails if a table exists: it may hold another tenant's data. The tables
    // the file creates are the ones that were not there before it ran.
    const before = new Set(await tableNames());
    let tables = [];
    try {
      await admin.query(readFileSync("sql/tenant.sql", "utf8").replaceAll("{slug}", slug));
    } finally {
      tables = (await tableNames()).filter((table) => !before.has(table));
      for (const table of tables) created.push(\`DROP TABLE \\\`\${table}\\\`\`);
    }
    for (const table of tables) {
      await admin.query(\`GRANT SELECT, INSERT, UPDATE, DELETE ON \\\`\${table}\\\` TO ?@?\`, appUser);
      created.push(mysql.format(\`REVOKE IF EXISTS SELECT, INSERT, UPDATE, DELETE ON \\\`\${table}\\\` FROM ?@?\`, appUser));
    }`;

  return `// Provisions one tenant: creates ${what},
// gives the app user read and write access to ${database ? "it" : "them"}, and records the tenant's
// slug in _stratum_tenants, where the app looks it up.
//
//   npm run tenant:provision -- <tenant-id> <slug>
//
// <tenant-id> is the tenant_id claim of the tenant's tokens. <slug> names the
// tenant's ${database ? "database" : "tables"}: a lowercase letter, then lowercase letters, digits or
// underscores. It runs as the admin user in DATABASE_SUPERUSER_URL, never as
// the app user in DATABASE_URL. If it fails, it removes what it created, so
// you can run it again.
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";

const [tenantId, slug] = process.argv.slice(2);
if (!tenantId || !slug) {
  console.error("Usage: npm run tenant:provision -- <tenant-id> <slug>");
  process.exit(1);
}
// _stratum_tenants.id holds at most 36 ASCII characters, such as a UUID.
if (!/^[\\x21-\\x7e]{1,36}$/.test(tenantId)) throw new Error(\`Invalid tenant ID: \${tenantId}\`);
// The Stratum slug rule, which @stratum-hq/mysql checks too.
if (!/^[a-z][a-z0-9_]{0,62}$/.test(slug)) throw new Error(\`Invalid tenant slug: \${slug}\`);${
    database
      ? `
const database = \`stratum_tenant_\${slug}\`;
// MySQL database names are at most 64 characters.
if (database.length > 64) throw new Error(\`Slug \${slug} is too long: \${database} has more than 64 characters\`);`
      : ""
  }
for (const key of ["DATABASE_URL", "DATABASE_SUPERUSER_URL"]) {
  if (!process.env[key]) throw new Error(\`\${key} must be set (see .env.example)\`);
}
const superuserUrl = process.env.DATABASE_SUPERUSER_URL;

// The app user as MySQL names it, user@host, for the grants.
const app = await mysql.createConnection({ uri: process.env.DATABASE_URL });
const [[{ user: currentUser }]] = await app.query("SELECT CURRENT_USER() AS user");
await app.end();
const at = currentUser.lastIndexOf("@");
const appUser = [currentUser.slice(0, at), currentUser.slice(at + 1)];

const admin = await mysql.createConnection({ uri: superuserUrl, multipleStatements: true });${
    database
      ? ""
      : `
const tableNames = async () =>
  (await admin.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"))[0].map(
    (row) => row.name,
  );`
  }
// Statements that undo what this run created, run in reverse if it fails.
const created = [];
try {
  // Each tenant ID and each slug is provisioned once: a tenant that got a
  // slug another tenant had would reach that tenant's ${database ? "database" : "tables"}.
  const [existing] = await admin.query("SELECT id FROM _stratum_tenants WHERE id = ? OR slug = ?", [tenantId, slug]);
  if (existing.length > 0) throw new Error(\`Tenant \${tenantId} or slug \${slug} is already provisioned\`);

  try {
${create}

    await admin.query("INSERT INTO _stratum_tenants (id, name, slug) VALUES (?, ?, ?)", [tenantId, slug, slug]);
  } catch (err) {
    for (const statement of created.reverse()) await admin.query(statement);
    throw err;
  }
} finally {
  await admin.end();
}
console.log(\`Provisioned tenant \${tenantId} as \${slug}\`);
`;
}
