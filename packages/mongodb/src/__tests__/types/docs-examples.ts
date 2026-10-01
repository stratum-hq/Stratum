// Type test: the documented MongoDB examples must compile under `tsc --strict`
// against the installed mongodb and mongoose types.
// `npm run typecheck` compiles this file through tsconfig.types.json. It never runs.
//
// Each function holds one example from website/src/content/docs/guides/mongodb.mdx,
// packages/mongodb/README.md or website/src/content/docs/packages/mongodb.mdx. The
// example code is copied from the documentation. The `declare` lines supply the
// values that the documentation defines outside the example, and a `return`
// keeps a value that the example leaves unused (the lint rejects it).
// When you change an example in the documentation, change it here too.

import { Pool } from "pg";
import { MongoClient } from "mongodb";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import type { Express } from "express";
import { Stratum } from "@stratum-hq/lib";
import { runWithTenantContext } from "@stratum-hq/sdk";
import type { ResolvedTenantContext } from "@stratum-hq/sdk";
import {
  MongoSharedAdapter,
  MongoCollectionAdapter,
  MongoDatabaseAdapter,
  stratumPlugin,
} from "@stratum-hq/mongodb";

declare const app: Express;
declare const jwtSecret: string;
declare const stratum: Stratum;
declare const client: MongoClient;
declare const connection: mongoose.Connection;
// The guide's Mongoose Plugin section defines these two.
const orderSchema = new mongoose.Schema({
  product: String,
  quantity: Number,
  total: Number,
});
const Order = mongoose.model("Order", orderSchema);
declare const mongo: MongoSharedAdapter;
declare const tenant: { id: string };
declare const adapter: MongoDatabaseAdapter;

// ─── Guide: Getting Started ───

export async function guideSharedCollection() {
  // Control plane: always PostgreSQL
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const stratum = new Stratum({ pool, autoMigrate: true });
  await stratum.initialize();

  // MongoDB adapter
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const mongo = new MongoSharedAdapter({
    client,
    databaseName: "app",
  });

  // Create a tenant (stored in PostgreSQL control plane)
  const tenant = await stratum.createTenant({
    name: "Acme Corp",
    slug: "acme_corp",
  });
  return { mongo, tenant };
}

export function guideCollectionPerTenant() {
  const mongo = new MongoCollectionAdapter({
    client,
    databaseName: "app",
    baseCollections: ["orders", "invoices"],
  });

  // The "orders_acme_corp" collection
  const orders = mongo.scopedCollection("acme_corp", "orders");
  return orders;
}

export async function guideDatabasePerTenant() {
  const mongo = new MongoDatabaseAdapter({
    createClient: async (uri) => {
      const tenantClient = new MongoClient(uri, { maxPoolSize: 5 }); // connections per tenant database
      await tenantClient.connect();
      return tenantClient;
    },
    baseUri: "mongodb://localhost:27017/app",
    maxClients: 100, // close the least recently used client above this count
  });

  const db = await mongo.getDatabase("acme_corp");
  try {
    await db.collection("orders").insertOne({ total: 10 });
  } finally {
    mongo.releaseDatabase("acme_corp");
  }
}

// ─── Guide: Mongoose Plugin ───

export function guideMongoosePlugin() {
  const orderSchema = new mongoose.Schema({
    product: String,
    quantity: Number,
    total: Number,
  });

  // Apply once per schema; injects tenant_id and auto-filters queries
  orderSchema.plugin(stratumPlugin);

  const Order = mongoose.model("Order", orderSchema);
  return Order;
}

