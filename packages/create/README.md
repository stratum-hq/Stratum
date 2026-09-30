# @stratum-hq/create

Scaffold a complete [Stratum](https://github.com/stratum-hq/Stratum) multi-tenancy project with one command — package.json, Docker Compose, environment files, and framework-specific starter code.

## Usage

```bash
npx @stratum-hq/create my-app
```

This creates a `my-app/` directory containing:

- `package.json` with `@stratum-hq/lib`, `pg`, and your chosen framework
- `docker-compose.yml` with PostgreSQL 16 and the `ltree` + `uuid-ossp` extensions pre-loaded
- `.env.example` with `DATABASE_URL` and other defaults
- A starter server wired up with Stratum middleware
- `README.md` with getting-started instructions

## Options

```bash
npx @stratum-hq/create my-app [options]

  --template <name>   express (default), fastify, or nextjs
  --skip-install      skip npm install after scaffolding
  --force             overwrite an existing directory
```

## Templates

- **express** (default) — Express server with Stratum middleware, tenant-aware routes, and TypeScript config.
- **fastify** — Fastify server with the Stratum plugin registered.
- **nextjs** — Next.js project with edge middleware that resolves the tenant from a verified JWT.

## After Scaffolding

```bash
cd my-app
docker compose up -d   # start PostgreSQL
cp .env.example .env   # npm run dev reads .env
npm run dev            # run the app
```

The generated starter code does not create a `Stratum` instance, so it does not create Stratum's tables. To create them, construct `Stratum` with `autoMigrate: true` and call `initialize()` once at startup.

## Tenant resolution

Generated servers (the Express, Fastify, Hono and NestJS presets) and the Next.js middleware take the tenant ID only from the `tenant_id` claim of a bearer token that verifies with `JWT_SECRET` (HS256, using `jose`, which the generated `package.json` lists). A token that does not verify, or has no `tenant_id` claim, is rejected with 401. The tenant is never taken from the hostname or from a client-supplied header such as `x-tenant-id`. In the Next.js middleware the subdomain is forwarded as `x-tenant-slug`, a display hint that does not identify the caller's tenant.

## Links

- Documentation: https://docs.stratum-hq.org/packages/create/
- GitHub: https://github.com/stratum-hq/Stratum

## License

MIT © Christian Crank
