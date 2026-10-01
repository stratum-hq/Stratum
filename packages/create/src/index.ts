import * as fs from "fs";
import * as path from "path";
import crypto from "node:crypto";
import { execSync } from "child_process";
import { parsePresetString, isValidPreset, type StackPreset } from "./matrix.js";
import { createPresetProject } from "./preset-project.js";
import { STRATUM_RANGES } from "./stratum-versions.js";
import {
  postgresAppRole,
  postgresAppRoleSql,
  postgresStratumRole,
  POSTGRES_APP_PASSWORD,
  POSTGRES_STRATUM_PASSWORD,
} from "./generators/init-sql.js";
import { generateTsconfig } from "./generators/tsconfig.js";
import { generateGitignore } from "./generators/gitignore.js";
import {
  expressServer,
  fastifyServer,
  nextjsRootLayout,
  nextjsTenantProxy,
} from "./generators/middleware.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Template = "express" | "fastify" | "nextjs";

export interface ParsedArgs {
  projectName: string | null;
  template: Template;
  preset: string | null;
  skipInstall: boolean;
  force: boolean;
}

// ─── Arg parsing ─────────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): ParsedArgs {
  // argv is process.argv.slice(2)
  const args = [...argv];
  let projectName: string | null = null;
  let template: Template = "express";
  let preset: string | null = null;
  let skipInstall = false;
  let force = false;
  let templateExplicit = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--skip-install") {
      skipInstall = true;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--template") {
      const val = args[i + 1];
      if (val === "express" || val === "fastify" || val === "nextjs") {
        template = val;
        templateExplicit = true;
        i++;
      } else {
        console.error(`Unknown template: ${val}. Available: express, fastify, nextjs`);
        process.exit(1);
      }
    } else if (arg.startsWith("--template=")) {
      const val = arg.slice("--template=".length);
      if (val === "express" || val === "fastify" || val === "nextjs") {
        template = val;
        templateExplicit = true;
      } else {
        console.error(`Unknown template: ${val}. Available: express, fastify, nextjs`);
        process.exit(1);
      }
    } else if (arg === "--preset") {
      preset = args[i + 1] || null;
      i++;
    } else if (arg.startsWith("--preset=")) {
      preset = arg.slice("--preset=".length) || null;
    } else if (!arg.startsWith("--")) {
      projectName = arg;
    }
  }

  if (preset && templateExplicit) {
    console.error("Error: --template and --preset cannot be used together. Use one or the other.");
    process.exit(1);
  }

  return { projectName, template, preset, skipInstall, force };
}

// ─── Usage ────────────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log("Usage: create-stratum <project-name> [options]");
  console.log("");
  console.log("Options:");
  console.log("  --template <express|fastify|nextjs>  Framework template (default: express)");
  console.log("  --preset <db-strategy-orm-framework> Full stack preset (e.g. postgres-rls-prisma-express)");
  console.log("  --skip-install                       Skip npm install");
  console.log("  --force                              Overwrite existing directory");
  console.log("");
  console.log("Examples:");
  console.log("  npx @stratum-hq/create my-app");
  console.log("  npx @stratum-hq/create my-app --template fastify");
  console.log("  npx @stratum-hq/create my-app --preset postgres-rls-prisma-express");
  console.log("  npx @stratum-hq/create my-app --preset mongodb-database-mongoose-hono");
  console.log("  npx @stratum-hq/create my-app --preset mysql-table-prefix-pg-nestjs");
}

// ─── File generation helpers ──────────────────────────────────────────────────

function writeFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, "utf8");
  console.log(`  created  ${path.relative(process.cwd(), filePath)}`);
}

// ─── Template content ─────────────────────────────────────────────────────────

function generatePackageJson(projectName: string, template: Template): string {
  const frameworkDeps: Record<Template, Record<string, string>> = {
    express: {
      express: "^4.22.3",
      "@types/express": "^4.17.21",
    },
    fastify: {
      fastify: "^5.12.5",
    },
    nextjs: {
      // Every release before 16.3.0 bundles a postcss with published advisories.
      next: "^16.3.8",
      react: "^19.2.0",
      "react-dom": "^19.2.0",
      "@types/react": "^19.0.0",
      "@types/react-dom": "^19.0.0",
    },
  };

  const deps = {
    "@stratum-hq/lib": STRATUM_RANGES["@stratum-hq/lib"],
    pg: "^8.11.0",
    // Every template verifies the tenant JWT with jose.
    jose: "^6.2.12",
    ...frameworkDeps[template],
  };

  return JSON.stringify(
    {
      name: projectName,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts:
        template === "nextjs"
          ? { dev: "next dev", build: "next build", start: "next start" }
          : // Node 20 cannot run a .ts file, so dev runs the source through tsx.
            { dev: "tsx watch --env-file=.env src/index.ts", build: "tsc", start: "node dist/index.js" },
      dependencies: deps,
      devDependencies: {
        typescript: "^5.3.0",
        "@types/node": "^20.11.0",
        ...(template === "nextjs" ? {} : { tsx: "^4.19.3", "@types/pg": "^8.11.0" }),
      },
      engines: {
        // Next.js 16 needs Node.js 20.9 or later.
        node: template === "nextjs" ? ">=20.9.0" : ">=20.0.0",
      },
    },
    null,
    2,
  );
}

