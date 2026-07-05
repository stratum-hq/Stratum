# @stratum-hq/cli

Command-line tool for integrating [Stratum](https://github.com/stratum-hq/Stratum) into existing projects — detects your framework, generates boilerplate, checks database readiness, and migrates tables to tenant isolation.

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

Checks connectivity, PostgreSQL version, the `uuid-ossp` and `ltree` extensions, `BYPASSRLS` privilege, the Stratum schema, and RLS status on your tables.

### `stratum migrate`

Add tenant isolation to existing tables:

```bash
stratum migrate --scan      # show RLS status for all tables
stratum migrate orders      # migrate a single table
stratum migrate --all       # migrate all unmigrated tables interactively
```

Each migration adds a `tenant_id UUID NOT NULL` column, enables `FORCE ROW LEVEL SECURITY`, creates a `tenant_isolation` policy, and indexes `tenant_id`.

### `stratum generate api-key`

```bash
stratum generate api-key --name "web-app" --tenant <tenant-uuid>
```

The plaintext key is printed once and never stored.

### `stratum scaffold`

Generate framework-specific integration code without the full wizard:

```bash
stratum scaffold express   # SDK middleware + example routes
stratum scaffold fastify   # SDK plugin
stratum scaffold nextjs    # edge middleware + server helpers + layout
stratum scaffold react     # provider + guards + hooks
stratum scaffold prisma    # tenant-scoped Prisma client
stratum scaffold docker    # Docker Compose for Stratum + PostgreSQL
stratum scaffold env       # .env template with all variables
```

## Global Options

| Flag | Description |
|------|-------------|
| `--database-url`, `-d` | PostgreSQL connection string |
| `--name` | Name for a generated API key |
| `--tenant` | Tenant ID for a generated API key |
| `--out` | Output directory for scaffolded files |
| `--force` | Overwrite existing files |

## Links

- Documentation: https://docs.stratum-hq.org/packages/cli/
- GitHub: https://github.com/stratum-hq/Stratum

## License

MIT © Christian Crank
