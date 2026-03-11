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
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="License" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/packages-8-8b5cf6?style=flat-square" alt="Packages" />
  <img src="https://img.shields.io/badge/source_files-554-22c55e?style=flat-square" alt="Source Files" />
  <img src="https://img.shields.io/badge/test_files-144-f59e0b?style=flat-square" alt="Test Files" />
  <img src="https://img.shields.io/badge/isolation-RLS%20%7C%20Schema%20%7C%20DB-ef4444?style=flat-square" alt="Isolation Strategies" />
</p>

---

Stratum gives you a complete multi-tenant platform with tree-structured hierarchies, config inheritance, permission delegation, three isolation strategies (RLS, schema-per-tenant, database-per-tenant), field-level encryption, audit logging, GDPR compliance (data export and erasure), scoped API key management, consent tracking, and multi-region support. Built for MSSP/MSP/client architectures and any product that needs nested tenant boundaries.

## Two Integration Paths

<table>
<tr>
<td width="50%" valign="top">

### Direct Library

```bash
npm install @stratum/lib
```

```typescript
import { Pool } from "pg";
import { Stratum } from "@stratum/lib";

const pool = new Pool({ connectionString: DATABASE_URL });
const stratum = new Stratum({ pool });

const tenant = await stratum.createTenant({
  name: "Acme Corp",
  slug: "acme_corp",
  isolation_strategy: "SHARED_RLS",
});

const config = await stratum.resolveConfig(tenant.id);
```

No HTTP overhead. Maximum performance. Embed directly in your Node.js app or serverless functions.

</td>
<td width="50%" valign="top">

### HTTP API + SDK

```bash
npm install @stratum/sdk
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

// req.tenant is now available everywhere
```

Run the control plane as a service. Use from any language. Built-in LRU caching, Express/Fastify middleware.

</td>
</tr>
</table>

## Architecture

```
                        ┌──────────────────────┐
                        │    @stratum/lib       │  Direct library (no HTTP)
                        │    Pool → Stratum     │
                        └──────────┬───────────┘
                                   │
                   ┌───────────────┼───────────────┐
                   │               │               │
          ┌────────▼────────┐ ┌────▼─────────┐ ┌───▼──────────┐
          │  Control Plane  │ │  @stratum/   │ │  @stratum/   │
          │  Fastify REST   │ │  sdk         │ │  react       │
          │  Auth · Scopes  │ │  HTTP client │ │  UI comps    │
          │  Audit · GDPR   │ │  middleware  │ │  provider    │
          └────────┬────────┘ └────┬─────────┘ └──────────────┘
                   │               │
          ┌────────▼───────────────▼────────┐
          │       @stratum/db-adapters      │
          │   Raw pg · Prisma · RLS · Pool  │
          └────────────────┬────────────────┘
                           │
                ┌──────────▼──────────┐
                │    PostgreSQL 16    │
                │  ltree · RLS · AES  │
                └─────────────────────┘
```

## Packages

| Package | Description | Key Features |
|---------|-------------|--------------|
| [`@stratum/core`](docs/packages/core.md) | Shared foundation | Types, Zod schemas, error classes, audit/consent/region types |
| [`@stratum/lib`](docs/packages/lib.md) | Direct library | Tenants, config, permissions, audit, encryption, GDPR, regions |
| [`@stratum/control-plane`](docs/packages/control-plane.md) | REST API server | Fastify, auth + scopes, audit logging, structured logging |
| [`@stratum/sdk`](docs/packages/sdk.md) | Node.js SDK | HTTP client, LRU cache, Express/Fastify middleware, key rotation |
| [`@stratum/db-adapters`](docs/packages/db-adapters.md) | Database layer | Raw pg + Prisma adapters, RLS management, regional pools |
| [`@stratum/react`](docs/packages/react-ui.md) | React components | Provider, tenant switcher, tree, config/permission editors |
| [`@stratum/demo`](docs/packages/demo.md) | Demo MSSP app | Security events dashboard with full RLS isolation |
| [`@stratum/cli`](docs/packages/cli.md) | Developer CLI | Project init, DB migration, framework scaffolding |

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **PostgreSQL** 16+ (via Docker or local)
- **npm** >= 10

