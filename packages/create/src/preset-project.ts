import * as fs from "fs";
import * as path from "path";
import crypto from "node:crypto";
import { execSync } from "child_process";
import type { StackPreset } from "./matrix.js";
import { generatePresetDockerCompose } from "./generators/docker-compose.js";
import { generatePresetInitSql } from "./generators/init-sql.js";
import { generateDbSetup } from "./generators/db-setup.js";
import { generateMiddleware } from "./generators/middleware.js";
import { generatePresetPackageJson } from "./generators/package-json.js";
import { generatePresetReadme } from "./generators/readme.js";

function writeFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, "utf8");
  console.log(`  created  ${path.relative(process.cwd(), filePath)}`);
}

function generatePresetEnv(projectName: string, preset: StackPreset): string {
  const dbName = projectName.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  const jwtSecret = crypto.randomBytes(32).toString("base64url");

  let dbUrl: string;
  switch (preset.database) {
    case "postgres":
      dbUrl = `postgres://${dbName}:dev_password@localhost:5432/${dbName}`;
      break;
    case "mongodb":
      dbUrl = `mongodb://${dbName}:dev_password@localhost:27017/${dbName}?authSource=admin`;
      break;
    case "mysql":
      dbUrl = `mysql://${dbName}:dev_password@localhost:3306/${dbName}`;
      break;
  }

  const urlKey = preset.database === "mongodb" ? "MONGODB_URI" : "DATABASE_URL";

  return `# Environment variables for ${projectName}
# Copy to .env and fill in values

# Database
${urlKey}=${dbUrl}

# Authentication
JWT_SECRET=${jwtSecret}

# Stratum Control Plane
STRATUM_URL=http://localhost:3001
STRATUM_API_KEY=sk_test_your_key_here

NODE_ENV=development
`;
}

export function createPresetProject(
  projectName: string,
  preset: StackPreset,
  targetDir: string,
  skipInstall: boolean,
): void {
  const presetLabel = `${preset.database}/${preset.strategy}/${preset.orm}/${preset.framework}`;
  console.log(`\nCreating ${projectName} with preset ${presetLabel}...\n`);

  // package.json
  writeFile(
    path.join(targetDir, "package.json"),
    generatePresetPackageJson(projectName, preset),
  );

  // docker-compose.yml
  writeFile(
    path.join(targetDir, "docker-compose.yml"),
    generatePresetDockerCompose(projectName, preset),
  );

  // init.sql (if applicable)
  const initSql = generatePresetInitSql(projectName, preset);
  if (initSql !== null) {
    writeFile(path.join(targetDir, "init.sql"), initSql);
  }

  // .env.example
  writeFile(
    path.join(targetDir, ".env.example"),
    generatePresetEnv(projectName, preset),
  );

  // Database setup files (ORM config, tenant helpers)
  const dbFiles = generateDbSetup(preset);
  for (const file of dbFiles) {
    writeFile(path.join(targetDir, file.filename), file.content);
  }

  // Framework middleware / server entry point
  const middlewareFiles = generateMiddleware(projectName, preset);
  for (const file of middlewareFiles) {
    writeFile(path.join(targetDir, file.filename), file.content);
  }

  // README
  writeFile(
    path.join(targetDir, "README.md"),
    generatePresetReadme(projectName, preset),
  );

  // tsconfig.json
  writeFile(
    path.join(targetDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ESNext",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          outDir: "dist",
          rootDir: "src",
          declaration: true,
          skipLibCheck: true,
          esModuleInterop: true,
          ...(preset.framework === "nestjs"
            ? { experimentalDecorators: true, emitDecoratorMetadata: true }
            : {}),
          ...(preset.framework === "nextjs"
            ? { jsx: "preserve", plugins: [{ name: "next" }] }
            : {}),
        },
        include: ["src"],
        exclude: ["node_modules", "dist"],
      },
      null,
      2,
    ),
  );

  // npm install
  if (!skipInstall) {
    console.log("\nInstalling dependencies...\n");
    try {
      execSync("npm install", { cwd: targetDir, stdio: "inherit" });
    } catch {
      console.warn("\nWarning: npm install failed. Run it manually in the project directory.");
    }
  }
}
