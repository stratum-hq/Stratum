import type { StackPreset } from "../matrix.js";
import { rootSources } from "./tsconfig.js";
import { STRATUM_RANGES } from "../stratum-versions.js";

/**
 * drizzle-kit 0.31 still depends on the deprecated @esbuild-kit/esm-loader,
 * whose @esbuild-kit/core-utils pins esbuild ~0.18, which has a published
 * advisory (GHSA-67mh-4wv8-2f99). drizzle-kit itself uses esbuild ^0.25, so
 * the override moves the nested copy to that line too.
 */
const DRIZZLE_KIT_OVERRIDES = {
  "@esbuild-kit/core-utils": { esbuild: "^0.25.4" },
};

export function generatePresetPackageJson(projectName: string, preset: StackPreset): string {
  const deps: Record<string, string> = {
    "@stratum-hq/lib": STRATUM_RANGES["@stratum-hq/lib"],
  };
  const devDeps: Record<string, string> = {
    typescript: "^5.3.0",
    "@types/node": "^20.11.0",
  };
  // NestJS injection needs the decorator metadata that tsc emits and tsx does not.
  if (preset.framework === "nestjs") {
    devDeps["tsc-watch"] = "^7.2.0";
  } else if (preset.framework !== "nextjs") {
    devDeps["tsx"] = "^4.19.3";
  }

  // Database driver deps
  addDatabaseDeps(deps, devDeps, preset);

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
      ...(preset.orm === "drizzle" ? { overrides: DRIZZLE_KIT_OVERRIDES } : {}),
      engines: {
        // Next.js 16 needs Node.js 20.9 or later.
        node: preset.framework === "nextjs" ? ">=20.9.0" : ">=20.0.0",
      },
    },
    null,
    2,
  );
}

function addDatabaseDeps(deps: Record<string, string>, devDeps: Record<string, string>, preset: StackPreset): void {
  switch (preset.database) {
    case "postgres":
      // The generated code for these ORMs imports pg itself. The strict tsc
      // build fails with TS7016 when the pg types are not installed.
      if (preset.orm === "pg" || preset.orm === "prisma" || preset.orm === "drizzle") {
        devDeps["@types/pg"] = "^8.11.0";
      }
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
        deps["mysql2"] = "^3.23.1";
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
      deps["drizzle-orm"] = "^0.45.3";
      devDeps["drizzle-kit"] = "^0.31.11";
      if (preset.database === "postgres") {
        deps["pg"] = "^8.11.0";
      }
      break;
    case "sequelize":
      deps["sequelize"] = "^6.37.0";
      if (preset.database === "mysql") {
        deps["mysql2"] = "^3.23.1";
      } else {
        deps["pg"] = "^8.11.0";
      }
      break;
    case "knex":
      deps["knex"] = "^3.1.0";
      break;
    case "mongoose":
      deps["mongoose"] = "^8.24.1";
      break;
    case "pg":
      // pg already handled in addDatabaseDeps
      break;
  }
}

function addFrameworkDeps(deps: Record<string, string>, devDeps: Record<string, string>, preset: StackPreset): void {
  // The generated tenant resolution verifies the tenant JWT with jose.
  if (preset.framework !== "none") {
    deps["jose"] = "^6.2.12";
  }
  switch (preset.framework) {
    case "express":
      deps["express"] = "^4.22.3";
      devDeps["@types/express"] = "^4.17.21";
      break;
    case "fastify":
      deps["fastify"] = "^5.12.5";
      break;
    case "nextjs":
      // Every release before 16.3.0 bundles a postcss with published advisories.
      deps["next"] = "^16.3.8";
      deps["react"] = "^19.2.0";
      deps["react-dom"] = "^19.2.0";
      devDeps["@types/react"] = "^19.0.0";
      devDeps["@types/react-dom"] = "^19.0.0";
      break;
    case "hono":
      deps["hono"] = "^4.13.7";
      deps["@hono/node-server"] = "^1.19.15";
      break;
    case "nestjs":
      deps["@nestjs/core"] = "^11.1.18";
      deps["@nestjs/common"] = "^11.1.18";
      deps["@nestjs/platform-express"] = "^11.1.18";
      deps["reflect-metadata"] = "^0.2.0";
      deps["rxjs"] = "^7.8.0";
      break;
    case "none":
      break;
  }
}

function addStratumDeps(deps: Record<string, string>, preset: StackPreset): void {
  if (preset.database === "postgres" && preset.orm !== "mongoose") {
    deps["@stratum-hq/db-adapters"] = STRATUM_RANGES["@stratum-hq/db-adapters"];
  }
  if (preset.database === "mongodb") {
    deps["@stratum-hq/mongodb"] = STRATUM_RANGES["@stratum-hq/mongodb"];
  }
  if (preset.database === "mysql") {
    deps["@stratum-hq/mysql"] = STRATUM_RANGES["@stratum-hq/mysql"];
  }
  if (preset.framework === "hono") {
    deps["@stratum-hq/hono"] = STRATUM_RANGES["@stratum-hq/hono"];
  }
  if (preset.framework === "nestjs") {
    deps["@stratum-hq/nestjs"] = STRATUM_RANGES["@stratum-hq/nestjs"];
  }
}

function getScripts(preset: StackPreset): Record<string, string> {
  return { ...getAppScripts(preset), ...getDatabaseScripts(preset) };
}

/**
 * Scripts that set up the database. They run with the superuser in
 * DATABASE_SUPERUSER_URL, never as the app role.
 */
function getDatabaseScripts(preset: StackPreset): Record<string, string> {
  if (preset.database !== "postgres") return {};
  if (preset.strategy === "schema" || preset.strategy === "database") {
    return { "tenant:provision": "node --env-file=.env scripts/provision-tenant.mjs" };
  }
  if (preset.orm === "prisma") {
    return { "db:push": "node --env-file=.env scripts/db-push.mjs" };
  }
  return {};
}

function getAppScripts(preset: StackPreset): Record<string, string> {
  if (preset.framework === "nextjs") {
    return { dev: "next dev", build: "next build", start: "next start" };
  }
  const entry = preset.framework === "nestjs" ? "main" : "index";
  // When tsc compiles from the project root, src/ is emitted to dist/src/.
  const emittedDir = rootSources(preset).length > 0 ? "dist/src" : "dist";
  // Node 20 cannot run a .ts file. NestJS compiles with tsc, which keeps the
  // decorator metadata its injection needs; the other frameworks run through tsx.
  const dev =
    preset.framework === "nestjs"
      ? `tsc-watch --onSuccess "node --env-file=.env ${emittedDir}/${entry}.js"`
      : `tsx watch --env-file=.env src/${entry}.ts`;
  return { dev, build: "tsc", start: `node ${emittedDir}/${entry}.js` };
}

function sortKeys(obj: Record<string, string>): Record<string, string> {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}
