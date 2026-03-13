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
                        │    @stratum/lib      │  Direct library (no HTTP)
                        │    Pool → Stratum    │
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
# First run (builds all images, seeds demo data):
docker compose --profile demo up --build

# Subsequent runs:
docker compose --profile demo up

# Full reset (wipes DB volume):
docker compose --profile demo down -v && docker compose --profile demo up --build
```

This starts five services:

| Service | Port | Description |
|---------|------|-------------|
| `db` | 5432 | PostgreSQL 16 with ltree, RLS, and `stratum_app` role |
| `control-plane` | 3001 | Stratum REST API (runs migrations on startup) |
| `demo-seed` | — | One-shot: seeds tenant hierarchy, config, permissions, and sample events |
| `demo-api` | 3002 | Demo Express API (security events with RLS) |
| `demo-web` | 3300 | React dashboard (nginx, proxies to control-plane + demo-api) |

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
  { actor_id: "user-123", actor_type: "api_key", source_ip: "10.0.0.1" }
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
await stratum.purgeExpiredData(90);                         // retention policy
```

### Consent Management

Track per-tenant, per-subject consent with purpose and legal basis:

```typescript
await stratum.grantConsent(tenantId, {
  subject_id: "user-456",
  purpose: "marketing",
  expires_at: "2025-12-31T23:59:59Z",
  metadata: { source: "signup_form" },
});
const consents = await stratum.listConsent(tenantId, "user-456");
```

### Multi-Region

Assign tenants to regions with automatic connection pool routing:

