import type { StackPreset } from "../matrix.js";

export function generatePresetReadme(projectName: string, preset: StackPreset): string {
  const dbStartCmd = getDbStartInfo(preset);
  const dbSetupNote = getDbSetupNote(preset);

  return `# ${projectName}

A multi-tenant application built with [Stratum](https://github.com/stratum-hq/Stratum).

**Stack:** ${preset.database} + ${preset.strategy} strategy + ${preset.orm} + ${preset.framework === "none" ? "no framework" : preset.framework}

## Getting started

### 1. Start the database

\`\`\`bash
docker compose up -d
\`\`\`
${dbStartCmd}

### 2. Configure environment

\`\`\`bash
cp .env.example .env
# Edit .env with your database credentials and Stratum API key
\`\`\`

### 3. Install dependencies

\`\`\`bash
npm install
\`\`\`
${dbSetupNote}

### 4. Run the app

\`\`\`bash
npm run dev
\`\`\`

## Multi-tenancy

This project uses Stratum for hierarchical multi-tenancy with the **${preset.strategy}** isolation strategy:

${getStrategyDescription(preset)}

See the [Stratum docs](https://github.com/stratum-hq/Stratum) for full reference.
`;
}

function getDbStartInfo(preset: StackPreset): string {
  switch (preset.database) {
    case "postgres":
      return "\nThis starts PostgreSQL 16 on port 5432.\n";
    case "mongodb":
      return "\nThis starts MongoDB 7 on port 27017.\n";
    case "mysql":
      return "\nThis starts MySQL 8 on port 3306.\n";
  }
}

function getDbSetupNote(preset: StackPreset): string {
  if (preset.database === "postgres" && (preset.strategy === "schema" || preset.strategy === "database")) {
    return getProvisioningNote(preset);
  }
  if (preset.database === "mysql") {
    return getMysqlProvisioningNote(preset);
  }
  if (preset.database === "mongodb") {
    return getMongoProvisioningNote(preset);
  }
  if (preset.orm === "prisma") {
    if (preset.database === "postgres") {
      return `
### 3b. Create the tables

\`\`\`bash
npx prisma generate
npm run db:push
\`\`\`

\`npm run db:push\` runs \`prisma db push\` as the superuser in \`DATABASE_SUPERUSER_URL\`, then applies \`prisma/rls.sql\`, the row-level security policy of each tenant-scoped table. The app role cannot create tables, and because it does not own them, their policies apply to it. Add a policy to \`prisma/rls.sql\` for every tenant-scoped model you add: a table without one is not filtered by tenant.
`;
    }
    return `
### 3b. Generate Prisma client

\`\`\`bash
npx prisma generate
npx prisma db push
\`\`\`
`;
  }
  if (preset.orm === "drizzle") {
    return `
### 3b. Create the tables

The tables are defined in \`src/schema.ts\`, which \`drizzle.config.ts\` points at.
drizzle-kit does not read \`.env\`, so load it first:

\`\`\`bash
node --env-file=.env node_modules/drizzle-kit/bin.cjs push
\`\`\`
${preset.database === "postgres" ? "\nOn PostgreSQL drizzle-kit connects with `DATABASE_SUPERUSER_URL`, the superuser kept for migrations. It creates each table with the `tenant_isolation` policy that `src/schema.ts` declares for it. The app role still reads and writes the new tables, and because it does not own them, their row-level security policies apply to it.\n" : ""}`;
  }
  if (preset.database === "postgres") {
    return `
\`init.sql\` creates an example tenant-scoped table, \`notes\`, with its row-level security policy. Create every tenant-scoped table the same way, as the superuser in \`DATABASE_SUPERUSER_URL\`: a table without a policy is not filtered by tenant.
`;
  }
  return "";
}

