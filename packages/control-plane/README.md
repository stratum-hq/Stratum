# @stratum-hq/control-plane

The [Stratum](https://github.com/stratum-hq/Stratum) control plane — a [Fastify](https://fastify.dev) REST API server that exposes tenant, config, permission, API-key, webhook, audit, consent, region, and ABAC management over HTTP. Pair it with `@stratum-hq/sdk` for polyglot stacks or service separation.

## Installation

```bash
npm install @stratum-hq/control-plane
```

Most deployments run it as a standalone service rather than importing it. A container image and Compose file ship with the [Stratum repo](https://github.com/stratum-hq/Stratum).

## Running

```bash
DATABASE_URL=postgres://stratum:stratum_dev@localhost:5432/stratum \
JWT_SECRET=your-secret \
node dist/index.js
```

On startup the server runs database migrations, then listens on `PORT` (default `3001`). It handles `SIGTERM`/`SIGINT` for graceful shutdown. OpenAPI docs are served via `@fastify/swagger-ui`.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Listen port |
| `DATABASE_URL` | `postgres://stratum:stratum_dev@localhost:5432/stratum` | PostgreSQL connection string |
| `JWT_SECRET` | dev fallback | JWT signing secret — **required** in production/staging (server refuses to start without it) |
| `ALLOWED_ORIGINS` | `localhost:3000,3300` | Comma-separated CORS allowlist |
| `RATE_LIMIT_MAX` | `100` | Requests per window |
| `RATE_LIMIT_WINDOW` | `1 minute` | Rate-limit window |
| `REDIS_URL` | — | Optional; enables distributed rate limiting |
| `NODE_ENV` | `development` | Environment |

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

A `/health` endpoint reports server and Redis status.

## Links

- Documentation: https://docs.stratum-hq.org
- GitHub: https://github.com/stratum-hq/Stratum

## License

MIT © Christian Crank
