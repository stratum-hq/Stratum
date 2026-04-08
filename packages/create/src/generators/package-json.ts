import type { StackPreset } from "../matrix.js";

export function generatePresetPackageJson(projectName: string, preset: StackPreset): string {
  const deps: Record<string, string> = {
    "@stratum-hq/lib": "^0.2.0",
  };
  const devDeps: Record<string, string> = {
    typescript: "^5.3.0",
    "@types/node": "^20.11.0",
  };

  // Database driver deps
  addDatabaseDeps(deps, preset);

  // ORM deps
  addOrmDeps(deps, devDeps, preset);

  // Framework deps
  addFrameworkDeps(deps, devDeps, preset);

  // Stratum adapter deps
  addStratumDeps(deps, preset);

  const scripts = getScripts(preset);

  return JSON.stringify(
    {
      name: projectName,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts,
      dependencies: sortKeys(deps),
      devDependencies: sortKeys(devDeps),
      engines: {
        node: ">=20.0.0",
      },
    },
    null,
    2,
  );
}

function addDatabaseDeps(deps: Record<string, string>, preset: StackPreset): void {
  switch (preset.database) {
    case "postgres":
      if (preset.orm !== "prisma" && preset.orm !== "drizzle" && preset.orm !== "sequelize") {
        deps["pg"] = "^8.11.0";
      }
      // prisma/drizzle/sequelize bring their own pg driver
      if (preset.orm === "drizzle") {
        deps["pg"] = "^8.11.0";
      }
      if (preset.orm === "pg") {
        deps["pg"] = "^8.11.0";
      }
      if (preset.orm === "knex") {
        deps["pg"] = "^8.11.0";
      }
      break;
    case "mongodb":
      // mongoose handles the driver
      break;
    case "mysql":
      if (preset.orm === "drizzle" || preset.orm === "pg") {
        deps["mysql2"] = "^3.9.0";
      }
      break;
  }
}

function addOrmDeps(deps: Record<string, string>, devDeps: Record<string, string>, preset: StackPreset): void {
  switch (preset.orm) {
    case "prisma":
      deps["@prisma/client"] = "^5.10.0";
      devDeps["prisma"] = "^5.10.0";
      if (preset.database === "postgres") {
        deps["pg"] = "^8.11.0";
      }
      break;
    case "drizzle":
      deps["drizzle-orm"] = "^0.30.0";
      devDeps["drizzle-kit"] = "^0.21.0";
      if (preset.database === "postgres") {
        deps["pg"] = "^8.11.0";
      }
      break;
    case "sequelize":
      deps["sequelize"] = "^6.37.0";
      if (preset.database === "mysql") {
        deps["mysql2"] = "^3.9.0";
      } else {
        deps["pg"] = "^8.11.0";
      }
      break;
    case "knex":
      deps["knex"] = "^3.1.0";
      break;
    case "mongoose":
      deps["mongoose"] = "^8.2.0";
      break;
    case "pg":
      // pg already handled in addDatabaseDeps
      break;
  }
}

function addFrameworkDeps(deps: Record<string, string>, devDeps: Record<string, string>, preset: StackPreset): void {
  switch (preset.framework) {
    case "express":
      deps["express"] = "^4.18.0";
      devDeps["@types/express"] = "^4.17.21";
      break;
    case "fastify":
      deps["fastify"] = "^4.26.0";
      break;
    case "nextjs":
      deps["next"] = "^14.1.0";
      deps["react"] = "^18.2.0";
      deps["react-dom"] = "^18.2.0";
      devDeps["@types/react"] = "^18.2.0";
      devDeps["@types/react-dom"] = "^18.2.0";
      break;
    case "hono":
      deps["hono"] = "^4.1.0";
      deps["@hono/node-server"] = "^1.8.0";
      break;
    case "nestjs":
      deps["@nestjs/core"] = "^10.3.0";
      deps["@nestjs/common"] = "^10.3.0";
      deps["@nestjs/platform-express"] = "^10.3.0";
      deps["reflect-metadata"] = "^0.2.0";
      deps["rxjs"] = "^7.8.0";
      break;
    case "none":
      break;
  }
}

function addStratumDeps(deps: Record<string, string>, preset: StackPreset): void {
  if (preset.database === "postgres" && preset.orm !== "mongoose") {
    deps["@stratum-hq/db-adapters"] = "^0.2.0";
  }
  if (preset.database === "mongodb") {
    deps["@stratum-hq/mongodb"] = "^0.2.0";
  }
  if (preset.database === "mysql") {
    deps["@stratum-hq/mysql"] = "^0.2.0";
  }
  if (preset.framework === "hono") {
    deps["@stratum-hq/hono"] = "^0.2.0";
  }
  if (preset.framework === "nestjs") {
    deps["@stratum-hq/nestjs"] = "^0.2.0";
  }
}

function getScripts(preset: StackPreset): Record<string, string> {
  if (preset.framework === "nextjs") {
    return { dev: "next dev", build: "next build", start: "next start" };
  }
  if (preset.framework === "nestjs") {
    return { dev: "node --watch src/main.ts", build: "tsc", start: "node dist/main.js" };
  }
  return { dev: "node --watch src/index.js", build: "tsc", start: "node dist/index.js" };
}

function sortKeys(obj: Record<string, string>): Record<string, string> {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}
