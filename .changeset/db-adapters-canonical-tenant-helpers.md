---
"@stratum-hq/db-adapters": major
"@stratum-hq/cli": patch
"@stratum-hq/create": patch
---

Give the `@stratum-hq/db-adapters` barrel one consistent naming scheme for the tenant-context helpers (#219, from the #133 v1.0 surface review).

The barrel previously exposed the same "run in tenant context" concept under colliding names patched over with `as` aliases. The 1.0 names use an `<orm>` prefix so no export is an alias workaround:

- `withTenant` (Prisma) -> `prismaWithTenant`
- `withDrizzleTenant` -> `drizzleWithTenant`
- `withTenantScope` (Sequelize) -> `sequelizeWithTenantScope`
- `withDrizzleTenantScope` -> `drizzleWithTenantScope`
- `enableRLSMigration` (migration helper) -> `enableRLSForMigration` (distinct from the runtime `enableRLS`)

Behavior is identical; only the exported names change. The `@stratum-hq/cli` and `@stratum-hq/create` scaffolding templates emit the new `prismaWithTenant` name. Update your imports to the new names.