### Option A: Add to Existing Project (CLI)

```bash
npx @stratum/cli init
```

The CLI detects your framework, asks your preferred integration path, and generates all boilerplate. Then migrate your tables:

```bash
npx @stratum/cli health                    # verify DB setup
npx @stratum/cli migrate --scan            # show table RLS status
npx @stratum/cli migrate orders            # add tenant_id + RLS to a table
npx @stratum/cli scaffold react --out src  # generate React components
```

### Option B: Direct Library (fastest)

```bash
npm install @stratum/lib @stratum/core pg
```

```typescript
import { Pool } from "pg";
import { Stratum } from "@stratum/lib";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const stratum = new Stratum({ pool });

// Create root tenant
const root = await stratum.createTenant({
  name: "AcmeSec",
  slug: "acmesec",
  isolation_strategy: "SHARED_RLS",
});

// Create child
const msp = await stratum.createTenant({
  name: "NorthStar MSP",
  slug: "northstar_msp",
  parent_id: root.id,
});

// Config with inheritance
await stratum.setConfig(root.id, "max_users", { value: 1000, locked: false });
const config = await stratum.resolveConfig(msp.id);
// → { max_users: { value: 1000, inherited: true, source_tenant_id: root.id } }

// Permissions with delegation
await stratum.createPermission(root.id, {
  key: "manage_users",
  value: true,
  mode: "LOCKED",
  revocation_mode: "CASCADE",
});
```

### Option C: Control Plane + SDK

```bash
# Clone and install
git clone <repo-url> && cd stratum
npm install

# Start PostgreSQL
docker-compose up db -d

# Build all packages
npm run build

# Start the control plane (runs migrations automatically)
node packages/control-plane/dist/index.js

# Seed demo data (new terminal)
npx tsx packages/demo/api/src/seed.ts

# Start the demo app (new terminal)
npm run dev --workspace=@stratum/demo
```

Then open:

| Service | URL | Description |
|---------|-----|-------------|
| Web UI | http://localhost:3300 | React dashboard with tenant switching |
| Control Plane API | http://localhost:3001 | REST API for tenant management |
| Swagger Docs | http://localhost:3001/api/docs | Interactive API documentation |

### Docker (full stack)

```bash
docker-compose --profile demo up
```

## Key Concepts

### Tenant Hierarchy

Stratum models tenants as a tree using PostgreSQL `ltree` for efficient subtree queries:

```
AcmeSec (root MSSP)             depth: 0
├── NorthStar MSP                depth: 1
│   ├── Client Alpha             depth: 2
│   └── Client Beta              depth: 2
└── SouthShield MSP              depth: 1
    └── Client Gamma             depth: 2
```

Each tenant has:
- `ancestry_path` — UUID chain (`/uuid1/uuid2`) for ancestor resolution
- `ancestry_ltree` — slug-based path (`acmesec.northstar_msp.client_alpha`) for PostgreSQL subtree queries
- Advisory locks on parent UUID prevent race conditions during concurrent modifications

### Config Inheritance

Config values flow **root → leaf**. Children inherit parent values unless they override:

```
Root:    max_users = 1000
  MSP:   max_users = 500        ← overrides root
    Client: (no override)       ← inherits 500 from MSP
```

Parents can **lock** a key to prevent any descendant from overriding it.

### Permission Delegation

| Mode | Behavior |
|------|----------|
| `LOCKED` | Set once, immutable by any descendant |
| `INHERITED` | Flows down, descendants can override |
| `DELEGATED` | Flows down, descendants can override and re-delegate |