/** Setup steps of the PostgreSQL schema and database presets. */
function getProvisioningNote(preset: StackPreset): string {
  const schema = preset.strategy === "schema";
  const prisma = preset.orm === "prisma";
  const place = schema ? "schema, `tenant_{slug}`" : "database, `stratum_tenant_{slug}`";
  const where = schema ? "schema" : "database";
  const tables = prisma ? "pushes `prisma/schema.prisma` into it" : "runs `sql/tenant.sql` in it";
  const changes = prisma
    ? `After you change \`prisma/schema.prisma\`, push it to each tenant's ${where} as the superuser, with \`DATABASE_URL\` set to ${
        schema
          ? "`DATABASE_SUPERUSER_URL` plus `?schema=tenant_{slug}`"
          : "`DATABASE_SUPERUSER_URL` with the database name `stratum_tenant_{slug}`"
      }: \`npx prisma db push --skip-generate\`.`
    : `After you change \`sql/tenant.sql\`, apply the change to each tenant's ${where} as the superuser.`;
  const helper = prisma
    ? "`getTenantPrisma(tenantId)` in `src/stratum-prisma.ts` returns the Prisma client of the tenant's own " + where
    : "`tenantQuery(tenantId, sql, params)` and `withTenantTransaction(tenantId, fn)` in `src/stratum-db.ts` run queries in the tenant's own " + where;

  return `${prisma ? "\n### 3b. Generate the Prisma client\n\n```bash\nnpx prisma generate\n```\n" : ""}
### ${prisma ? "3c" : "3b"}. Provision each tenant

Each tenant's tables are in its own ${place}. Tenants share no table, so the tables need no tenant column and use no row-level security.

1. Create Stratum's tables and the tenant with Stratum. Stratum runs its migrations when you construct it with \`autoMigrate: true\` and call \`initialize()\` once; then create the tenant with \`stratum.createTenant({ name, slug })\`. \`src/stratum-tenant.ts\` shows the connection settings: Stratum uses its own login, \`STRATUM_ADMIN_DATABASE_URL\`.
2. Provision the tenant:

   \`\`\`bash
   npm run tenant:provision -- <tenant-id> [slug]
   \`\`\`

   The script runs as the superuser in \`DATABASE_SUPERUSER_URL\`, never as the app role. It creates the tenant's ${where}, ${tables}, gives the app role read and write access to the tables, and records the tenant in \`provisioned_tenants\`. The slug names the ${where} and defaults to the tenant's Stratum slug. If the script fails, it removes what it created, so you can run it again.

${changes}

In the app, ${helper}. Pass only the tenant ID from the verified token: the helper looks up the slug recorded for the tenant in \`provisioned_tenants\`, which the app role can only read, and refuses a tenant that is not provisioned. Never take the slug from the hostname or a request header, which any caller can choose.

The ${where} name is fixed when the tenant is provisioned: it does not follow a later change of the tenant's Stratum slug. The script refuses a slug that names a provisioned ${where}, also when another tenant now has that slug in Stratum: pass another slug for the new tenant.
`;
}

/** The README warning that a provisioned name keeps the slug of provisioning time. */
function slugReuseNote(where: "database" | "tables"): string {
  const names = where === "tables" ? "The table names are fixed" : `The ${where} name is fixed`;
  const keeps = where === "tables" ? "they keep the slug the tenant had then and do not" : "it keeps the slug the tenant had then and does not";
  return `${names} when the tenant is provisioned: ${keeps} follow a later slug change. Do not change a provisioned tenant's slug. Never give a tenant a slug that another tenant had, even after a rename or a deletion: the new tenant would reach the old tenant's ${where}.`;
}

/** Setup steps of the MySQL presets. */
function getMysqlProvisioningNote(preset: StackPreset): string {
  const database = preset.strategy === "database";
  const where = database ? "database" : "tables";
  const place = database
    ? "Each tenant's tables are in its own database, `stratum_tenant_{slug}`."
    : "Each tenant has its own copy of each table, `{table}_{slug}`, in the app's database.";
  const helper = database
    ? "`tenantQuery(tenantId, sql, params)` in `src/stratum-db.ts` runs a query in the tenant's own database"
    : "`tenantQuery(tenantId, (table) => sql, params)` in `src/stratum-db.ts` runs a query on the tenant's own tables: name each table with `table(\"notes\")`, never by its plain name";
  const tables = database
    ? "Add your tenant tables to `sql/tenant.sql`."
    : "Add your tenant tables to `sql/tenant.sql`, named `{table}_{slug}`, and add each `{table}` to `BASE_TABLES` in `src/stratum-db.ts`.";

  return `
### 3b. Provision each tenant

${place} Tenants share no table, so the tables need no tenant column. ${tables}

\`\`\`bash
npm run tenant:provision -- <tenant-id> <slug>
\`\`\`

\`<tenant-id>\` is the \`tenant_id\` claim of the tenant's tokens, and \`<slug>\` names the tenant's ${where}: a lowercase letter, then lowercase letters, digits or underscores. The script runs as the admin user in \`DATABASE_SUPERUSER_URL\`, never as the app user. It creates the tenant's ${where} from \`sql/tenant.sql\`, gives the app user read and write access to ${database ? "it" : "them"}, and records the slug in \`_stratum_tenants\`. If it fails, it removes what it created, so you can run it again. After you change \`sql/tenant.sql\`, apply the change to each tenant's ${where} as the admin user${database ? "" : ", and grant the app user read and write access to each table you add"}.

The app user in \`DATABASE_URL\` creates, alters and drops nothing, and only reads \`_stratum_tenants\`: \`init.sql\` removes the rights the MySQL image gives it on the app's database.

In the app, ${helper}. Pass only the tenant ID from the verified token: the helper looks up the tenant's slug in \`_stratum_tenants\`. Never take the slug from the hostname or a request header, which any caller can choose.

${slugReuseNote(where)}
`;
}

