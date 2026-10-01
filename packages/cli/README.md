# @stratum-hq/cli

Command-line tool for integrating [Stratum](https://github.com/stratum-hq/Stratum) into existing projects. It detects your framework, generates boilerplate, checks database readiness, and migrates tables to tenant isolation.

Read the documentation at [docs.stratum-hq.org/packages/cli](https://docs.stratum-hq.org/packages/cli/).

## Installation

```bash
npm install -g @stratum-hq/cli

# Or run without installing:
npx @stratum-hq/cli <command>
```

## Commands

### `stratum init`

Interactive setup wizard. Detects your framework and ORM from `package.json`, asks whether you want the direct library (`@stratum-hq/lib`) or the HTTP API + SDK (`@stratum-hq/sdk`), then generates config, middleware/plugin, database setup, and a `.env` template. Generates React provider, guards, and hooks when React is detected.

### `stratum health`

Validate that your database is ready for Stratum:

```bash
stratum health --database-url postgres://user:pass@host:5432/mydb
```

Checks connectivity, PostgreSQL version, the `uuid-ossp` and `ltree` extensions, `BYPASSRLS` privilege, the Stratum schema, the role model of migration 032, and RLS status on your tables.

### `stratum doctor`

Deep diagnostic of a database that runs Stratum: RLS and policies, the role model of migration 032 (control role applied, application login limited, admin login, legacy switch), indexes, orphaned tenants, parent cycles, stale and expired keys, encryption key, tree depth. Pass the admin login with `--admin-database-url` (or `DATABASE_ADMIN_URL`) so the data checks read Stratum's tables as the control role.

### `stratum migrate`

Add tenant isolation to existing tables:

```bash
stratum migrate --scan      # show RLS status for all tables
stratum migrate orders      # migrate a single table
stratum migrate --all       # migrate all unmigrated tables interactively
stratum migrate orders --tenant <tenant-uuid>   # assign existing rows to one tenant
```

Each migration adds a `tenant_id UUID NOT NULL` column, enables `FORCE ROW LEVEL SECURITY`, creates a `tenant_isolation` policy, and indexes `tenant_id`. When a `tenants` table exists, the migration also adds a foreign key from `tenant_id` to `tenants(id)`, which needs the `REFERENCES` privilege on `tenants`; the command names the grant when it is missing.

If the table already has rows, each row needs a tenant. Give that tenant with `--tenant <uuid>`, and the migration assigns every existing row to it. The tenant must exist in the `tenants` table. Without `--tenant`, the migration stops and changes nothing. With `--all`, the same `--tenant` applies to every table that has rows.

The command migrates application tables only. It rejects the name of a table that Stratum's own migrations create, such as `tenants`, and `--all` skips those tables.

A table counts as isolated only when RLS is enabled and forced and its policies filter rows by tenant: every permissive policy on the table must compare `tenant_id` with the current tenant setting, `app.current_tenant_id`, in `USING` and in any `WITH CHECK`. The policy's name does not matter. PostgreSQL combines permissive policies with OR, so one policy that admits other rows opens the whole table. `scan`, `migrate`, `health` and `doctor` report such a table with the policy that fails the check, and `migrate` does not replace policies you wrote: correct or drop that policy, then run the command again. `migrate --all` exits non-zero while any such table remains.

### `stratum generate api-key`

```bash
stratum generate api-key --name "web-app" --tenant <tenant-uuid>
```

The plaintext key is printed once and never stored. With `STRATUM_API_KEY_HMAC_SECRET` set, the key is stored with an HMAC hash, as `@stratum-hq/lib` stores it.

### `stratum db roles`, `db lock`, `db unlock`

Set up the role model of `@stratum-hq/lib` migration 032 (opt-in in 1.x):

```bash
stratum db roles --admin-role stratum_admin --app-role stratum_app            # print the SQL
stratum db roles --apply --admin-role stratum_admin --app-role stratum_app \
  --database-url <superuser url>                                              # apply it
stratum db lock --admin-database-url <admin url>                              # close the legacy app.bypass_rls path
stratum db unlock --admin-database-url <admin url>                            # reopen it
```

`db roles` prints or applies `bootstrapRolesSql()`: it checks the Stratum tables for objects the migrations did not create, creates the NOLOGIN control role, makes the admin login a member, moves the Stratum objects the application login owns to the admin login (never your tables), applies the control role (re-creating every Stratum policy from the canonical set), and limits the application login to `SELECT` on the read list. See the [hardening guide](https://docs.stratum-hq.org/guides/hardening-roles/).

### `stratum scaffold`

Generate framework-specific integration code without the full wizard:

```bash
stratum scaffold express   # SDK middleware + example routes
stratum scaffold fastify   # SDK plugin
stratum scaffold nextjs    # JWT-verifying edge middleware + server helpers + layout
stratum scaffold react     # provider + guards + hooks
stratum scaffold prisma    # tenant-scoped Prisma client
stratum scaffold docker    # Docker Compose for Stratum + PostgreSQL
stratum scaffold env       # .env template with all variables
```

## Global Options

| Flag | Description |
|------|-------------|
| `--database-url`, `-d` | PostgreSQL connection string |
| `--admin-database-url` | Admin login, a member of the control role (default: `DATABASE_ADMIN_URL`); used by `doctor`, `generate api-key`, `migrate --tenant` and `db lock`. Without it they fall back to the legacy `app.bypass_rls` path with a warning |
| `--control-role` | Control role of migration 032 (default: the `stratum.control_role` setting, else `stratum_control`) |
| `--admin-role`, `--app-role`, `--schema`, `--apply` | Options of `db roles` |
| `--grant-references` | `db roles`: also grant the application login `REFERENCES (id)` on `tenants`, for foreign keys from its tables (opt-in) |
| `--name` | Name for a generated API key |
| `--tenant` | Tenant ID for a generated API key |
| `--out` | Output directory for scaffolded files |
| `--force` | Overwrite existing files |

## Links

- Documentation: https://docs.stratum-hq.org/packages/cli/
- GitHub: https://github.com/stratum-hq/Stratum

## License

MIT © Christian Crank
