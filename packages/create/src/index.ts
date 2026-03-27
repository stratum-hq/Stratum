#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Template = "express" | "fastify" | "nextjs";

export interface ParsedArgs {
  projectName: string | null;
  template: Template;
  skipInstall: boolean;
  force: boolean;
}

// ─── Arg parsing ─────────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): ParsedArgs {
  // argv is process.argv.slice(2)
  const args = [...argv];
  let projectName: string | null = null;
  let template: Template = "express";
  let skipInstall = false;
  let force = false;

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
        i++;
      } else {
        console.error(`Unknown template: ${val}. Available: express, fastify, nextjs`);
        process.exit(1);
      }
    } else if (arg.startsWith("--template=")) {
      const val = arg.slice("--template=".length);
      if (val === "express" || val === "fastify" || val === "nextjs") {
        template = val;
      } else {
        console.error(`Unknown template: ${val}. Available: express, fastify, nextjs`);
        process.exit(1);
      }
    } else if (!arg.startsWith("--")) {
      projectName = arg;
    }
  }

  return { projectName, template, skipInstall, force };
}

// ─── Usage ────────────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log("Usage: create-stratum <project-name> [options]");
  console.log("");
  console.log("Options:");
  console.log("  --template <express|fastify|nextjs>  Framework template (default: express)");
  console.log("  --skip-install                       Skip npm install");
  console.log("  --force                              Overwrite existing directory");
  console.log("");
  console.log("Examples:");
  console.log("  npx @stratum-hq/create my-app");
  console.log("  npx @stratum-hq/create my-app --template fastify");
  console.log("  npx @stratum-hq/create my-app --template nextjs --skip-install");
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
      express: "^4.18.0",
      "@types/express": "^4.17.21",
    },
    fastify: {
      fastify: "^4.26.0",
    },
    nextjs: {
      next: "^14.1.0",
      react: "^18.2.0",
      "react-dom": "^18.2.0",
      "@types/react": "^18.2.0",
      "@types/react-dom": "^18.2.0",
    },
  };

  const deps = {
    "@stratum-hq/lib": "^0.2.0",
    pg: "^8.11.0",
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
          : { dev: "node --watch src/index.js", build: "tsc", start: "node dist/index.js" },
      dependencies: deps,
      devDependencies: {
        typescript: "^5.3.0",
        "@types/node": "^20.11.0",
      },
      engines: {
        node: ">=20.0.0",
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
`;
}

function generateEnv(projectName: string): string {
  const dbName = projectName.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  return `# Environment variables for ${projectName}
# Copy to .env and fill in values

# Database
DATABASE_URL=postgres://${dbName}:dev_password@localhost:5432/${dbName}

# Authentication
JWT_SECRET=change-me-in-production

# Stratum Control Plane
STRATUM_URL=http://localhost:3001
STRATUM_API_KEY=sk_test_your_key_here

NODE_ENV=development
`;
}

function generateExpressServer(projectName: string): string {
  return `import express from "express";
import { Pool } from "pg";

const app = express();
const port = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", project: "${projectName}" });
});

app.get("/tenants", async (_req, res) => {
  try {
    // Example: query your tenant table
    // const { rows } = await pool.query("SELECT * FROM tenants LIMIT 20");
    // res.json(rows);
    res.json({ message: "Replace this with your tenant queries", pool: !!pool });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.listen(port, () => {
  console.log(\`${projectName} server running on http://localhost:\${port}\`);
});
`;
}

function generateFastifyServer(projectName: string): string {
  return `import Fastify from "fastify";
import { Pool } from "pg";

const fastify = Fastify({ logger: true });
const port = Number(process.env.PORT) || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

fastify.get("/health", async () => {
  return { status: "ok", project: "${projectName}" };
});

fastify.get("/tenants", async (_request, reply) => {
  try {
    // Example: query your tenant table
    // const { rows } = await pool.query("SELECT * FROM tenants LIMIT 20");
    // return rows;
    return { message: "Replace this with your tenant queries", pool: !!pool };
  } catch (err) {
    return reply.status(500).send({ error: String(err) });
  }
});

fastify.listen({ port, host: "0.0.0.0" }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
});
`;
}

function generateNextjsPage(projectName: string): string {
  return `// app/page.tsx — ${projectName} root page
export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>${projectName}</h1>
      <p>Multi-tenant app powered by Stratum.</p>
      <ul>
        <li>Configure tenants via the Stratum control plane</li>
        <li>Access tenant context via <code>x-tenant-id</code> header</li>
        <li>Use <code>@stratum-hq/lib</code> for tenant resolution</li>
      </ul>
    </main>
  );
}
`;
}

function generateNextjsMiddleware(): string {
  return `// middleware.ts — tenant resolution via subdomain or header
import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") || "";
  const subdomain = hostname.split(".")[0];
  const headerTenantId = request.headers.get("x-tenant-id");
  const pathTenantId = request.nextUrl.pathname.match(/^\\/tenant\\/([^/]+)/)?.[1];

  const tenantId = headerTenantId || pathTenantId || subdomain;

  const requestHeaders = new Headers(request.headers);
  if (tenantId && tenantId !== "localhost" && tenantId !== "www") {
    requestHeaders.set("x-tenant-id", tenantId);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
`;
}

function generateReadme(projectName: string, template: Template): string {
  const devCmd =
    template === "nextjs" ? "npm run dev" : "node --env-file=.env src/index.ts";

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
# Edit .env — update DATABASE_URL, JWT_SECRET, and STRATUM_API_KEY
\`\`\`

### 3. Install dependencies

\`\`\`bash
npm install
\`\`\`

### 4. Run the app

\`\`\`bash
${devCmd}
\`\`\`

## Project structure

\`\`\`
${projectName}/
├── src/              # Application source
├── docker-compose.yml
├── init.sql          # DB extensions (uuid-ossp, ltree)
├── .env.example
└── package.json
\`\`\`

## Multi-tenancy

This project uses Stratum for hierarchical multi-tenancy:

- **Tenant resolution** — via JWT claim, subdomain, or \`x-tenant-id\` header
- **Config inheritance** — settings flow down the tenant tree with override support
- **Permission ABAC** — role-based permissions with tenant-scoped enforcement

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

  // Server starter file
  if (template === "express") {
    writeFile(path.join(targetDir, "src", "index.ts"), generateExpressServer(projectName));
  } else if (template === "fastify") {
    writeFile(path.join(targetDir, "src", "index.ts"), generateFastifyServer(projectName));
  } else if (template === "nextjs") {
    writeFile(path.join(targetDir, "src", "app", "page.tsx"), generateNextjsPage(projectName));
    writeFile(path.join(targetDir, "middleware.ts"), generateNextjsMiddleware());
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
  const { projectName, template, skipInstall, force } = parseArgs(argv);

  if (!projectName) {
    printUsage();
    process.exit(1);
  }

  const validationError = validateProjectName(projectName);
  if (validationError) {
    console.error(`Error: ${validationError}`);
    process.exit(1);
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

  createProject(projectName, template, targetDir, skipInstall);

  console.log(`\nSuccess! Created ${projectName} at ${targetDir}\n`);
  console.log("Next steps:\n");
  console.log(`  cd ${projectName}`);
  console.log("  docker compose up -d");
  console.log("  cp .env.example .env");
  if (skipInstall) {
    console.log("  npm install");
  }
  if (template === "nextjs") {
    console.log("  npm run dev");
  } else {
    console.log("  node --env-file=.env src/index.ts");
  }
  console.log("");
}

// Run when executed directly (not when imported by tests)
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main(process.argv.slice(2));
}