/** Setup steps of the MongoDB presets. */
function getMongoProvisioningNote(preset: StackPreset): string {
  const collection = preset.strategy === "collection";
  const where = collection ? "collections" : "database";
  const helper = collection
    ? "`getTenantModel(baseCollection, schema, tenantId)` in `src/stratum-mongoose.ts` returns the tenant's model for a collection"
    : "`getTenantConnection(tenantId)` in `src/stratum-mongoose.ts` returns a connection to the tenant's own database";
  return `
### 3b. Create the app user and provision each tenant

\`\`\`bash
npm run db:init
npm run tenant:provision -- <tenant-id> <slug>
\`\`\`

Both scripts run as the root user of \`docker-compose.yml\` in \`MONGODB_ADMIN_URI\`. \`npm run db:init\` runs once and creates the app user in \`MONGODB_URI\`, which the app connects as. The app user reads and writes ${collection ? "the tenants' collections" : "the tenant databases that provisioning grants it"}, only reads the routing records, and cannot drop or rename anything or manage users.

\`npm run tenant:provision\` runs once per tenant. \`<tenant-id>\` is the \`tenant_id\` claim of the tenant's tokens, and \`<slug>\` names the tenant's ${where}: a lowercase letter, then lowercase letters, digits or underscores. It records the slug in the \`tenants\` collection of the \`{database}_routing\` database${collection ? "" : " and gives the app user read and write access to the tenant's database"}. It refuses a tenant ID or slug that is already provisioned, and a slug whose ${where} already exist${collection ? "" : "s"}.

In the app, ${helper}. Pass only the tenant ID from the verified token: the helper looks up the tenant's slug in the routing records and refuses a tenant that is not provisioned. Never take the slug from the hostname or a request header such as \`x-tenant-slug\`, which any caller can choose.
`;
}

function getStrategyDescription(preset: StackPreset): string {
  switch (preset.strategy) {
    case "rls":
      return `- **Row-Level Security**: every tenant-scoped table has a \`tenant_id\` column and a row-level security policy that compares it with \`app.current_tenant_id\`
- The generated tenant helper sets \`app.current_tenant_id\` in each tenant transaction; a table without a policy is not filtered
- All tenants share one database and schema`;
    case "schema":
      return `- **Schema-per-tenant**: each tenant's tables are in its own PostgreSQL schema, \`tenant_{slug}\`, which \`npm run tenant:provision\` creates
- The generated helper (${preset.orm === "prisma" ? "`SchemaPrismaAdapter`" : "`SchemaRawAdapter`"} from \`@stratum-hq/db-adapters\`) sends each query to the schema of the tenant in the verified token
- Shared database, isolated schemas, no row-level security`;
    case "database":
      if (preset.database === "mongodb") {
        return `- **Database-per-tenant**: each tenant's data is in its own MongoDB database, \`stratum_tenant_{slug}\`, the name \`MongoDatabaseAdapter\` from \`@stratum-hq/mongodb\` uses
- The generated helper picks the database by the slug recorded for the tenant ID in the verified token
- The app connects to every tenant database as the same app user, so the helper's choice of database is what keeps tenants apart`;
      }
      if (preset.database === "mysql") {
        return `- **Database-per-tenant**: each tenant's tables are in its own MySQL database, \`stratum_tenant_{slug}\`, which \`npm run tenant:provision\` creates
- The generated helper (\`MysqlDatabaseAdapter\` from \`@stratum-hq/mysql\`) sends each query to the database of the tenant in the verified token
- The app connects to every tenant database as the same app user, so the helper's choice of database is what keeps tenants apart`;
      }
      return `- **Database-per-tenant**: each tenant's tables are in its own PostgreSQL database, \`stratum_tenant_{slug}\`, which \`npm run tenant:provision\` creates
- The generated helper (${preset.orm === "prisma" ? "`DatabasePrismaAdapter`" : "`DatabaseRawAdapter`"} from \`@stratum-hq/db-adapters\`) sends each query to the database of the tenant in the verified token
- The app connects to every tenant database as the same app role, so the helper's choice of database is what keeps tenants apart; no row-level security`;
    case "collection":
      return `- **Collection-per-tenant**: each tenant has its own copy of each collection, \`{collection}_{slug}\`, the name \`MongoCollectionAdapter\` from \`@stratum-hq/mongodb\` uses
- The generated helper names the collections by the slug recorded for the tenant ID in the verified token
- Shared database, one set of collections per tenant`;
    case "table-prefix":
      return `- **Table-per-tenant**: each tenant has its own copy of each table, \`{table}_{slug}\`, which \`npm run tenant:provision\` creates
- The generated helper (\`MysqlTableAdapter\` from \`@stratum-hq/mysql\`) names the tables of the tenant in the verified token
- Shared database, one set of tables per tenant`;
    default:
      return "";
  }
}
