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

## The Verification Gate

`npm run verify` runs the four checks CI runs, in order:

```bash
npm run verify   # lint, then typecheck, then test, then build
```

It stops at the first failure and exits non-zero. The order is deliberate:
lint needs no build and finishes in a couple of seconds, so the cheapest and
most common failures surface first. A full cold run of all four stages takes
roughly 25 seconds; repeat runs are near instant because Turbo caches them.

`npm install` points `core.hooksPath` at `.githooks/`, which installs a
**pre-push hook** that runs `npm run verify` and blocks the push if it fails.
This happens automatically on a fresh clone, so there is no setup step.

If you need to push despite a failure, for example when the failure is
unrelated to your change or your environment is misbehaving:

```bash
git push --no-verify
```

CI still runs on the pull request, so bypassing the hook defers verification
rather than skipping it.

## Making Changes

1. **Fork** the repo and create a branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
2. Make your changes and run `npm run verify` until it passes.
3. Push your branch and open a **Pull Request** against `main`.
4. Fill out the PR description and link any related issues.

PRs should be focused — one feature or fix per PR. Keep commits clean and descriptive.

## Code Style

- **Language:** TypeScript throughout. Avoid `any` where possible.
- **Tests:** Vitest for unit and integration tests. New features should include tests.
- **Formatting:** The project uses consistent formatting; run `npm run verify` to catch lint and type errors before submitting.
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
