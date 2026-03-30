export interface ORMComparison {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  features: { capability: string; orm: string; stratum: string; verdict: "good" | "neutral" | "bad" }[];
  codeExample: {
    filename: string;
    code: string;
  };
  gotchas?: string[];
}

export const prisma: ORMComparison = {
  slug: "prisma",
  name: "Prisma",
  tagline: "Type-safe ORM with declarative schema",
  description: `Prisma is the most popular TypeScript ORM, known for its type-safe client and declarative schema language. Stratum works alongside Prisma — it does not replace it. Prisma handles your application's data modeling and queries. Stratum handles tenant hierarchy, config inheritance, isolation strategy, and compliance operations on the same PostgreSQL database.`,
  features: [
    { capability: "Schema management", orm: "Prisma Migrate (declarative)", stratum: "Stratum manages tenant tables only", verdict: "good" },
    { capability: "RLS isolation", orm: "Manual — raw SQL in migrations", stratum: "Automatic policy generation per tenant", verdict: "good" },
    { capability: "Schema-per-tenant", orm: "Multiple PrismaClient instances", stratum: "Single connection, search_path switching", verdict: "good" },
    { capability: "Tenant context in queries", orm: "Manual where: { tenantId } on every query", stratum: "Automatic via RLS or search_path", verdict: "good" },
    { capability: "Config inheritance", orm: "Not available", stratum: "Built-in, root-to-leaf resolution", verdict: "good" },
    { capability: "Audit logging", orm: "Prisma middleware (manual)", stratum: "Every mutation, actor-attributed", verdict: "good" },
    { capability: "GDPR export/purge", orm: "Build it yourself", stratum: "Built-in per-tenant operations", verdict: "good" },
    { capability: "Type safety", orm: "Full generated types", stratum: "TypeScript types + Zod schemas", verdict: "good" },
  ],
  codeExample: {
    filename: "prisma-with-stratum.ts",
    code: `<span class="kw">import</span> { PrismaClient } <span class="kw">from</span> <span class="str">"@prisma/client"</span>;
<span class="kw">import</span> { Stratum } <span class="kw">from</span> <span class="str">"@stratum-hq/lib"</span>;

<span class="cm">// Prisma handles your app schema</span>
<span class="kw">const</span> prisma = <span class="kw">new</span> <span class="fn">PrismaClient</span>();

<span class="cm">// Stratum handles tenancy on the same database</span>
<span class="kw">const</span> stratum = <span class="kw">new</span> <span class="fn">Stratum</span>({ pool, autoMigrate: <span class="num">true</span> });
<span class="kw">await</span> stratum.<span class="fn">initialize</span>();

<span class="cm">// Create tenant hierarchy</span>
<span class="kw">const</span> org = <span class="kw">await</span> stratum.<span class="fn">createTenant</span>({ name: <span class="str">"Acme"</span>, slug: <span class="str">"acme"</span> });

<span class="cm">// Use Prisma for app queries, Stratum for tenant ops</span>
<span class="kw">const</span> users = <span class="kw">await</span> prisma.user.<span class="fn">findMany</span>({
  where: { tenantId: org.id }
});`,
  },
  gotchas: [
    "Prisma Migrate and Stratum migrations are independent — run both during deployment.",
    "When using schema-per-tenant isolation, Prisma needs a separate client per schema or use $executeRaw to SET search_path.",
    "Prisma's connection pool and Stratum's pool are separate — configure both for your connection limit.",
  ],
};

