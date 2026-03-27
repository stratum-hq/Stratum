# Stratum Examples

Practical, runnable examples showing how to use Stratum in different scenarios.

Each example is self-contained. Install dependencies and run from inside its directory.

## Examples

| Example | Description |
|---------|-------------|
| [`quickstart.ts`](./quickstart.ts) | Minimal script: create a Pool, initialize Stratum with `autoMigrate`, build a tenant hierarchy, set and resolve config |
| [`flat-tenancy.ts`](./flat-tenancy.ts) | SaaS flat-tenancy with `createOrganization` / `listOrganizations` — no parent/child hierarchy |
| [`with-express/`](./with-express/) | Express API with `@stratum-hq/sdk` middleware; tenant context resolved from `X-Tenant-ID` header per-request |
| [`with-hono/`](./with-hono/) | Hono API with a typed Hono middleware; config and tenant resolution endpoints |
| [`with-nextjs/`](./with-nextjs/) | Next.js 14 App Router; Edge Middleware resolves tenants from subdomain or header, Server Components call Stratum directly |

## Prerequisites

- Node.js 20+
- PostgreSQL 15+
- `DATABASE_URL` environment variable pointing to your database

## Quick start

Run the minimal quickstart (no HTTP server):

```bash
cd examples
npm install   # if you have a root package.json, otherwise cd into the example
DATABASE_URL=postgres://localhost/mydb npx tsx quickstart.ts
```

## Installing dependencies for framework examples

Each framework example is a standalone project:

```bash
cd examples/with-express && npm install && npm run dev
cd examples/with-hono    && npm install && npm run dev
cd examples/with-nextjs  && npm install && npm run dev
```

## Environment variables

All examples read the following variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://localhost:5432/stratum_dev` |
| `PORT` | HTTP listen port (framework examples) | `3000` |

The `with-express` example also reads:

| Variable | Description |
|----------|-------------|
| `STRATUM_CONTROL_PLANE_URL` | URL of the Stratum control plane | `http://localhost:3001` |
| `STRATUM_API_KEY` | API key for the control plane | `sk_live_dev` |

The `with-nextjs` example also reads:

| Variable | Description | Default |
|----------|-------------|---------|
| `ROOT_DOMAIN` | Base domain for subdomain tenant routing | `app.example.com` |

## Key concepts

### Tenant hierarchy vs flat tenancy

Stratum supports two patterns:

- **Hierarchy** (`createTenant` with `parent_id`) — MSPs, agencies, or any product
  where tenants contain sub-tenants. Config values set on a parent are inherited
  by all descendants.

- **Flat** (`createOrganization`) — standard SaaS where every customer is a
  top-level organization with no parent. Config is set directly per-org.

### Config inheritance

`resolveConfig(tenantId)` returns the merged config for a tenant, walking up the
ancestor chain. Child config values override parent values unless the parent marks
a key as `locked: true`.

### Tenant resolution in HTTP servers

The SDK middleware (`@stratum-hq/sdk`) resolves the tenant from the request in
this order:
1. JWT claim (if `jwtClaimPath` is configured)
2. `X-Tenant-ID` header
3. Custom resolvers (if provided)
