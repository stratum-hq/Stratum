---
slug: /
sidebar_position: 1
title: Introduction
---

# Stratum

**Universal Tenant Context Engine** — hierarchical multi-tenancy for any stack.

Stratum gives you a complete tenant management system with tree-structured hierarchies, config inheritance, permission delegation, and PostgreSQL Row-Level Security isolation. Built for MSSP/MSP/client architectures and any product that needs nested tenant boundaries.

## Two Integration Paths

| Path | Package | Best For |
|------|---------|----------|
| **Direct Library** | `@stratum/lib` | Node.js apps, serverless, maximum performance |
| **HTTP API + SDK** | `@stratum/control-plane` + `@stratum/sdk` | Polyglot stacks, service separation, React admin UI |

### Direct Library

```bash
npm install @stratum/lib @stratum/core pg
```

```typescript
import { Pool } from "pg";
import { Stratum } from "@stratum/lib";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const stratum = new Stratum({ pool });

const tenant = await stratum.createTenant({
  name: "Acme Corp",
  slug: "acme_corp",
  isolation_strategy: "SHARED_RLS",
});
```

### HTTP API + SDK

```bash
npm install @stratum/sdk @stratum/core
```

```typescript
import { stratum } from "@stratum/sdk";

const s = stratum({
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "sk_live_your_key",
});

// Express
app.use(s.middleware());

// Fastify
app.register(s.plugin());
```

## Packages

| Package | Description |
|---------|-------------|
| [`@stratum/core`](/docs/packages/core) | Shared types, Zod validation schemas, error classes, utilities |
| [`@stratum/lib`](/docs/packages/lib) | Framework-agnostic library — embed Stratum directly in your Node.js app |
| [`@stratum/control-plane`](/docs/packages/control-plane) | REST API server — Fastify, Swagger UI, auto-migrations |
| [`@stratum/sdk`](/docs/packages/sdk) | Node.js SDK — HTTP client, LRU cache, Express/Fastify middleware |
| [`@stratum/db-adapters`](/docs/packages/db-adapters) | PostgreSQL adapters — raw pg + Prisma, RLS management |
| [`@stratum/react`](/docs/packages/react) | React components — provider, tenant switcher, tree, editors |
| [`@stratum/demo`](/docs/packages/demo) | Demo MSSP app — security events dashboard with RLS isolation |
| [`@stratum/cli`](/docs/packages/cli) | Developer CLI — project init, DB migration, framework scaffolding |

## Key Concepts

### Tenant Hierarchy

Tenants form a tree. A typical MSSP setup:

```
AcmeSec (root MSSP)             depth: 0
├── NorthStar MSP                depth: 1
│   ├── Client Alpha             depth: 2
│   └── Client Beta              depth: 2
└── SouthShield MSP              depth: 1
    └── Client Gamma             depth: 2
```

### Config Inheritance

Config values flow root → leaf. Children inherit parent values unless they override. Parents can **lock** keys to prevent overrides.

### Permission Delegation

Three modes: **LOCKED** (immutable), **INHERITED** (overridable), **DELEGATED** (overridable + re-delegatable). Three revocation modes: **CASCADE**, **SOFT**, **PERMANENT**.

### Row-Level Security

Every tenant-scoped table uses PostgreSQL RLS policies. Tenant context is set per-transaction via parameterized `set_config()`. `FORCE ROW LEVEL SECURITY` ensures even table owners cannot bypass policies.

### Isolation Strategies

Three isolation levels are available, configurable per tenant:

| Strategy | Boundary | Use Case |
|----------|----------|----------|
| `SHARED_RLS` | Row-Level Security policies | Default. Best for high tenant count, shared infrastructure |
| `SCHEMA_PER_TENANT` | PostgreSQL schema | Mid-tier. Logical separation with shared DB |
| `DB_PER_TENANT` | Dedicated database | Maximum isolation. Separate connection pool per tenant |

### Webhook Events

Register webhooks to receive HTTP callbacks on tenant lifecycle events — tenant created/updated/deleted/moved, config changes, and permission changes. Deliveries include HMAC-SHA256 signatures and automatic retry with exponential backoff.

### Audit Logging

All mutations are recorded in an append-only audit log with actor identity (API key or JWT), resource tracking, and before/after state snapshots. Query audit entries by tenant, action, or date range with cursor pagination.

### Authorization & Scopes

API keys carry scopes (`read`, `write`, `admin`) that restrict which operations they can perform. JWT tokens receive full privileges. The `authorize` middleware enforces scope requirements per HTTP method and route pattern.

### Data Retention (GDPR)

GDPR-compliant data management: hard-purge all tenant data (Article 17 right to erasure), export all tenant data as JSON (Article 20 data portability), and automatically clean up expired audit logs and webhook records with configurable retention periods.

### Field-Level Encryption

Sensitive config entries and webhook secrets are encrypted at rest using AES-256-GCM with key versioning. The encryption format (`v1:iv:authTag:ciphertext`) supports seamless key rotation.

### API Key Management

API keys support expiration dates (auto-rejected after expiry), atomic rotation (create new + revoke old), and dormant key detection for keys unused longer than 90 days.

### Consent Management

Track GDPR consent records per tenant with subject, purpose, granted/revoked status, and optional expiration. Full CRUD via REST API.

### Multi-Region

Deploy tenants across geographic regions. Regions have status lifecycle (active/draining/inactive). Children inherit their parent's region unless explicitly overridden. Cross-region migration moves tenants between regions with a single API call. The SDK supports region-aware routing via `RegionalPoolRouter`.

## Developer CLI

Add Stratum to an existing project in seconds:

```bash
npx @stratum/cli init              # interactive setup wizard
npx @stratum/cli health            # validate database setup
npx @stratum/cli migrate --scan    # show RLS status for all tables
npx @stratum/cli migrate orders    # add tenant_id + RLS to a table
npx @stratum/cli scaffold react    # generate React components + hooks
```

The CLI detects your framework (Express, Fastify, Next.js, etc.), generates middleware boilerplate, database setup, and React components including `PermissionGuard`, `ConfigGuard`, and custom hooks like `usePermission()` and `useConfig()`.

## Next Steps

- [Getting Started](/docs/guides/getting-started) — install and create your first tenant
- [CLI Reference](/docs/packages/cli) — full CLI command reference
- [Direct Library Guide](/docs/guides/direct-library) — use `@stratum/lib` without HTTP
- [Control Plane + SDK Guide](/docs/guides/control-plane-sdk) — HTTP API integration
- [Architecture Overview](/docs/architecture/overview) — system design deep dive
- [Audit Logging](/docs/guides/audit-logging) — audit trail setup and querying
- [Authorization & Scopes](/docs/guides/authorization) — API key scopes and enforcement
- [GDPR & Data Retention](/docs/guides/gdpr) — data export, purge, and retention
- [Encryption](/docs/guides/encryption) — field-level encryption configuration
- [Consent Management](/docs/guides/consent) — GDPR consent tracking
- [Multi-Region](/docs/guides/multi-region) — regional deployment and tenant migration