export const drizzle: ORMComparison = {
  slug: "drizzle",
  name: "Drizzle",
  tagline: "Lightweight TypeScript ORM with SQL-like syntax",
  description: `Drizzle ORM is a lightweight, SQL-first TypeScript ORM. Its thin abstraction over SQL makes it a natural fit for Stratum's PostgreSQL-native features. Drizzle handles your schema and queries. Stratum handles tenant hierarchy, config, isolation, and compliance — both operating on the same database without conflicts.`,
  features: [
    { capability: "Schema management", orm: "Drizzle Kit (push/migrate)", stratum: "Stratum manages tenant tables only", verdict: "good" },
    { capability: "RLS isolation", orm: "Manual via sql`` template", stratum: "Automatic policy generation", verdict: "good" },
    { capability: "Schema-per-tenant", orm: "Schema parameter in table definitions", stratum: "Automatic search_path switching", verdict: "good" },
    { capability: "Raw SQL access", orm: "First-class — sql`` tagged templates", stratum: "Uses pg Pool directly", verdict: "good" },
    { capability: "Config inheritance", orm: "Not available", stratum: "Built-in, root-to-leaf resolution", verdict: "good" },
    { capability: "Audit logging", orm: "Build it yourself", stratum: "Every mutation, actor-attributed", verdict: "good" },
    { capability: "Connection overhead", orm: "Shares pg Pool", stratum: "Shares pg Pool", verdict: "good" },
    { capability: "Bundle size", orm: "Minimal (~30KB)", stratum: "Minimal — no heavy dependencies", verdict: "good" },
  ],
  codeExample: {
    filename: "drizzle-with-stratum.ts",
    code: `<span class="kw">import</span> { drizzle } <span class="kw">from</span> <span class="str">"drizzle-orm/node-postgres"</span>;
<span class="kw">import</span> { Pool } <span class="kw">from</span> <span class="str">"pg"</span>;
<span class="kw">import</span> { Stratum } <span class="kw">from</span> <span class="str">"@stratum-hq/lib"</span>;

<span class="cm">// Shared connection pool</span>
<span class="kw">const</span> pool = <span class="kw">new</span> <span class="fn">Pool</span>();

<span class="cm">// Drizzle for app queries</span>
<span class="kw">const</span> db = <span class="fn">drizzle</span>(pool);

<span class="cm">// Stratum for tenancy — same pool</span>
<span class="kw">const</span> stratum = <span class="kw">new</span> <span class="fn">Stratum</span>({ pool });
<span class="kw">await</span> stratum.<span class="fn">initialize</span>();

<span class="cm">// Both use the same PostgreSQL connection</span>
<span class="kw">const</span> tenant = <span class="kw">await</span> stratum.<span class="fn">createTenant</span>({
  name: <span class="str">"Acme"</span>, slug: <span class="str">"acme"</span>
});`,
  },
  gotchas: [
    "Drizzle and Stratum share a pg Pool — set pool max connections to account for both.",
    "Drizzle's schema-aware table definitions work well with Stratum's schema-per-tenant mode.",
  ],
};

export const sequelize: ORMComparison = {
  slug: "sequelize",
  name: "Sequelize",
  tagline: "Established Node.js ORM with Active Record pattern",
  description: `Sequelize is one of the oldest and most established Node.js ORMs, used in thousands of production applications. Stratum works alongside Sequelize — handling the multi-tenancy infrastructure that Sequelize does not provide. Sequelize manages your models and queries. Stratum manages tenant hierarchy, config, isolation, and compliance.`,
  features: [
    { capability: "Schema management", orm: "Sequelize CLI migrations", stratum: "Stratum manages tenant tables only", verdict: "good" },
    { capability: "RLS isolation", orm: "Manual — raw queries only", stratum: "Automatic policy generation", verdict: "good" },
    { capability: "Schema-per-tenant", orm: "Manual schema option per model", stratum: "Automatic search_path switching", verdict: "good" },
    { capability: "Default scopes", orm: "defaultScope for tenant filtering", stratum: "Database-level enforcement via RLS", verdict: "good" },
    { capability: "Config inheritance", orm: "Not available", stratum: "Built-in, root-to-leaf resolution", verdict: "good" },
    { capability: "Audit logging", orm: "Hooks (afterCreate, etc.)", stratum: "Every mutation, actor-attributed", verdict: "good" },
    { capability: "GDPR export/purge", orm: "Build it yourself", stratum: "Built-in per-tenant operations", verdict: "good" },
    { capability: "TypeScript support", orm: "Decorators or manual typing", stratum: "Native TypeScript + Zod", verdict: "good" },
  ],
  codeExample: {
    filename: "sequelize-with-stratum.ts",
    code: `<span class="kw">import</span> { Sequelize } <span class="kw">from</span> <span class="str">"sequelize"</span>;
<span class="kw">import</span> { Pool } <span class="kw">from</span> <span class="str">"pg"</span>;
<span class="kw">import</span> { Stratum } <span class="kw">from</span> <span class="str">"@stratum-hq/lib"</span>;

<span class="cm">// Sequelize for your app models</span>
<span class="kw">const</span> sequelize = <span class="kw">new</span> <span class="fn">Sequelize</span>(process.env.DATABASE_URL);

<span class="cm">// Stratum for tenancy</span>
<span class="kw">const</span> pool = <span class="kw">new</span> <span class="fn">Pool</span>();
<span class="kw">const</span> stratum = <span class="kw">new</span> <span class="fn">Stratum</span>({ pool });
<span class="kw">await</span> stratum.<span class="fn">initialize</span>();

<span class="cm">// Tenant hierarchy + config, independent of Sequelize</span>
<span class="kw">const</span> root = <span class="kw">await</span> stratum.<span class="fn">createTenant</span>({
  name: <span class="str">"Enterprise Co"</span>, slug: <span class="str">"enterprise"</span>
});
<span class="kw">await</span> stratum.<span class="fn">setConfig</span>(root.id, <span class="str">"max_seats"</span>, {
  value: <span class="num">500</span>, locked: <span class="num">true</span>
});`,
  },
  gotchas: [
    "Sequelize manages its own connection pool separate from Stratum's pg Pool.",
    "Sequelize's defaultScope tenant filtering is application-level only — Stratum's RLS enforces at the database level.",
    "When using schema-per-tenant, set Sequelize's schema option per model to match Stratum's tenant schema.",
  ],
};

