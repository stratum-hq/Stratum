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
  const envUrl = preset.database === "mysql"
    ? "mysql://user:password@localhost:3306/dbname"
    : "postgres://user:password@localhost:5432/dbname";

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
import { withTenant } from "@stratum-hq/db-adapters";

const prisma = new PrismaClient();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Create a tenant-scoped Prisma client.
// All queries through this client are automatically filtered by RLS.
export function createTenantPrisma(getTenantId: () => string) {
  return withTenant(prisma, getTenantId, pool);
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
import { withTenantDrizzle } from "@stratum-hq/db-adapters";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool);

// Create a tenant-scoped Drizzle instance.
// Queries are automatically filtered by RLS policy.
export function createTenantDb(getTenantId: () => string) {
  return withTenantDrizzle(db, getTenantId, pool);
}

// Usage:
// const tenantDb = createTenantDb(() => currentTenantId);
// const rows = await tenantDb.select().from(orders);

export { pool };
`,
    });
  }

  files.push({
    filename: "drizzle.config.ts",
    content: `import type { Config } from "drizzle-kit";

export default {
  schema: "./src/schema.ts",
  out: "./drizzle",
  ${preset.database === "mysql" ? 'dialect: "mysql",' : 'dialect: "postgresql",'}
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
`,
  });

  return files;
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
      content: `// Knex with Stratum tenant-scoped queries
import Knex from "knex";
import config from "../knexfile.js";

const knex = Knex(config);

// Create a tenant-scoped query builder.
// For RLS strategy, set the session variable before queries.
export async function withTenantScope(tenantId: string, fn: (db: typeof knex) => Promise<void>) {
${preset.database === "postgres" ? `  await knex.raw("SET app.current_tenant = ?", [tenantId]);` : `  // For ${preset.database}, scope queries by tenant_id column`}
  try {
    await fn(knex);
  } finally {
${preset.database === "postgres" ? `    await knex.raw("RESET app.current_tenant");` : `    // Scope cleanup not needed for column-based isolation`}
  }
}

export { knex };
`,
    },
  ];
}

function generateMongooseSetup(_preset: StackPreset): DbSetupFile[] {
  return [
    {
      filename: "src/stratum-mongoose.ts",
      content: `// Mongoose with Stratum multi-tenant support
import mongoose from "mongoose";
import { createTenantConnection } from "@stratum-hq/mongodb";

// Main connection (used for tenant metadata)
const mainConnection = mongoose.createConnection(
  process.env.MONGODB_URI || "mongodb://localhost:27017/main",
);

// Create a tenant-scoped connection.
// Each tenant gets its own database (database-per-tenant strategy)
// or collection prefix (collection strategy).
export function getTenantConnection(tenantId: string) {
  return createTenantConnection(mainConnection, tenantId);
}

// Define schemas that work across tenant connections
export const TenantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

// Usage:
// const conn = getTenantConnection("tenant-abc");
// const Order = conn.model("Order", OrderSchema);
// const orders = await Order.find();

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
export async function tenantQuery(tenantId: string, sql: string, params: unknown[] = []) {
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
// Sets app.current_tenant on each connection for RLS enforcement.
export function getTenantPool(tenantId: string) {
  return createTenantPool(pool, tenantId);
}

// Usage:
// const tenantPool = getTenantPool("tenant-abc");
// const { rows } = await tenantPool.query("SELECT * FROM orders");

export { pool };
`,
    },
  ];
}
