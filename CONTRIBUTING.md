# Contributing to Stratum

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Setting Up the Dev Environment

**Prerequisites:** Node.js 20+, PostgreSQL 16+, Docker (optional but recommended)

```bash
# Clone and install dependencies
git clone https://github.com/stratum-hq/stratum.git
cd stratum
npm install

# Start the database (Docker recommended)
docker compose up db -d

# Build all packages
npm run build
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests for a specific package
cd packages/core
npm test
```

Tests use [Vitest](https://vitest.dev/). Integration tests in `packages/integration-tests` require a running database.

## Making Changes

1. **Fork** the repo and create a branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
2. Make your changes and ensure tests pass.
3. Push your branch and open a **Pull Request** against `main`.
4. Fill out the PR description and link any related issues.

PRs should be focused — one feature or fix per PR. Keep commits clean and descriptive.

## Code Style

- **Language:** TypeScript throughout. Avoid `any` where possible.
- **Tests:** Vitest for unit and integration tests. New features should include tests.
- **Formatting:** The project uses consistent formatting; run `npm run build` to catch type errors before submitting.
- **Commits:** Use conventional commit messages (`feat:`, `fix:`, `chore:`, etc.).

## Monorepo Structure

This is an [npm workspaces](https://docs.npmjs.com/cli/v10/using-npm/workspaces) + [Turbo](https://turbo.build/) monorepo with 15 packages:

| Package | Description |
|---|---|
| `packages/core` | Shared types, Zod schemas, error classes |
| `packages/lib` | Direct library — tenants, config, permissions, ABAC, audit, GDPR |
| `packages/control-plane` | Fastify v5 REST API with auth, scopes, rate limiting |
| `packages/sdk` | HTTP client with LRU cache, Express/Fastify middleware |
| `packages/db-adapters` | PostgreSQL adapters — raw pg, Prisma, Sequelize, Drizzle, RLS, schema/DB isolation |
| `packages/mongodb` | MongoDB tenant isolation — shared collection, collection-per-tenant, database-per-tenant |
| `packages/nestjs` | NestJS integration — guard, `@Tenant()` decorator, DI module |
| `packages/hono` | Hono middleware — tenant extraction, ALS context |
| `packages/react-ui` | React components — tenant tree, config editor, permission editor |
| `packages/cli` | CLI — `init`, `migrate`, `scaffold`, `doctor` |
| `packages/create` | Project scaffolding — `npx @stratum-hq/create my-app` |
| `packages/test-utils` | Cross-tenant isolation test helpers |
| `packages/stratum` | npm name reservation (placeholder) |
| `packages/demo` | Demo application (MSSP hierarchy) |
| `packages/integration-tests` | Integration tests against real PostgreSQL 16 |

## Questions?

Open a [GitHub Issue](https://github.com/stratum-hq/stratum/issues) — we're happy to help.
