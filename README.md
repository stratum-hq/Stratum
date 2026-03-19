<p align="center">
  <img src="assets/stratumlogo.png" alt="Stratum Logo" width="200" />
</p>

<h1 align="center">Stratum</h1>

<p align="center">
  <strong>Universal Tenant Context Engine</strong> — hierarchical multi-tenancy for any stack.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-100%25-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/PostgreSQL-16+-336791?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D20-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/npm-%40stratum--hq%2F*-cb3837?style=flat-square&logo=npm&logoColor=white" alt="npm" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="License" />
</p>

---

Stratum gives you hierarchical multi-tenancy with config inheritance, permission delegation, three isolation strategies (RLS, schema-per-tenant, database-per-tenant), field-level encryption, audit logging, GDPR compliance, and multi-region support. Built for MSSP/MSP/client architectures and any product that needs nested tenant boundaries.

## Install

```bash
# Direct library (no HTTP overhead)
npm install @stratum-hq/lib @stratum-hq/core pg

# HTTP SDK with Express/Fastify middleware
npm install @stratum-hq/sdk @stratum-hq/core

# React admin components
npm install @stratum-hq/react @stratum-hq/core

# CLI tools
npm install -g @stratum-hq/cli
```

## Quick Example

```typescript
import { Pool } from "pg";
import { Stratum } from "@stratum-hq/lib";

const stratum = new Stratum({ pool: new Pool() });

// Create a tenant hierarchy
const root = await stratum.createTenant({ name: "AcmeSec", slug: "acmesec" });
const msp = await stratum.createTenant({ name: "NorthStar MSP", slug: "northstar", parent_id: root.id });

// Config flows root → leaf with inheritance
await stratum.setConfig(root.id, "max_users", { value: 1000, locked: false });
const config = await stratum.resolveConfig(msp.id);
// → { max_users: { value: 1000, inherited: true, source_tenant_id: root.id } }
```

## Packages

| Package | What it does |
|---------|-------------|
| `@stratum-hq/core` | Shared types, Zod schemas, error classes |
| `@stratum-hq/lib` | Direct library — tenants, config, permissions, audit, GDPR |
| `@stratum-hq/control-plane` | Fastify v5 REST API with auth, scopes, OTel, Redis rate limiting |
| `@stratum-hq/sdk` | HTTP client with LRU cache, Express/Fastify middleware |
| `@stratum-hq/db-adapters` | PostgreSQL adapters — raw pg, Prisma, RLS, schema/DB isolation |
| `@stratum-hq/react` | React components — tenant tree, config editor, permission editor |
| `@stratum-hq/cli` | CLI — `init`, `migrate`, `scaffold`, `doctor` |

## Key Features

- **Tenant hierarchy** — tree structure with ltree, advisory locks, max depth 20
- **Config inheritance** — values flow root→leaf, parents can lock keys
- **Permission delegation** — LOCKED / INHERITED / DELEGATED modes with cascade revocation
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
- **290+ tests** — unit, integration, and mock-based across all packages

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
npm test                 # Run 290+ tests
npx @stratum-hq/cli doctor  # Check your DB setup
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
         │   (pg, Prisma, RLS)          │   (client, middleware)
         │                              │
         └── PostgreSQL 16              ├── @stratum-hq/react
             (ltree, RLS, AES)          │   (UI components)
                                        │
                                        └── @stratum-hq/cli
                                            (init, doctor, migrate)
```

## License

MIT
