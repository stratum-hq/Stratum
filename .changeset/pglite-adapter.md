---
"@stratum-hq/db-adapters": minor
---

Add a PGlite adapter at `@stratum-hq/db-adapters/pglite`. `createPglitePool()` returns a `pg.Pool`-compatible object over one PGlite instance, so `@stratum-hq/lib` runs in Node or in the browser without a database server. `createRestrictedPool()` runs queries as a role that is not a superuser, so row-level security applies. `@electric-sql/pglite` is an optional peer dependency. The adapter has one connection and runs queries one at a time.