Revocation controls blast radius: `CASCADE` (recursive), `SOFT` (local only), `PERMANENT` (immutable).

### Row-Level Security

Every tenant-scoped table uses PostgreSQL RLS policies. The tenant context is set per-transaction via parameterized `set_config()`:

```sql
BEGIN;
SELECT set_config('app.current_tenant_id', $1, true);  -- parameterized, transaction-local
-- Your queries here (automatically filtered by RLS)
COMMIT;
```

`FORCE ROW LEVEL SECURITY` ensures even table owners cannot bypass policies.

### Isolation Strategies

Stratum supports three isolation levels, configurable per tenant:

| Strategy | Boundary | Use Case |
|----------|----------|----------|
| `SHARED_RLS` | Row-Level Security policies | Default. Best for high tenant count, shared infrastructure |
| `SCHEMA_PER_TENANT` | PostgreSQL schema | Mid-tier. Logical separation with shared DB |
| `DB_PER_TENANT` | Dedicated database | Maximum isolation. Separate connection pool per tenant |

### Webhook Events

Register webhooks to receive HTTP callbacks on tenant lifecycle events:

| Event | Trigger |
|-------|---------|
| `tenant.created` | New tenant created |
| `tenant.updated` | Tenant properties changed |
| `tenant.deleted` | Tenant archived |
| `tenant.moved` | Tenant moved in hierarchy |
| `config.updated` | Config key set or overridden |
| `config.deleted` | Config key removed |
| `permission.created` | Permission policy created |
| `permission.updated` | Permission policy updated |
| `permission.deleted` | Permission policy deleted |

Deliveries include HMAC-SHA256 signatures and automatic retry with exponential backoff.

### Audit Logging

Every mutation is recorded with full context:

```typescript
await stratum.createTenant(
  { name: "Acme", slug: "acme", isolation_strategy: "SHARED_RLS" },
  { actor_id: "user-123", actor_type: "user", ip_address: "10.0.0.1" }
);
// → audit_logs row: action="tenant.created", actor, before/after state, timestamp
```

Audit entries capture actor identity, resource type/ID, and before/after snapshots for every change.

### Authorization & Scopes

API keys and JWTs carry scopes that control access:

| Scope | Access |
|-------|--------|
| `read` | GET operations only |
| `write` | GET + POST/PUT/DELETE |
| `admin` | Full access including key management and purge |

Tenant ancestry is verified on every request — a key scoped to tenant A cannot access tenant B's data.

### Field-Level Encryption

Sensitive config values are encrypted at rest with AES-256-GCM:

```typescript
await stratum.setConfig(tenantId, "api_secret", {
  value: "sk_live_abc123",
  locked: true,
  sensitive: true,  // ← encrypted before storage
});
```

Key versioning supports rotation without re-encrypting all values at once.

### GDPR Compliance

Built-in data export (Article 20) and hard-purge (Article 17):

```typescript
const archive = await stratum.exportTenantData(tenantId);  // full JSON export
await stratum.purgeTenant(tenantId);                        // irreversible delete
await stratum.cleanupExpiredRecords(90);                    // retention policy
```

### Consent Management

Track per-tenant, per-subject consent with purpose and legal basis:

```typescript
await stratum.recordConsent(tenantId, {
  subject_id: "user-456",
  purpose: "marketing_emails",
  legal_basis: "consent",
  granted: true,
});
const consents = await stratum.getConsents(tenantId, "user-456");
```

### Multi-Region

Assign tenants to regions with automatic connection pool routing:

