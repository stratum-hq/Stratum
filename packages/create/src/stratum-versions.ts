// esbuild inlines these files when it bundles the CLI, so the published package carries
// the versions of the workspace it was built from. A hardcoded range goes stale on the
// next release of the package it names.
import hono from "../../hono/package.json" with { type: "json" };
import dbAdapters from "../../db-adapters/package.json" with { type: "json" };
import lib from "../../lib/package.json" with { type: "json" };
import mongodb from "../../mongodb/package.json" with { type: "json" };
import mysql from "../../mysql/package.json" with { type: "json" };
import nestjs from "../../nestjs/package.json" with { type: "json" };

/** Caret ranges on the current workspace versions of the packages a generated project uses. */
export const STRATUM_RANGES = {
  "@stratum-hq/db-adapters": `^${dbAdapters.version}`,
  "@stratum-hq/hono": `^${hono.version}`,
  "@stratum-hq/lib": `^${lib.version}`,
  "@stratum-hq/mongodb": `^${mongodb.version}`,
  "@stratum-hq/mysql": `^${mysql.version}`,
  "@stratum-hq/nestjs": `^${nestjs.version}`,
} as const;
