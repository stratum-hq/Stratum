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
- **nextjs** — Next.js project with edge middleware for tenant resolution and server-side helpers.

## After Scaffolding

```bash
cd my-app
docker compose up -d   # start PostgreSQL
npm run dev            # run the app
```

The generated project uses `autoMigrate: true`, so Stratum creates its tables automatically on first run — no separate migration step.

## Links

- Documentation: https://docs.stratum-hq.org/packages/create/
- GitHub: https://github.com/stratum-hq/Stratum

## License

MIT © Christian Crank
