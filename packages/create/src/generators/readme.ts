import type { StackPreset } from "../matrix.js";

export function generatePresetReadme(projectName: string, preset: StackPreset): string {
  const devCmd = getDevCommand(preset);
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
${devCmd}
\`\`\`

## Multi-tenancy

This project uses Stratum for hierarchical multi-tenancy with the **${preset.strategy}** isolation strategy:

${getStrategyDescription(preset.strategy)}

See the [Stratum docs](https://github.com/stratum-hq/Stratum) for full reference.
`;
}

function getDevCommand(preset: StackPreset): string {
  if (preset.framework === "nextjs") return "npm run dev";
  if (preset.framework === "nestjs") return "node --env-file=.env src/main.ts";
  if (preset.framework === "none") return "node --env-file=.env src/index.ts";
  return "node --env-file=.env src/index.ts";
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
  if (preset.orm === "prisma") {
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
### 3b. Run Drizzle migrations

\`\`\`bash
npx drizzle-kit push
\`\`\`
`;
  }
  return "";
}

function getStrategyDescription(strategy: string): string {
  switch (strategy) {
    case "rls":
      return `- **Row-Level Security** -- PostgreSQL RLS policies filter rows by tenant automatically
- Each query sets \`app.current_tenant\` and RLS enforces isolation
- All tenants share one database and schema`;
    case "schema":
      return `- **Schema-per-tenant** -- each tenant gets a dedicated PostgreSQL schema
- Queries are routed to the correct schema via search_path
- Shared database, isolated schemas`;
    case "database":
      return `- **Database-per-tenant** -- each tenant gets a fully isolated database
- Connection routing directs queries to the correct database
- Maximum isolation at the cost of more resource usage`;
    case "collection":
      return `- **Collection-per-tenant** -- each tenant gets dedicated MongoDB collections
- Collection names are prefixed or namespaced by tenant ID
- Shared database, isolated collections`;
    case "table-prefix":
      return `- **Table-prefix** -- tenant-specific tables with a naming prefix
- Tables are prefixed with the tenant identifier
- Shared database, prefixed table names`;
    default:
      return "";
  }
}