export const knex: ORMComparison = {
  slug: "knex",
  name: "Knex",
  tagline: "SQL query builder for Node.js",
  description: `Knex is a SQL query builder — not a full ORM — giving you direct control over your queries while handling connection pooling, migrations, and schema building. Stratum pairs naturally with Knex because both operate close to PostgreSQL. Knex builds your queries. Stratum manages tenant hierarchy, config, isolation, and compliance.`,
  features: [
    { capability: "Schema management", orm: "Knex migrations (imperative)", stratum: "Stratum manages tenant tables only", verdict: "good" },
    { capability: "RLS isolation", orm: "Manual via knex.raw()", stratum: "Automatic policy generation", verdict: "good" },
    { capability: "Schema-per-tenant", orm: "knex.withSchema() per query", stratum: "Automatic search_path switching", verdict: "good" },
    { capability: "Raw SQL access", orm: "knex.raw() — first-class", stratum: "Uses pg Pool directly", verdict: "good" },
    { capability: "Config inheritance", orm: "Not available", stratum: "Built-in, root-to-leaf resolution", verdict: "good" },
    { capability: "Transaction support", orm: "knex.transaction()", stratum: "Tenant-scoped transactions", verdict: "good" },
    { capability: "GDPR export/purge", orm: "Build it yourself", stratum: "Built-in per-tenant operations", verdict: "good" },
    { capability: "Connection pooling", orm: "Tarn.js (built-in)", stratum: "pg Pool", verdict: "neutral" },
  ],
  codeExample: {
    filename: "knex-with-stratum.ts",
    code: `<span class="kw">import</span> Knex <span class="kw">from</span> <span class="str">"knex"</span>;
<span class="kw">import</span> { Pool } <span class="kw">from</span> <span class="str">"pg"</span>;
<span class="kw">import</span> { Stratum } <span class="kw">from</span> <span class="str">"@stratum-hq/lib"</span>;

<span class="cm">// Knex for query building</span>
<span class="kw">const</span> knex = <span class="fn">Knex</span>({
  client: <span class="str">"pg"</span>,
  connection: process.env.DATABASE_URL,
});

<span class="cm">// Stratum for tenancy</span>
<span class="kw">const</span> pool = <span class="kw">new</span> <span class="fn">Pool</span>();
<span class="kw">const</span> stratum = <span class="kw">new</span> <span class="fn">Stratum</span>({ pool });
<span class="kw">await</span> stratum.<span class="fn">initialize</span>();

<span class="cm">// Use Knex for app queries</span>
<span class="kw">const</span> rows = <span class="kw">await</span> knex(<span class="str">"users"</span>)
  .<span class="fn">withSchema</span>(<span class="str">"tenant_acme"</span>)
  .<span class="fn">select</span>(<span class="str">"*"</span>);`,
  },
  gotchas: [
    "Knex and Stratum use separate connection pools — budget your PostgreSQL max_connections accordingly.",
    "Knex's withSchema() works well with Stratum's schema-per-tenant mode.",
    "Run Knex migrations and Stratum initialization in sequence during deployment.",
  ],
};