function generateDockerCompose(projectName: string): string {
  const dbName = projectName.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  return `# Docker Compose for ${projectName}
# Start with: docker compose up -d
version: "3.8"

services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${dbName}
      POSTGRES_USER: ${dbName}
      POSTGRES_PASSWORD: dev_password
    ports:
      - "5432:5432"
    volumes:
      - db_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${dbName}"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  db_data:
`;
}

function generateInitSql(projectName: string): string {
  const dbName = projectName.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  return `-- Initialize ${projectName} database
-- Enable required extensions for Stratum multi-tenancy
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "ltree";

-- The ltree extension enables hierarchical tenant trees
-- uuid-ossp provides uuid_generate_v4() for tenant IDs
COMMENT ON DATABASE ${dbName} IS 'Multi-tenant database for ${projectName}';
${postgresAppRoleSql(dbName)}`;
}

function generateEnv(projectName: string): string {
  const dbName = projectName.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  const jwtSecret = crypto.randomBytes(32).toString("base64url");
  return `# Environment variables for ${projectName}
# Copy to .env and fill in values

# Database. The app connects as the non-superuser role created in init.sql,
# so row-level security applies to it.
DATABASE_URL=postgres://${postgresAppRole(dbName)}:${POSTGRES_APP_PASSWORD}@localhost:5432/${dbName}

# Superuser: bootstrap and migrations only. It bypasses row-level security.
DATABASE_SUPERUSER_URL=postgres://${dbName}:dev_password@localhost:5432/${dbName}

# Stratum's own login: the library's adminPool, which runs the Stratum migrations (see init.sql).
STRATUM_ADMIN_DATABASE_URL=postgres://${postgresStratumRole(dbName)}:${POSTGRES_STRATUM_PASSWORD}@localhost:5432/${dbName}

# Authentication
JWT_SECRET=${jwtSecret}

# Stratum Control Plane
STRATUM_URL=http://localhost:3001
STRATUM_API_KEY=sk_test_your_key_here

NODE_ENV=development
`;
}

function generateNextjsPage(projectName: string): string {
  return `// app/page.tsx: ${projectName} root page
export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>${projectName}</h1>
      <p>Multi-tenant app powered by Stratum.</p>
      <ul>
        <li>Configure tenants via the Stratum control plane</li>
        <li>The tenant comes from a verified JWT in <code>src/proxy.ts</code></li>
        <li>Use <code>@stratum-hq/lib</code> for tenant resolution</li>
      </ul>
    </main>
  );
}
`;
}

function generateReadme(projectName: string, template: Template): string {
  return `# ${projectName}

A multi-tenant application built with [Stratum](https://github.com/stratum-hq/Stratum).

## Getting started

### 1. Start the database

\`\`\`bash
docker compose up -d
\`\`\`

### 2. Configure environment

\`\`\`bash
cp .env.example .env
# Edit .env: update DATABASE_URL, JWT_SECRET, and STRATUM_API_KEY
\`\`\`

### 3. Install dependencies

\`\`\`bash
npm install
\`\`\`

### 4. Run the app

\`\`\`bash
npm run dev
\`\`\`

## Project structure

\`\`\`
${projectName}/
├── src/              # Application source
├── docker-compose.yml
├── init.sql          # DB extensions (uuid-ossp, ltree)
├── .env.example
${template === "nextjs" ? "" : "├── tsconfig.json\n"}└── package.json
\`\`\`

## Multi-tenancy

This project uses Stratum for hierarchical multi-tenancy:

${
    template === "nextjs"
      ? "- **Tenant resolution**: from the `tenant_id` claim of a bearer token verified with `JWT_SECRET` (see `src/proxy.ts`); the subdomain is only a display slug"
      : "- **Tenant resolution**: the tenant middleware in `src/index.ts` takes the tenant from the `tenant_id` claim of a bearer token verified with `JWT_SECRET` (HS256, using `jose`). A token that does not verify is rejected with 401, and `GET /tenants` answers 401 without a tenant. The hostname and headers such as `x-tenant-id` are never used"
  }
- **Config inheritance**: settings flow down the tenant tree with override support
- **Permission ABAC**: role-based permissions with tenant-scoped enforcement

See the [Stratum docs](https://github.com/stratum-hq/Stratum) for full reference.
`;
}

// ─── Project scaffolding ──────────────────────────────────────────────────────

