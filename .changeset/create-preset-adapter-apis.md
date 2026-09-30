---
"@stratum-hq/create": patch
---

Fix the database setup that the pg, knex and mongoose presets generate, so that it compiles and runs against the published packages.

- The PostgreSQL `pg` preset passes a tenant function to `createTenantPool`, which expects `() => string`.
- The PostgreSQL `knex` preset sets `app.current_tenant_id` with `set_config(..., true)` inside `knex.transaction`. PostgreSQL does not accept a bind parameter in `SET`, and the RLS policies read `app.current_tenant_id`.
- The `mongoose` presets no longer import `createTenantConnection`, which `@stratum-hq/mongodb` does not export. They use Mongoose directly, with the database and collection names of the `@stratum-hq/mongodb` adapters.
- The MySQL `pg` preset types its query parameters so that `pool.execute` accepts them.
- The generated README names the `app.current_tenant_id` setting.
- The RLS policy example in the generated `init.sql` uses `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`. A pooled connection reads the setting as an empty string after a tenant transaction ends, and the old example raised an error there instead of returning no rows.
