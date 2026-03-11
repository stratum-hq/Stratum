---
sidebar_position: 8
title: "@stratum/cli"
---

# @stratum/cli

Command-line tool for initializing Stratum in existing projects, managing database migrations, and scaffolding framework integrations.

## Installation

```bash
npm install -g @stratum/cli
# or use directly
npx @stratum/cli <command>
```

## Commands

### stratum init

Interactive project setup wizard. Detects your framework (Express, Fastify, Next.js, etc.), asks your preferred integration path, and generates all boilerplate files.

```bash
stratum init
```

What it does:
1. Detects your framework and ORM from `package.json`
2. Asks: direct library (`@stratum/lib`) or HTTP API + SDK (`@stratum/sdk`)?
3. Generates: config file, middleware/plugin, database setup, `.env` template
4. If React is detected, also generates: provider, tenant guard components, custom hooks
5. Prints install instructions for the required packages

### stratum health

Validates your database is ready for Stratum.

```bash
stratum health
stratum health --database-url postgres://user:pass@host:5432/mydb
```

Checks:
- Database connectivity
- PostgreSQL version (16+ recommended, 14+ required)
- Extensions: `uuid-ossp` and `ltree`
- BYPASSRLS privilege (must be disabled)
- Stratum schema tables (tenants, config_entries, etc.)
- RLS status on all user tables

### stratum migrate

Add tenant isolation to existing database tables.

```bash
# Scan all tables and show RLS status
stratum migrate --scan

# Migrate a specific table
stratum migrate orders

# Migrate all unmigrated tables interactively
stratum migrate --all
```

For each table, migration:
1. Adds `tenant_id UUID NOT NULL` column
2. Enables `ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`
3. Creates `tenant_isolation` policy
4. Creates index on `tenant_id`
5. Adds foreign key to `tenants` table (if exists)

### stratum generate api-key

Generate an API key from the command line.

```bash
stratum generate api-key --name "my-service"
stratum generate api-key --name "admin" --tenant <tenant-uuid>
```

The plaintext key is displayed once and never stored.

### stratum scaffold

Generate framework-specific integration boilerplate without the full `init` wizard.

```bash
stratum scaffold express         # Express middleware + routes
stratum scaffold fastify         # Fastify plugin
stratum scaffold nextjs          # Next.js middleware + API helpers + layout
stratum scaffold react           # React provider + guards + hooks
stratum scaffold prisma          # Tenant-scoped Prisma client
stratum scaffold docker          # Docker Compose for Stratum + PostgreSQL
stratum scaffold env             # .env template with all variables
```

#### scaffold express

Generates:
- `stratum-middleware.ts` — SDK client + `expressMiddleware` setup
- `tenant-routes.ts` — Example routes using `req.tenant`

#### scaffold fastify

Generates:
- `stratum-plugin.ts` — SDK client + `fastifyPlugin` setup

#### scaffold nextjs

Generates:
- `middleware.ts` — Edge middleware for tenant resolution (subdomain, header, or path)
- `lib/stratum.ts` — Server-side helpers for API routes and Server Components
- `components/tenant-layout.tsx` — Client component with `StratumProvider`

#### scaffold react

Generates:
- `stratum-provider.tsx` — `AppStratumProvider` wrapper
- `tenant-guard.tsx` — `PermissionGuard` and `ConfigGuard` components
- `use-tenant.ts` — `usePermission()`, `useConfig()`, `useIsRootTenant()` hooks

#### scaffold prisma

Generates:
- `stratum-prisma.ts` — Tenant-scoped Prisma client using `@stratum/db-adapters`

#### scaffold docker

Generates:
- `docker-compose.stratum.yml` — PostgreSQL + control plane services

#### scaffold env

Generates:
- `.env.stratum` — All Stratum environment variables with defaults

## Options

| Flag | Description |
|------|-------------|
| `--database-url`, `-d` | PostgreSQL connection string |
| `--name` | Name for generated API key |
| `--tenant` | Tenant ID for generated API key |
| `--out` | Output directory for scaffolded files |
| `--force` | Overwrite existing files |
| `--help`, `-h` | Show help |
| `--version`, `-v` | Show version |