export const mongodb: ORMComparison = {
  slug: "mongodb",
  name: "MongoDB",
  tagline: "Document database with flexible schema",
  description: `MongoDB is the most widely used document database in Node.js applications. @stratum-hq/mongodb is the only Node.js multi-tenancy library that supports both PostgreSQL and MongoDB -- giving teams running Mongoose or the native driver first-class tenant isolation. The control plane (tenant hierarchy, config inheritance, audit log) remains in PostgreSQL via @stratum-hq/lib. MongoDB carries your application documents, scoped per tenant through a Mongoose plugin or adapter.`,
  features: [
    { capability: "Isolation strategies", orm: "Manual where: { tenantId } on every query", stratum: "3 strategies: shared collection, collection-per-tenant, database-per-tenant", verdict: "good" },
    { capability: "Tenant scoping", orm: "Application-level only — no RLS equivalent", stratum: "Mongoose plugin auto-scopes all queries", verdict: "good" },
    { capability: "Config inheritance", orm: "Not available", stratum: "Built-in via PostgreSQL control plane", verdict: "good" },
    { capability: "GDPR purge", orm: "Build it yourself", stratum: "purgeTenantData() for all 3 strategies", verdict: "good" },
    { capability: "Audit logging", orm: "Manual hooks", stratum: "Every mutation, actor-attributed (via PG control plane)", verdict: "good" },
    { capability: "Security enforcement", orm: "Application-level (no DB-level RLS)", stratum: "Application-level for shared/collection; DB-level for database-per-tenant", verdict: "neutral" },
    { capability: "Control plane", orm: "None", stratum: "PostgreSQL via @stratum-hq/lib (tenant hierarchy, config, audit)", verdict: "good" },
    { capability: "Mongoose support", orm: "Native", stratum: "Plugin for automatic tenant scoping", verdict: "good" },
  ],
  codeExample: {
    filename: "mongodb-with-stratum.ts",
    code: `<span class="kw">import</span> mongoose <span class="kw">from</span> <span class="str">"mongoose"</span>;
<span class="kw">import</span> { Stratum } <span class="kw">from</span> <span class="str">"@stratum-hq/lib"</span>;
<span class="kw">import</span> { StratumMongoose } <span class="kw">from</span> <span class="str">"@stratum-hq/mongodb"</span>;

<span class="cm">// Control plane: tenant hierarchy lives in PostgreSQL</span>
<span class="kw">const</span> stratum = <span class="kw">new</span> <span class="fn">Stratum</span>({ pool });
<span class="kw">await</span> stratum.<span class="fn">initialize</span>();

<span class="cm">// MongoDB adapter for document isolation</span>
<span class="kw">const</span> mongo = <span class="kw">new</span> <span class="fn">StratumMongoose</span>({
  uri: process.env.MONGODB_URI,
  strategy: <span class="str">"SHARED_COLLECTION"</span>,
});
<span class="kw">await</span> mongo.<span class="fn">connect</span>();

<span class="cm">// Tenant created in PG control plane</span>
<span class="kw">const</span> tenant = <span class="kw">await</span> stratum.<span class="fn">createTenant</span>({
  name: <span class="str">"Acme"</span>, slug: <span class="str">"acme"</span>
});

<span class="cm">// Mongoose plugin auto-scopes queries to the current tenant</span>
<span class="kw">const</span> Order = mongo.<span class="fn">model</span>(<span class="str">"Order"</span>, orderSchema);
<span class="kw">const</span> orders = <span class="kw">await</span> Order.<span class="fn">find</span>(); <span class="cm">// filtered to current tenant via ALS</span>`,
  },
  gotchas: [
    "MongoDB has no Row-Level Security equivalent -- isolation is enforced at the application layer. Use database-per-tenant for sensitive data requiring physical separation.",
    "The control plane (tenant hierarchy, config, audit log) always requires PostgreSQL via @stratum-hq/lib. MongoDB carries application documents only.",
    "For shared-collection strategy, add a compound index on { tenant_id, ...queryFields } to prevent full-collection scans.",
    "Database-per-tenant requires a connection pool per tenant -- configure pool limits to avoid exhausting MongoDB connections.",
  ],
};

export const allORMs: ORMComparison[] = [prisma, drizzle, sequelize, knex, mongodb];