```typescript
const region = await stratum.createRegion({
  display_name: "EU West",
  slug: "eu_west",
  control_plane_url: "https://eu.stratum.example.com",
});
await stratum.migrateRegion(tenantId, region.id);
// Tenant is now assigned to the EU region
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
| `STRATUM_API_KEY_HMAC_SECRET` | — | HMAC-SHA256 secret for API key hashing (recommended in production) |

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

- API keys: 256-bit entropy, HMAC-SHA256 hashed storage (keyed hash prevents offline brute-force from DB dumps), display-once semantics, scoped authorization (`read`/`write`/`admin`), expiration and rotation, transparent migration from legacy SHA-256
- SQL injection: parameterized queries everywhere, table name regex validation for DDL
- RLS: `FORCE ROW LEVEL SECURITY` on all tenant tables, BYPASSRLS startup check
- HTTP: Helmet security headers, CORS, per-IP + per-key rate limiting, SSRF protection on webhook URLs (DNS rebinding, IPv4/IPv6 resolution, cloud metadata blocklists)
- Field-level encryption: AES-256-GCM with HKDF key derivation and key versioning for sensitive config entries and webhook secrets
- Audit logging: all mutations recorded with actor identity, resource tracking, and before/after state
- Docker: non-root containers (UID 1001), minimal `.dockerignore`
- Tenant isolation: fail-closed scope enforcement, post-fetch tenant access checks on all routes
- Soft delete: tenants are archived, never hard-deleted (with GDPR hard-purge option)

## Roadmap

| Version | Feature | Status |
|---------|---------|--------|
| v1.0 | Shared RLS isolation, config inheritance, permission delegation | Done |
| v1.1 | Schema-per-tenant isolation | Done |
| v1.2 | Database-per-tenant isolation | Done |
| v1.3 | Webhook events on tenant lifecycle | Done |
| v1.4 | Audit logging with actor identity and before/after state | Done |
| v1.5 | Authorization enforcement with scoped API keys (`read`/`write`/`admin`) | Done |
| v1.6 | Data retention & GDPR purge (tenant data export, hard-delete, expired record cleanup) | Done |
| v1.7 | Field-level encryption (AES-256-GCM with key versioning) | Done |
| v1.8 | API key management (expiration, rotation, dormant detection) | Done |
| v1.9 | Structured logging & consent management | Done |
| v2.0 | Multi-region support (region CRUD, tenant migration, regional pool routing) | Done |
| v2.1 | Per-key rate limiting (sliding window middleware, per-key `rate_limit_max`/`rate_limit_window`) | Done |
| v2.2 | OpenTelemetry integration (distributed tracing, metrics export) | Planned |
| v2.3 | Tenant-scoped data access enforcement on all routes (hierarchy-aware guards) | Done |
| v2.4 | Batch operations (bulk tenant creation, bulk config updates, atomic transactions) | Done |
| v2.5 | Role-based access control (RBAC) — named roles with scope collections, assignable to API keys | Done |
| v2.6 | Admin dashboard (audit log viewer, API key management in demo UI) | Done |
| v2.7 | Encryption key rotation (zero-downtime re-encryption of all secrets via maintenance API) | Done |
| v2.8 | Webhook dead-letter queue (failed delivery listing, individual/bulk retry, delivery stats) | Done |
| v2.9 | Security hardening (HMAC API keys, Docker non-root, HKDF encryption, SSRF IPv6, fail-closed guards) | Done |

### Future

| Feature | Description | Priority |
|---------|-------------|----------|
| **npm Publishing** | Publish all packages to npm under the `@stratum` scope so integrators can `npm install @stratum/lib` directly | **High** |
| OpenTelemetry | Distributed tracing and metrics export (requires `@opentelemetry/*` packages) | Medium |
| JWT Scope Capping | Cap JWT tokens to read-only scopes to limit blast radius of token theft | Medium |
| Fastify Upgrade | Upgrade to Fastify >= 5.8.2 (CVE fix for content-type boundary parsing) | High |
| Swagger UI Fix | Swagger docs page renders blank white screen (CSP / static asset issue) | Low |
| API Key Bulk Migration | Admin endpoint to force-upgrade all legacy SHA-256 key hashes to HMAC | Low |
| Webhook Signature Rotation | Support multiple active signing keys during webhook secret rotation | Low |
| Rate Limit Persistence | Move per-key rate limit state from in-memory to Redis for multi-instance deployments | Medium |

## Publishing to npm

All packages are scoped under `@stratum/` and structured for npm publishing. They are not yet published — currently consumed via `file:` paths or by copying `packages/` into your project.

### When packages are published

Once on npm, integrators will be able to install directly:

```bash
# Pick the packages you need
npm install @stratum/core @stratum/lib pg          # Direct library (no HTTP)
npm install @stratum/sdk @stratum/core             # SDK + middleware
npm install @stratum/react @stratum/core           # React components
npm install @stratum/db-adapters @stratum/core pg  # Database adapters
npm install @stratum/cli                           # CLI tools (npx @stratum/cli init)
```

No cloning, no `file:` paths, no copying packages — just `npm install` and go.

### Publishing checklist

Before the first publish:

1. **Claim the npm scope**: Register the `@stratum` org on npmjs.com (or use a private registry like GitHub Packages / Verdaccio)
2. **Add `publishConfig`** to each package.json:
   ```json
   {
     "publishConfig": {
       "access": "public",
       "registry": "https://registry.npmjs.org/"
     }
   }
   ```
3. **Add `files` whitelist** to each package.json to keep published packages lean:
   ```json
   {
     "files": ["dist", "README.md", "LICENSE"]
   }
   ```
4. **Version strategy**: Use `npm version` or a tool like [changesets](https://github.com/changesets/changesets) for coordinated versioning across the monorepo
5. **CI publishing**: Add a GitHub Actions workflow that builds, tests, and publishes on tagged releases

### Publishing commands

```bash
# Build all packages
npm run build

# Publish all (from repo root, using npm workspaces)
npm publish --workspaces --access public

# Or publish individually
cd packages/core && npm publish --access public
cd packages/lib && npm publish --access public
cd packages/sdk && npm publish --access public
cd packages/db-adapters && npm publish --access public
cd packages/react-ui && npm publish --access public
cd packages/cli && npm publish --access public
cd packages/control-plane && npm publish --access public
```

### Current consumption (pre-npm)

Until packages are published, there are two ways to use Stratum in other projects:

**Option A — Copy packages (recommended for now)**:
```bash
# Copy only what you need into your project
cp -r stratum/packages/core your-project/packages/core
cp -r stratum/packages/lib your-project/packages/lib

# Reference via file: paths in your package.json
# "@stratum/core": "file:./packages/core"
# "@stratum/lib": "file:./packages/lib"

npm install
```

**Option B — Link from the monorepo**:
```bash
# From the Stratum repo
cd packages/core && npm link
cd packages/lib && npm link

# From your project
npm link @stratum/core @stratum/lib
```

### Private registry alternative

If you don't want to publish publicly, use a private registry:

```bash
# GitHub Packages
npm config set @stratum:registry https://npm.pkg.github.com

# Verdaccio (self-hosted)
npm config set @stratum:registry http://localhost:4873

# Then publish normally
npm publish --workspaces
```

## License

MIT
