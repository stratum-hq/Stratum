import type { StackPreset } from "../matrix.js";

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

  return [
    {
      filename: "prisma/schema.prisma",
      content: `// Prisma schema for Stratum multi-tenancy
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "${provider}"
  url      = env("DATABASE_URL")
}

model Tenant {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now()) @map("created_at")

  @@map("tenants")
}

// Add your tenant-scoped models here.
// Each model that needs tenant isolation should have a tenantId field.
`,
    },
    {
      filename: "src/stratum-prisma.ts",
      content: `// Prisma client with Stratum tenant-scoped queries
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { prismaWithTenant } from "@stratum-hq/db-adapters";

const prisma = new PrismaClient();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Create a tenant-scoped Prisma client.
// All queries through this client are automatically filtered by RLS.
export function createTenantPrisma(getTenantId: () => string) {
  return prismaWithTenant(prisma, getTenantId, pool);
}

// Usage:
// const tenantPrisma = createTenantPrisma(() => currentTenantId);
// const orders = await tenantPrisma.order.findMany();

export { prisma, pool };
`,
    },
  ];
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
  // in DATABASE_ADMIN_URL, kept for migrations. A table the app role owned
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
    url: ${preset.database === "mysql" ? "process.env.DATABASE_URL!" : "(process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL)!"},
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
import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";

// An example tenant-scoped table: every row carries the tenant it belongs to.
// Stratum's own tables, such as tenants, are created by Stratum, not here.
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("notes_tenant_id_idx").on(table.tenantId)],
);
`;
}

function generateSequelizeSetup(preset: StackPreset): DbSetupFile[] {
  const dialect = preset.database === "mysql" ? "mysql" : "postgres";

  return [
    {
      filename: "src/stratum-sequelize.ts",
      content: `// Sequelize with Stratum tenant-scoped queries
import { Sequelize, DataTypes, Model } from "sequelize";

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

// For tenant isolation, add a tenantId scope to each model:
//   MyModel.addScope("tenant", (tenantId) => ({ where: { tenant_id: tenantId } }));
//   const rows = await MyModel.scope({ method: ["tenant", currentTenantId] }).findAll();

export { sequelize, Tenant };
`,
    },
  ];
}

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
      content: preset.database === "postgres" ? KNEX_POSTGRES_SCOPE : knexColumnScope(preset.database),
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

function knexColumnScope(database: string): string {
  return `// Knex with Stratum tenant-scoped queries
import Knex from "knex";
import config from "../knexfile.js";

const knex = Knex(config);

// Create a tenant-scoped query builder.
export async function withTenantScope(tenantId: string, fn: (db: typeof knex) => Promise<void>) {
  // For ${database}, scope queries by tenant_id column
  await fn(knex);
}

export { knex };
`;
}

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
    return [
      {
        filename: "src/stratum-db.ts",
        content: `// Raw MySQL client with Stratum tenant-scoped queries
import mysql from "mysql2/promise";

const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
});

// Execute a query scoped to a tenant by filtering on tenant_id
export async function tenantQuery(
  tenantId: string,
  sql: string,
  params: (string | number | bigint | boolean | Date | null)[] = [],
) {
  const [rows] = await pool.execute(sql, [...params, tenantId]);
  return rows;
}

// Usage:
// const orders = await tenantQuery("tenant-abc", "SELECT * FROM orders WHERE tenant_id = ?");

export { pool };
`,
      },
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
// const tenantPool = getTenantPool("tenant-abc");
// const { rows } = await tenantPool.query("SELECT * FROM orders");

export { pool };
`,
    },
  ];
}