export function createProject(
  projectName: string,
  template: Template,
  targetDir: string,
  skipInstall: boolean,
): void {
  console.log(`\nCreating ${projectName} with ${template} template...\n`);

  // package.json
  writeFile(
    path.join(targetDir, "package.json"),
    generatePackageJson(projectName, template),
  );

  // docker-compose.yml
  writeFile(path.join(targetDir, "docker-compose.yml"), generateDockerCompose(projectName));

  // init.sql (DB extensions)
  writeFile(path.join(targetDir, "init.sql"), generateInitSql(projectName));

  // .env.example
  writeFile(path.join(targetDir, ".env.example"), generateEnv(projectName));

  // .gitignore: keeps the .env file that the README asks for out of git.
  writeFile(path.join(targetDir, ".gitignore"), generateGitignore(false));

  // Server starter file
  if (template === "express") {
    writeFile(path.join(targetDir, "src", "index.ts"), expressServer(projectName));
    writeFile(path.join(targetDir, "tsconfig.json"), generateTsconfig(template));
  } else if (template === "fastify") {
    writeFile(path.join(targetDir, "src", "index.ts"), fastifyServer(projectName));
    writeFile(path.join(targetDir, "tsconfig.json"), generateTsconfig(template));
  } else if (template === "nextjs") {
    writeFile(path.join(targetDir, "src", "app", "layout.tsx"), nextjsRootLayout(projectName));
    writeFile(path.join(targetDir, "src", "app", "page.tsx"), generateNextjsPage(projectName));
    writeFile(path.join(targetDir, "src", "proxy.ts"), nextjsTenantProxy());
  }

  // README
  writeFile(path.join(targetDir, "README.md"), generateReadme(projectName, template));

  // Run npm install
  if (!skipInstall) {
    console.log("\nInstalling dependencies...\n");
    try {
      execSync("npm install", { cwd: targetDir, stdio: "inherit" });
    } catch {
      console.warn("\nWarning: npm install failed. Run it manually in the project directory.");
    }
  }
}

// ─── Input validation ─────────────────────────────────────────────────────────

const VALID_PROJECT_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function validateProjectName(projectName: string): string | null {
  if (!projectName) {
    return "Project name must not be empty.";
  }
  if (!VALID_PROJECT_NAME.test(projectName)) {
    return `"${projectName}" is not a valid project name. Use only letters, numbers, dots, hyphens, and underscores. Must start with a letter or number.`;
  }
  const targetDir = path.resolve(process.cwd(), projectName);
  if (path.dirname(targetDir) !== process.cwd()) {
    return "Project name must not contain path separators.";
  }
  return null;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function main(argv: string[]): void {
  const { projectName, template, preset, skipInstall, force } = parseArgs(argv);

  if (!projectName) {
    printUsage();
    process.exit(1);
  }

  const validationError = validateProjectName(projectName);
  if (validationError) {
    console.error(`Error: ${validationError}`);
    process.exit(1);
  }

  // Check the preset before touching the file system, so an invalid preset
  // neither leaves an empty directory nor removes one under --force.
  let parsedPreset: StackPreset | null = null;
  if (preset) {
    parsedPreset = parsePresetString(preset);
    if (!parsedPreset) {
      console.error(`Error: Invalid preset string "${preset}".`);
      console.error("Format: {database}-{strategy}-{orm}-{framework}");
      console.error("Example: postgres-rls-prisma-express, mongodb-database-mongoose-hono");
      process.exit(1);
    }
    if (!isValidPreset(parsedPreset)) {
      console.error(`Error: Invalid preset combination "${preset}".`);
      console.error(`${parsedPreset.database} does not support ${parsedPreset.strategy}/${parsedPreset.orm} together.`);
      console.error("Run with --help to see valid combinations.");
      process.exit(1);
    }
  }

  const targetDir = path.resolve(process.cwd(), projectName);

  if (fs.existsSync(targetDir) && !force) {
    console.error(`Error: Directory "${projectName}" already exists.`);
    console.error(`Use --force to overwrite.`);
    process.exit(1);
  }

  if (fs.existsSync(targetDir) && force) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  fs.mkdirSync(targetDir, { recursive: true });

  // Preset path: full stack generation
  if (parsedPreset) {
    createPresetProject(projectName, parsedPreset, targetDir, skipInstall);
  } else {
    // Template path: existing behavior, untouched
    createProject(projectName, template, targetDir, skipInstall);
  }

  console.log(`\nSuccess! Created ${projectName} at ${targetDir}\n`);
  console.log("Next steps:\n");
  console.log(`  cd ${projectName}`);
  console.log("  docker compose up -d");
  console.log("  cp .env.example .env");
  if (skipInstall) {
    console.log("  npm install");
  }
  console.log("  npm run dev");
  console.log("");
}
