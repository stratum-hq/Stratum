# @stratum-hq/control-plane

The [Stratum](https://github.com/stratum-hq/Stratum) control plane: a [Fastify](https://fastify.dev) REST API server that exposes tenant, config, permission, API-key, webhook, audit, consent, region, and ABAC management over HTTP. Pair it with `@stratum-hq/sdk` for polyglot stacks or service separation.

Read the REST API reference at [docs.stratum-hq.org/api/tenants](https://docs.stratum-hq.org/api/tenants/).

## Installation

```bash
npm install @stratum-hq/control-plane
```

Most deployments run it as a standalone service rather than importing it. A container image and Compose file ship with the [Stratum repo](https://github.com/stratum-hq/Stratum).

## Running

The package has no `bin` entry. Start its entry point with Node:

```bash
DATABASE_URL=postgres://stratum_app:stratum_dev@localhost:5432/stratum \
DATABASE_ADMIN_URL=postgres://stratum_admin:stratum_dev@localhost:5432/stratum \
JWT_SECRET=your-secret \
node node_modules/@stratum-hq/control-plane/dist/index.js
```

In a clone of the repository, run `npm run build`, then `node packages/control-plane/dist/index.js`.

On startup the server runs database migrations (on `DATABASE_ADMIN_URL` when set), then listens on `PORT` (default `3001`). It handles `SIGTERM`/`SIGINT` for graceful shutdown.

The OpenAPI documentation needs no API key: the Swagger UI is at `/api/docs`, and the specification at `/api/docs/json` and `/api/docs/yaml`.

## The first admin key

Every route except the health check and the OpenAPI documentation needs an API key or a JWT, and creating keys needs the `admin` scope. A JWT always belongs to a tenant, and a new API key has the scopes `read` and `write`, so create the first admin key with the library, on the same database and with the same `STRATUM_API_KEY_HMAC_SECRET` as the server:

```typescript
import { Pool } from "pg";
import { Stratum } from "@stratum-hq/lib";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adminPool = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
const stratum = new Stratum({ adminPool, pool });
await stratum.initialize();

// A global key (tenant null) with a role that grants the admin scope.
const role = await stratum.createRole({ name: "operator", scopes: ["admin"] });
const key = await stratum.createApiKey(null, { name: "bootstrap-admin" });
await stratum.assignRoleToKey(key.id, role.id);
console.log(key.plaintext_key); // shown once: store it now

await Promise.all([pool.end(), adminPool.end()]);
```

Run it after the server has started once, so the tables exist. Without `DATABASE_ADMIN_URL`, leave out `adminPool`. Then send the key in the `X-API-Key` header, and create further keys and roles through `/api/v1/api-keys` and `/api/v1/roles`. `stratum generate api-key` from `@stratum-hq/cli` also creates a global key, but with the default `read` and `write` scopes, so it cannot manage keys.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Listen port |
| `DATABASE_URL` | `postgres://stratum:stratum_dev@localhost:5432/stratum` | PostgreSQL connection string of the application login |
| `DATABASE_ADMIN_URL` | none | Optional admin login, a member of the control role of `@stratum-hq/lib` migration 032. When set, the migrations, the library (`adminPool`) and tenant schema and database provisioning run on it, both logins are checked at startup, and the health check reports `admin_db`. When unset, everything runs on `DATABASE_URL` as before. See the [hardening guide](https://docs.stratum-hq.org/guides/hardening-roles/) |
| `STRATUM_CONTROL_ROLE` | none | Name of the control role, when it is not the database's or `stratum_control` |
| `STRATUM_ALLOW_LEGACY_KEY_HASHES` | library default (`true` in 1.x) | `false` accepts only HMAC API key hashes while `STRATUM_API_KEY_HMAC_SECRET` is set; `true` also accepts legacy SHA-256 hashes and re-hashes them on use |
| `STRATUM_API_KEY_HMAC_SECRET` | none | Optional HMAC secret for API key hashes (at least 32 bytes whenever `NODE_ENV` is not `development` or `test`) |
| `JWT_SECRET` | dev fallback | JWT signing secret, **required** whenever `NODE_ENV` is not `development` or `test` (server refuses to start without it). There it must also be at least 32 bytes and not a placeholder such as `change-me-in-production` |
| `JWT_AUDIENCE` | none | Optional; when set, Bearer tokens must carry this `aud` claim (for example `stratum-control-plane`). Recommended whenever `JWT_SECRET` is shared with another application; the server warns at startup when it is unset and `NODE_ENV` is not `development` or `test` |
| `JWT_ISSUER` | none | Optional; when set, Bearer tokens must carry this `iss` claim |
| `ALLOWED_ORIGINS` | `localhost:3000,3300` | Comma-separated CORS allowlist |
| `RATE_LIMIT_MAX` | `100` | Requests per window |
| `RATE_LIMIT_WINDOW` | `1 minute` | Rate-limit window |
| `REDIS_URL` | none | Optional; enables distributed per-key rate limiting. While Redis is unreachable the client keeps reconnecting and per-key limits are counted in memory per process |
| `STRATUM_ENCRYPTION_KEY` | dev fallback | Field-level encryption key, **required** (at least 32 bytes) whenever `NODE_ENV` is not `development` or `test` |
| `STRATUM_HKDF_SALT` | dev fallback | Hex-encoded HKDF salt, **required** whenever `NODE_ENV` is not `development` or `test` |
| `NODE_ENV` | `development` | Environment. Any value other than `development` or `test` (staging and preview included) enforces the `JWT_SECRET` checks, requires real encryption key material, and runs migrations with RLS enforcement (refusing a `BYPASSRLS` role). Unset counts as `development` |

Security middleware (`@fastify/helmet`, CORS, rate limiting) is enabled by default.

## API Surface

All routes are versioned under `/api/v1`:

| Prefix | Resource |
|--------|----------|
| `/api/v1/tenants` | Tenant CRUD + hierarchy |
| `/api/v1/tenants/:id/config` | Config entries |
| `/api/v1/tenants/:id/permissions` | Permission policies |
| `/api/v1/tenants/:tenantId/abac-policies` | ABAC policies |
| `/api/v1/tenants/:tenantId/consent` | GDPR consent records |
| `/api/v1/api-keys` | API-key management |
| `/api/v1/webhooks` | Webhook subscriptions |
| `/api/v1/audit-logs` | Audit log queries |
| `/api/v1/regions` | Multi-region config |
| `/api/v1/roles` | RBAC roles |
| `/api/v1/config` | Config diff |
| `/api/v1/maintenance` | Retention / purge tasks |

`GET /api/v1/health` needs no API key and reports server, database (and, with `DATABASE_ADMIN_URL`, admin database) and Redis status.

## Links

- Documentation: https://docs.stratum-hq.org
- GitHub: https://github.com/stratum-hq/Stratum

## License

MIT © Christian Crank