```typescript
const region = await stratum.createRegion({
  name: "EU West",
  slug: "eu-west",
  connection_url: "postgres://eu-host:5432/stratum",
});
await stratum.migrateTenantRegion(tenantId, region.id);
// All subsequent queries for this tenant route to the EU pool
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Control plane listen port |
| `DATABASE_URL` | `postgres://stratum:stratum_dev@localhost:5432/stratum` | PostgreSQL connection |
| `NODE_ENV` | `development` | Environment (`production` enables strict checks) |
| `JWT_SECRET` | `dev-secret-change-in-production` | JWT signing secret (**required** in production) |
| `ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:3300` | CORS origins (comma-separated) |
| `RATE_LIMIT_MAX` | `100` | Max requests per rate limit window |
| `RATE_LIMIT_WINDOW` | `1 minute` | Rate limit time window |
| `STRATUM_ENCRYPTION_KEY` | — | AES-256-GCM key for field-level encryption (**required** in production) |

## Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](docs/guides/getting-started.md) | Setup, first tenant, first API key |
| [Architecture](docs/architecture/overview.md) | System design, request flow, caching |
| [API Reference](docs/api/README.md) | All REST endpoints with examples |
| [SDK Integration](docs/guides/sdk-integration.md) | Express/Fastify middleware, tenant resolution |
| [Direct Library](docs/packages/lib.md) | Using `@stratum/lib` without HTTP |
| [Database & RLS](docs/architecture/database.md) | Schema, RLS policies, advisory locks |
| [Security](docs/architecture/security.md) | Auth, SQL injection prevention, RLS guarantees |
| [React Components](docs/packages/react-ui.md) | Provider, hooks, tenant tree, config editor |
| [CLI Reference](docs/packages/cli.md) | Project init, DB migration, scaffolding |
| [Audit Logging](docs/guides/audit-logging.md) | Audit trail with actor context and before/after state |
| [Authorization & Scopes](docs/guides/authorization.md) | API key scopes, JWT privileges, route enforcement |
| [GDPR & Data Retention](docs/guides/gdpr.md) | Tenant data export, hard-purge, retention policies |
| [Encryption](docs/guides/encryption.md) | AES-256-GCM field-level encryption and key versioning |
| [Consent Management](docs/guides/consent.md) | GDPR consent records with purpose tracking |
| [Multi-Region](docs/guides/multi-region.md) | Region management, tenant migration, regional pools |

## Development

```bash
npm run build          # Build all packages
npm run test           # Run all tests
npm run lint           # Type-check all packages
npm run format         # Format with Prettier
npm run dev            # Dev mode (watch)
```

## Security

- API keys: 256-bit entropy, SHA-256 hashed storage, display-once semantics, scoped authorization (`read`/`write`/`admin`), expiration and rotation
- SQL injection: parameterized queries everywhere, table name regex validation for DDL
- RLS: `FORCE ROW LEVEL SECURITY` on all tenant tables, BYPASSRLS startup check
- HTTP: Helmet security headers, CORS, per-IP rate limiting, SSRF protection on webhook URLs
- Field-level encryption: AES-256-GCM with key versioning for sensitive config entries and webhook secrets
- Audit logging: all mutations recorded with actor identity, resource tracking, and before/after state
- Soft delete: tenants are archived, never hard-deleted (with GDPR hard-purge option)

## Roadmap

| Version | Feature | Status |
|---------|---------|--------|
| v1.0 | Shared RLS isolation, config inheritance, permission delegation | Current |
| v1.1 | Schema-per-tenant isolation | Current |
| v1.2 | Database-per-tenant isolation | Current |
| v1.3 | Webhook events on tenant lifecycle | Current |
| v1.4 | Audit logging with actor identity and before/after state | Current |
| v1.5 | Authorization enforcement with scoped API keys (`read`/`write`/`admin`) | Current |
| v1.6 | Data retention & GDPR purge (tenant data export, hard-delete, expired record cleanup) | Current |
| v1.7 | Field-level encryption (AES-256-GCM with key versioning) | Current |
| v1.8 | API key management (expiration, rotation, dormant detection) | Current |
| v1.9 | Structured logging & consent management | Current |
| v2.0 | Multi-region support (region CRUD, tenant migration, regional pool routing) | Current |

## License

MIT