export function guideAlsContext() {
  // Express example. jwtSecret is the key that verifies the bearer token.
  app.use(async (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing bearer token" });
      return;
    }

    let claims: string | jwt.JwtPayload;
    try {
      claims = jwt.verify(authorization.slice("Bearer ".length), jwtSecret, {
        algorithms: ["HS256"],
      });
    } catch {
      res.status(401).json({ error: "Invalid bearer token" });
      return;
    }

    const tenantId = typeof claims === "object" ? claims.tenant_id : undefined;
    if (typeof tenantId !== "string") {
      res.status(401).json({ error: "Token has no tenant_id claim" });
      return;
    }

    // Resolve tenant from your control plane
    const tenant = await stratum.getTenant(tenantId);
    const context: ResolvedTenantContext = {
      tenant_id: tenant.id,
      ancestry_path: tenant.ancestry_path,
      depth: tenant.depth,
      resolved_config: await stratum.resolveConfig(tenant.id),
      resolved_permissions: await stratum.resolvePermissions(tenant.id),
      isolation_strategy: tenant.isolation_strategy,
    };

    // Queries on plugin models inside next() see this tenant.
    runWithTenantContext(context, next);
  });
}

export async function guideScopedQuery() {
  // No manual where clause needed; the plugin adds tenant_id automatically
  const orders = await Order.find({ status: "pending" });
  return orders;
}

export async function guideWatchDeletes() {
  await mongoose.connection.db!.command({
    collMod: "orders",
    changeStreamPreAndPostImages: { enabled: true },
  });

  orderSchema.plugin(stratumPlugin, { watchDeletes: true });

  const stream = Order.watch();
  stream.on("change", (change) => {
    if (change.operationType === "delete") console.log(change.fullDocumentBeforeChange);
  });
  stream.on("error", (err) => console.error(err));
}

// ─── Guide: GDPR Compliance ───

export async function guidePurge() {
  // MongoSharedAdapter: pass the tenant ID
  const result = await mongo.purgeTenantData(tenant.id);

  if (!result.success) {
    // Log and retry or alert; partial purge means some data remains
    console.error("Purge incomplete:", result.errors);
    // result.collectionsProcessed counts the collections that succeeded
    // result.errors lists { collection, error } for each collection that failed
  }
}

// ─── Guide: Performance ───

export function guideIndexes() {
  // Add to your schema before plugin application
  orderSchema.index({ tenant_id: 1, created_at: -1 });
  orderSchema.index({ tenant_id: 1, status: 1 });
}

export function guidePoolTuning() {
  const mongo = new MongoDatabaseAdapter({
    createClient: async (uri) => {
      const tenantClient = new MongoClient(uri, {
        maxPoolSize: 5, // connections per tenant database
        minPoolSize: 1, // keep at least 1 connection warm
      });
      await tenantClient.connect();
      return tenantClient;
    },
    baseUri: "mongodb://localhost:27017/app",
    maxClients: 200,      // close the least recently used client above this count (default: 20)
    idleTimeoutMs: 30000, // close a client that no caller holds after 30 seconds unused (default: 60000)
  });
  return mongo;
}

// ─── README ───

export async function readmeWatchDeletes() {
  await connection.db!.command({
    collMod: "orders",
    changeStreamPreAndPostImages: { enabled: true },
  });
  // For a new collection:
  await connection.createCollection("orders", { changeStreamPreAndPostImages: { enabled: true } });

  orderSchema.plugin(stratumPlugin, { watchDeletes: true });

  const stream = Order.watch();
  stream.on("change", (change) => {
    if (change.operationType === "delete") console.log(change.fullDocumentBeforeChange);
  });
  stream.on("error", (err) => console.error(err));
}

export async function readmeDatabasePerTenant() {
  const db = await adapter.getDatabase("acme");
  try {
    await db.collection("orders").insertOne({ total: 10 });
  } finally {
    adapter.releaseDatabase("acme");
  }
}

// ─── Package page ───

export async function packagePageQuickStart() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  const adapter = new MongoSharedAdapter({
    client,
    databaseName: "myapp",
  });

  // Scoped collection auto-injects tenant_id into every query
  const orders = adapter.scopedCollection("acme", "orders");
  await orders.insertOne({ product: "Widget", quantity: 5 });
  const results = await orders.find({}).toArray(); // only acme's orders
  return results;
}
