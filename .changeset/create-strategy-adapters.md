---
"@stratum-hq/create": minor
---

Generate strategy-specific tenant helpers, tenant provisioning and row-level security policies for the PostgreSQL presets (GHSA-r5mc-55fv-2cvp). The `schema` and `database` presets are now offered only for Prisma and `pg`; `postgres-schema-*` and `postgres-database-*` with Drizzle, Sequelize or Knex are no longer valid presets.

Upgrade note: if you generated a project from a `postgres-schema-*` or `postgres-database-*` preset with an earlier version, review its tenant helper and compare it with what this version generates for the same preset.
