<p align="center">
  <img src="assets/stratumlogo.png" alt="Stratum Logo" width="200" />
</p>

<h1 align="center">Stratum</h1>

<p align="center">
  <strong>Drop-in multi-tenancy for Node.js</strong> — tenant hierarchy, config inheritance, permissions, audit, and GDPR in one library.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-100%25-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/PostgreSQL-16+-336791?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D20-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/npm-%40stratum--hq%2F*-cb3837?style=flat-square&logo=npm&logoColor=white" alt="npm" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="License" />
</p>

---

Stratum gives you hierarchical multi-tenancy with config inheritance, permission delegation, three isolation strategies (RLS, schema-per-tenant, database-per-tenant), field-level encryption, audit logging, GDPR compliance, and multi-region support. Built for B2B SaaS, MSSP/MSP architectures, and any product that needs nested tenant boundaries.

## Why not just `tenant_id`?

Every SaaS team starts with `tenant_id` on every table. It works — until it doesn't:

- **Month 6**: Enterprise customer needs custom config → hand-rolled config tables with no inheritance
- **Month 12**: Compliance audit → scramble to add audit logging, data export, purge capabilities
- **Month 18**: Large customer demands data isolation → painful migration from shared tables to schema-per-tenant

Stratum gives you all of this from day one. Start with flat tenancy, grow into hierarchy, config inheritance, permissions, and isolation strategies as your product matures.

## 30-Second Quickstart

```bash
npm install @stratum-hq/lib pg
```

```typescript
import { Pool } from "pg";
import { Stratum } from "@stratum-hq/lib";

const stratum = new Stratum({ pool: new Pool(), autoMigrate: true });
await stratum.initialize();

const org = await stratum.createOrganization({ name: "Acme Corp", slug: "acme" });
await stratum.setConfig(org.id, "seat_limit", { value: 25 });

const config = await stratum.resolveConfig(org.id);
console.log(config.seat_limit.value); // 25
```

That's it. `autoMigrate: true` creates all tables on first run — no CLI, no migrations, no Docker required (just a PostgreSQL connection string).

### Growing into hierarchy

When you're ready for parent/child tenants, config inheritance, and permission delegation:

```typescript
const msp = await stratum.createTenant({ name: "NorthStar MSP", slug: "northstar" });
const customer = await stratum.createTenant({ name: "Acme Corp", slug: "acme", parent_id: msp.id });

// Config flows root → leaf — children inherit automatically
await stratum.setConfig(msp.id, "max_seats", { value: 500, locked: true });
const config = await stratum.resolveConfig(customer.id);
// → { max_seats: { value: 500, inherited: true, locked: true } }
```

## Install

```bash
# Scaffold a new project (recommended)
npx @stratum-hq/create my-app

# Or add to an existing project
npm install @stratum-hq/lib pg

# HTTP SDK with Express/Fastify middleware
npm install @stratum-hq/sdk

# NestJS integration (guard, decorator, module)
npm install @stratum-hq/nestjs

# React admin components
npm install @stratum-hq/react

# CLI tools
npm install -g @stratum-hq/cli
```

## Packages

| Package | What it does |
|---------|-------------|
| `@stratum-hq/core` | Shared types, Zod schemas, error classes |
| `@stratum-hq/lib` | Direct library — tenants, config, permissions, ABAC, audit, GDPR |
| `@stratum-hq/control-plane` | Fastify v5 REST API with auth, scopes, OTel, Redis rate limiting |
| `@stratum-hq/sdk` | HTTP client with LRU cache, Express/Fastify middleware |
| `@stratum-hq/db-adapters` | PostgreSQL adapters — raw pg, Prisma, Sequelize, RLS, schema/DB isolation |
| `@stratum-hq/react` | React components — tenant tree, config editor, permission editor |
| `@stratum-hq/cli` | CLI — `init`, `migrate`, `scaffold`, `doctor` |
| `@stratum-hq/nestjs` | NestJS integration — guard, `@Tenant()` decorator, module with DI |
| `@stratum-hq/create` | Project scaffolding — `npx @stratum-hq/create my-app` |

## Key Features

- **Tenant hierarchy** — tree structure with ltree, advisory locks, max depth 20
- **Config inheritance** — values flow root→leaf, parents can lock keys
- **Permission delegation** — LOCKED / INHERITED / DELEGATED modes with cascade revocation
- **ABAC** — attribute-based access control with 9 operators, hierarchical policy inheritance, deny-overrides-allow
- **Three isolation strategies** — shared RLS, schema-per-tenant, database-per-tenant
- **Field-level encryption** — AES-256-GCM with key rotation
- **Audit logging** — every mutation with actor identity and before/after state
- **GDPR compliance** — data export (Article 20) and hard purge (Article 17)
- **Webhooks** — lifecycle events with HMAC signatures, retry, DLQ
- **RBAC** — scoped API keys (read/write/admin) with role assignments
- **Multi-region** — region CRUD with tenant migration
- **OpenTelemetry** — optional distributed tracing (zero overhead when disabled)
- **Redis rate limiting** — per-key sliding window, fail-open when Redis unavailable
- **Config diff** — compare resolved config between any two tenants
- **Tenant impersonation** — resolve full context for admin tooling
- **Design system** — CSS custom properties, dark mode, i18n, Storybook
- **310+ unit tests + 20 integration tests** — validated against real PostgreSQL 16

## Running the Demo

```bash
docker compose --profile demo up --build
```

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:3300 |
| API | http://localhost:3001 |
| Swagger | http://localhost:3001/api/docs |

## Documentation

Full docs are available via the [Starlight docs site](website/):

```bash
cd website && npm install && npm run dev
```

Covers: getting started, guides (hierarchy, config, permissions, isolation, API keys, webhooks, GDPR, multi-region), API reference, and per-package documentation.

## Development

```bash
npm install              # Install dependencies
npm run build            # Build all packages
npm test                 # Run unit tests
npx @stratum-hq/cli doctor  # Check your DB setup
```

### Integration Tests

Integration tests run against real PostgreSQL:

```bash
docker compose --profile test up -d test-db
cd packages/integration-tests
DATABASE_URL=postgresql://stratum_test:stratum_test@localhost:5433/stratum_test \
  npx vitest run
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | JWT signing secret (**required** in production) |
| `STRATUM_ENCRYPTION_KEY` | AES-256-GCM key for field encryption |
| `REDIS_URL` | Optional — enables distributed rate limiting |
| `STRATUM_API_KEY_HMAC_SECRET` | HMAC secret for API key hashing |

See the [docs site](website/src/content/docs/getting-started/installation.mdx) for the full list.

## Architecture

```
@stratum-hq/lib (direct)  ←→  @stratum-hq/control-plane (HTTP)
         │                              │
         ├── @stratum-hq/db-adapters    ├── @stratum-hq/sdk
         │   (pg, Prisma, Sequelize)    │   (client, middleware)
         │                              │
         └── PostgreSQL 16              ├── @stratum-hq/nestjs
             (ltree, RLS, AES)          │   (guard, decorator, DI)
                                        │
                                        ├── @stratum-hq/react
                                        │   (UI components)
                                        │
                                        └── @stratum-hq/cli
                                            (init, doctor, migrate)
```

## License

MIT
