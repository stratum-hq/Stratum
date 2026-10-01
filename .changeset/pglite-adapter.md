---
"@stratum-hq/db-adapters": minor
---

Add a PGlite adapter at `@stratum-hq/db-adapters/pglite`. `createPglitePool()` returns a `pg.Pool`-compatible object over one PGlite instance, so `@stratum-hq/lib` runs in Node or in the browser without a database server. `createRestrictedPool()` runs queries as a role that is not a superuser, so row-level security applies. The restricted role is a test and demo convenience, not a security boundary: any query can leave it with `RESET ROLE`. `@electric-sql/pglite` is an optional peer dependency. The adapter has one connection and runs queries one at a time. Releasing a client rolls back a transaction it left open and resets the session settings and the role.
