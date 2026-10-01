# Stratum Examples

Practical, runnable examples showing how to use Stratum in different scenarios.

Each example is self-contained. Install dependencies and run from inside its directory.

## Examples

| Example | Description |
|---------|-------------|
| [`quickstart.ts`](./quickstart.ts) | Minimal script: create a Pool, initialize Stratum with `autoMigrate`, build a tenant hierarchy, set and resolve config |
| [`flat-tenancy.ts`](./flat-tenancy.ts) | SaaS flat-tenancy with `createOrganization` / `listOrganizations`, with no parent/child hierarchy |
| [`with-express/`](./with-express/) | Express API with `@stratum-hq/sdk` middleware; tenant context resolved per request from a verified JWT claim |
| [`with-hono/`](./with-hono/) | Hono API with Hono's JWT middleware and `@stratum-hq/hono`; tenant resolved from a verified JWT claim |
| [`with-nextjs/`](./with-nextjs/) | Next.js 15 App Router; Middleware resolves tenants from a verified JWT or the subdomain, Server Components call Stratum directly |

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

The three framework examples also read:

| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_SECRET` | HS256 key that verifies the bearer token. Generate one with `openssl rand -hex 32`. | None: `with-express` and `with-hono` do not start without it |

The `with-express` example also reads:

| Variable | Description | Default |
|----------|-------------|---------|
| `STRATUM_CONTROL_PLANE_URL` | URL of the Stratum control plane | `http://localhost:3001` |
| `STRATUM_API_KEY` | API key for the control plane | `sk_live_dev` |

The `with-nextjs` example also reads:

| Variable | Description | Default |
|----------|-------------|---------|
| `ROOT_DOMAIN` | Base domain for subdomain tenant routing | `app.example.com` |

## Key concepts

### Tenant hierarchy vs flat tenancy

Stratum supports two patterns:

- **Hierarchy** (`createTenant` with `parent_id`): MSPs, agencies, or any product
  where tenants contain sub-tenants. Config values set on a parent are inherited
  by all descendants.

- **Flat** (`createOrganization`): standard SaaS where every customer is a
  top-level organization with no parent. Config is set directly per-org.

### Config inheritance

`resolveConfig(tenantId)` returns the merged config for a tenant, walking up the
ancestor chain. Child config values override parent values unless the parent marks
a key as `locked: true`.

### Tenant resolution in HTTP servers

The framework examples read the tenant from a verified JWT claim. A client can
set any request header, so a tenant ID read from a client header lets the
caller choose any tenant.

The SDK middleware (`@stratum-hq/sdk`) resolves the tenant from the request in
this order:
1. The verified JWT claim (`jwtClaimPath`, default `tenant_id`), when `jwtSecret`
   or `jwtVerify` is configured. A bearer token that fails verification gets `401`.
2. The `X-Tenant-ID` header. When `jwtSecret` or `jwtVerify` is configured, the
   SDK reads this header only if `trustTenantHeader: true` is set.
3. Custom resolvers (if provided)

Set `trustTenantHeader: true` only when a gateway you control sets the tenant
header and removes any copy the client sent.
