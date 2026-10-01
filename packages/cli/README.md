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

Interactive setup wizard. Detects your framework and ORM from `package.json`, asks whether you want the direct library (`@stratum-hq/lib`) or the HTTP API + SDK (`@stratum-hq/sdk`), then generates config, middleware/plugin, database setup, and a `.env` template. Generates React provider, guards, and hooks when React is detected. Every question has a default, shown in brackets, that Enter accepts. If stdin closes before every question is answered, the command exits with code 1.

### `stratum health`

Validate that your database is ready for Stratum:

```bash
stratum health --database-url postgres://user:pass@host:5432/mydb
```

Checks connectivity, PostgreSQL version, the `uuid-ossp` and `ltree` extensions, `BYPASSRLS` privilege, the Stratum schema, the role model of migration 032 (pass `--admin-database-url` to include the admin login), and RLS status on your tables. Exits with code 1 when a check fails, as `doctor` does; warnings keep exit code 0.

### `stratum doctor`

Deep diagnostic of a database that runs Stratum: RLS and policies, the role model of migration 032 (control role applied, application login limited, admin login, legacy switch), indexes, orphaned tenants, parent cycles, stale and expired keys, encryption key, tree depth. Pass the admin login with `--admin-database-url` (or `DATABASE_ADMIN_URL`) so the data checks read Stratum's tables as the control role. `--depth-warning <n>` sets the tree depth above which it warns (default: `STRATUM_DOCTOR_DEPTH_WARNING`, else 20). Exits with code 1 when a check fails; warnings keep exit code 0.

### `stratum scan`

Report which application tables need tenant isolation, and write the SQL that adds it:

```bash
stratum scan                                        # report only
stratum scan --generate > migration.sql             # SQL on stdout, report on stderr
stratum scan --exclude users,sessions --generate > migration.sql
```

With `--generate` (`-g`), stdout carries only SQL, so the redirected file runs as is (`psql -f migration.sql`). `--exclude` takes a comma-separated list of tables to leave out. New `tenant_id` columns start out `NULL`; backfill them before you set them `NOT NULL`.

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

The command migrates application tables only. It rejects the name of a table that Stratum's own migrations create, such as `tenants`, and `--all` skips those tables. It takes table names of lowercase letters, digits and underscores; `migrate --scan` suggests `stratum migrate <table>` only for those, and `stratum scan --generate` covers the rest. If stdin closes at the confirmation prompt, the command exits with code 1 and changes nothing.

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

`db roles` prints or applies `bootstrapRolesSql()`: it checks the Stratum tables for objects the migrations did not create, creates the NOLOGIN control role, makes the admin login a member, moves the Stratum objects the application login owns to the admin login (never your tables), applies the control role, and limits the application login to `SELECT` on the read list. See the [hardening guide](https://docs.stratum-hq.org/guides/hardening-roles/).

### `stratum playground`

```bash
stratum playground [--database-url <url>] [--cp-port 3001]
```

Starts the control plane and the demo app (API on 3200, web on 3300). Run it from the root of a clone of the Stratum repository; it uses the `control-plane` and `demo` workspaces.

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

`scaffold docker` writes a compose file and `stratum-init-db.sql`, which sets up the role model: the NOLOGIN `stratum_control` role, the admin login `stratum_admin` (a member of it, neither superuser nor `BYPASSRLS`), and the application login `stratum_app`, with no privilege on the Stratum tables until `stratum db roles --apply` grants the read list.

`scaffold env` (and `init`) write `.env.stratum` with `DATABASE_URL`, `DATABASE_ADMIN_URL`, and new random values for `JWT_SECRET`, `STRATUM_ENCRYPTION_KEY`, `STRATUM_HKDF_SALT` and `STRATUM_API_KEY_HMAC_SECRET`. The values are for development: generate new ones for each environment, keep them in a secret manager, and keep them stable once data exists.

## Global Options

| Flag | Description |
|------|-------------|
| `--database-url`, `-d` | PostgreSQL connection string |
| `--admin-database-url` | Admin login, a member of the control role (default: `DATABASE_ADMIN_URL`); used by `doctor`, `generate api-key`, `migrate --tenant` and `db lock`. Without it they fall back to the legacy `app.bypass_rls` path with a warning |
| `--control-role` | Control role of migration 032 (default: the `stratum.control_role` setting, else `stratum_control`) |
| `--admin-role`, `--app-role`, `--schema`, `--apply` | Options of `db roles` |
| `--name` | Name for a generated API key |
| `--tenant` | Tenant ID for a generated API key |
| `--out` | Output directory for scaffolded files |
| `--force` | Overwrite existing files |
| `--generate`, `-g`, `--exclude` | Options of `scan` |
| `--depth-warning` | Option of `doctor` |
| `--cp-port` | Option of `playground` |

Set `NO_COLOR` to any non-empty value to turn off colors.

## Links

- Documentation: https://docs.stratum-hq.org/packages/cli/
- GitHub: https://github.com/stratum-hq/Stratum

## License

MIT © Christian Crank
