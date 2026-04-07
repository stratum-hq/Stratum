// ─── Stack Combination Matrix ────────────────────────────────────────────────
// Single source of truth for valid Stratum stack combinations.
// Imported by create CLI, interactive wizard, and web docs.

export type Database = "postgres" | "mongodb" | "mysql";
export type Strategy = "rls" | "schema" | "database" | "collection" | "table-prefix";
export type Orm = "prisma" | "drizzle" | "sequelize" | "knex" | "mongoose" | "pg";
export type Framework = "express" | "fastify" | "nextjs" | "hono" | "nestjs" | "none";

export interface StackPreset {
  database: Database;
  strategy: Strategy;
  orm: Orm;
  framework: Framework;
}

// ─── Valid combinations by database ──────────────────────────────────────────

const POSTGRES_STRATEGIES: Strategy[] = ["rls", "schema", "database"];
const POSTGRES_ORMS: Orm[] = ["prisma", "drizzle", "sequelize", "knex", "pg"];

const MONGODB_STRATEGIES: Strategy[] = ["database", "collection"];
const MONGODB_ORMS: Orm[] = ["mongoose"];

const MYSQL_STRATEGIES: Strategy[] = ["database", "table-prefix"];
const MYSQL_ORMS: Orm[] = ["sequelize", "knex", "pg"];

const ALL_FRAMEWORKS: Framework[] = ["express", "fastify", "nextjs", "hono", "nestjs", "none"];

export interface DatabaseConfig {
  strategies: Strategy[];
  orms: Orm[];
  frameworks: Framework[];
}

export const VALID_COMBINATIONS: Record<Database, DatabaseConfig> = {
  postgres: {
    strategies: POSTGRES_STRATEGIES,
    orms: POSTGRES_ORMS,
    frameworks: ALL_FRAMEWORKS,
  },
  mongodb: {
    strategies: MONGODB_STRATEGIES,
    orms: MONGODB_ORMS,
    frameworks: ALL_FRAMEWORKS,
  },
  mysql: {
    strategies: MYSQL_STRATEGIES,
    orms: MYSQL_ORMS,
    frameworks: ALL_FRAMEWORKS,
  },
};

// ─── All valid values (for parsing) ─────────────────────────────────────────

const ALL_DATABASES: Database[] = ["postgres", "mongodb", "mysql"];
const ALL_STRATEGIES: Strategy[] = ["rls", "schema", "database", "collection", "table-prefix"];
const ALL_ORMS: Orm[] = ["prisma", "drizzle", "sequelize", "knex", "mongoose", "pg"];

// ─── Validation ──────────────────────────────────────────────────────────────

export function isValidPreset(preset: StackPreset): boolean {
  const config = VALID_COMBINATIONS[preset.database];
  if (!config) return false;
  if (!config.strategies.includes(preset.strategy)) return false;
  if (!config.orms.includes(preset.orm)) return false;
  if (!config.frameworks.includes(preset.framework)) return false;
  return true;
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

export function parsePresetString(s: string): StackPreset | null {
  if (!s || typeof s !== "string") return null;

  const parts = s.toLowerCase().split("-");

  // Handle "table-prefix" which contains a hyphen -- it will split into
  // 5 parts: [db, strategy1, "table", "prefix", orm, framework] or similar.
  // We need to reconstruct multi-word tokens.
  // Format: {database}-{strategy}-{orm}-{framework}
  // Strategy "table-prefix" is the only multi-word token.

  let database: string;
  let strategy: string;
  let orm: string;
  let framework: string;

  if (parts.length === 4) {
    // Simple case: no hyphenated strategy
    [database, strategy, orm, framework] = parts;
  } else if (parts.length === 5) {
    // "table-prefix" case: mysql-table-prefix-sequelize-express
    database = parts[0];
    strategy = `${parts[1]}-${parts[2]}`;
    orm = parts[3];
    framework = parts[4];
  } else {
    return null;
  }

  // Validate each part is a known value
  if (!ALL_DATABASES.includes(database as Database)) return null;
  if (!ALL_STRATEGIES.includes(strategy as Strategy)) return null;
  if (!ALL_ORMS.includes(orm as Orm)) return null;
  if (!ALL_FRAMEWORKS.includes(framework as Framework)) return null;

  return {
    database: database as Database,
    strategy: strategy as Strategy,
    orm: orm as Orm,
    framework: framework as Framework,
  };
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export function formatPresetString(preset: StackPreset): string {
  return `${preset.database}-${preset.strategy}-${preset.orm}-${preset.framework}`;
}

// ─── Wizard helper: narrow valid options given partial selections ─────────────

export interface ValidOptions {
  databases: Database[];
  strategies: Strategy[];
  orms: Orm[];
  frameworks: Framework[];
}

export function getValidOptions(partial: Partial<StackPreset>): ValidOptions {
  let databases: Database[] = [...ALL_DATABASES];
  let strategies: Strategy[] = [];
  let orms: Orm[] = [];
  let frameworks: Framework[] = [];

  // If database is selected, narrow to that database's config
  if (partial.database) {
    databases = [partial.database];
  }

  // Collect valid strategies/orms/frameworks from matching databases
  const strategySet = new Set<Strategy>();
  const ormSet = new Set<Orm>();
  const frameworkSet = new Set<Framework>();

  for (const db of databases) {
    const config = VALID_COMBINATIONS[db];

    // If strategy is specified, only include this db if it supports it
    if (partial.strategy && !config.strategies.includes(partial.strategy)) continue;
    // If orm is specified, only include this db if it supports it
    if (partial.orm && !config.orms.includes(partial.orm)) continue;

    for (const s of config.strategies) strategySet.add(s);
    for (const o of config.orms) ormSet.add(o);
    for (const f of config.frameworks) frameworkSet.add(f);
  }

  strategies = [...strategySet];
  orms = [...ormSet];
  frameworks = [...frameworkSet];

  // Further narrow if specific values are set
  if (partial.strategy) {
    strategies = strategies.filter((s) => s === partial.strategy);
  }
  if (partial.orm) {
    orms = orms.filter((o) => o === partial.orm);
  }
  if (partial.framework) {
    frameworks = frameworks.filter((f) => f === partial.framework);
  }

  // Narrow databases to only those that support all specified fields
  if (partial.strategy || partial.orm) {
    databases = databases.filter((db) => {
      const config = VALID_COMBINATIONS[db];
      if (partial.strategy && !config.strategies.includes(partial.strategy)) return false;
      if (partial.orm && !config.orms.includes(partial.orm)) return false;
      return true;
    });
  }

  return { databases, strategies, orms, frameworks };
}
