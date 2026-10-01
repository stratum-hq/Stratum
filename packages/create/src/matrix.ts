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
// @stratum-hq/db-adapters routes queries to a tenant's schema or database
// only for Prisma and raw pg. The other ORMs have no adapter for those
// strategies, so the generator offers them only with rls.
const POSTGRES_ORMS_BY_STRATEGY: Partial<Record<Strategy, Orm[]>> = {
  schema: ["prisma", "pg"],
  database: ["prisma", "pg"],
};

const MONGODB_STRATEGIES: Strategy[] = ["database", "collection"];
const MONGODB_ORMS: Orm[] = ["mongoose"];

const MYSQL_STRATEGIES: Strategy[] = ["database", "table-prefix"];
// @stratum-hq/mysql routes queries to a tenant's database or tables only for
// the raw mysql2 driver ("pg" here). Its Knex and Sequelize helpers scope a
// shared table by tenant_id, which neither MySQL strategy uses.
const MYSQL_ORMS: Orm[] = ["pg"];

const ALL_FRAMEWORKS: Framework[] = ["express", "fastify", "nextjs", "hono", "nestjs", "none"];

export interface DatabaseConfig {
  strategies: Strategy[];
  orms: Orm[];
  frameworks: Framework[];
  /** The ORMs a strategy allows, when it allows fewer than `orms`. */
  ormsByStrategy?: Partial<Record<Strategy, Orm[]>>;
}

export const VALID_COMBINATIONS: Record<Database, DatabaseConfig> = {
  postgres: {
    strategies: POSTGRES_STRATEGIES,
    orms: POSTGRES_ORMS,
    frameworks: ALL_FRAMEWORKS,
    ormsByStrategy: POSTGRES_ORMS_BY_STRATEGY,
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

/** The ORMs that a database allows with a strategy, or none if it does not allow the strategy. */
export function ormsFor(database: Database, strategy: Strategy): Orm[] {
  const config = VALID_COMBINATIONS[database];
  if (!config || !config.strategies.includes(strategy)) return [];
  return config.ormsByStrategy?.[strategy] ?? config.orms;
}

export function isValidPreset(preset: StackPreset): boolean {
  const config = VALID_COMBINATIONS[preset.database];
  if (!config) return false;
  if (!config.strategies.includes(preset.strategy)) return false;
  if (!ormsFor(preset.database, preset.strategy).includes(preset.orm)) return false;
  if (!config.frameworks.includes(preset.framework)) return false;
  return true;
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

export function parsePresetString(s: string): StackPreset | null {
  if (!s || typeof s !== "string") return null;

  const parts = s.toLowerCase().split("-");

  // Handle "table-prefix" which contains a hyphen; it will split into
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
  const candidates: Database[] = partial.database ? [partial.database] : [...ALL_DATABASES];
  const databases: Database[] = [];

  // Collect the strategies, ORMs and frameworks of the (strategy, ORM) pairs
  // that each database allows and that match the selections made so far.
  const strategySet = new Set<Strategy>();
  const ormSet = new Set<Orm>();
  const frameworkSet = new Set<Framework>();

  for (const db of candidates) {
    const config = VALID_COMBINATIONS[db];
    let matched = false;
    for (const strategy of config.strategies) {
      if (partial.strategy && strategy !== partial.strategy) continue;
      for (const orm of ormsFor(db, strategy)) {
        if (partial.orm && orm !== partial.orm) continue;
        strategySet.add(strategy);
        ormSet.add(orm);
        matched = true;
      }
    }
    if (!matched) continue;
    databases.push(db);
    for (const f of config.frameworks) {
      if (!partial.framework || f === partial.framework) frameworkSet.add(f);
    }
  }

  return {
    databases,
    strategies: [...strategySet],
    orms: [...ormSet],
    frameworks: [...frameworkSet],
  };
}
