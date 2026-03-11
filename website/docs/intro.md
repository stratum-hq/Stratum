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

## Next Steps

- [Getting Started](/docs/guides/getting-started) — install and create your first tenant
- [Direct Library Guide](/docs/guides/direct-library) — use `@stratum/lib` without HTTP
- [Control Plane + SDK Guide](/docs/guides/control-plane-sdk) — HTTP API integration
- [Architecture Overview](/docs/architecture/overview) — system design deep dive
