# Contributing to Stratum

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Setting Up the Dev Environment

**Prerequisites:** Node.js 20+, PostgreSQL 15+, Docker (optional but recommended)

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

1. **Fork** the repo and create a branch from `master`:
   ```bash
   git checkout -b feat/my-feature
   ```
2. Make your changes and ensure tests pass.
3. Push your branch and open a **Pull Request** against `master`.
4. Fill out the PR description and link any related issues.

PRs should be focused — one feature or fix per PR. Keep commits clean and descriptive.

## Code Style

- **Language:** TypeScript throughout. Avoid `any` where possible.
- **Tests:** Vitest for unit and integration tests. New features should include tests.
- **Formatting:** The project uses consistent formatting; run `npm run build` to catch type errors before submitting.
- **Commits:** Use conventional commit messages (`feat:`, `fix:`, `chore:`, etc.).

## Monorepo Structure

This is an [npm workspaces](https://docs.npmjs.com/cli/v10/using-npm/workspaces) + [Turbo](https://turbo.build/) monorepo with 9 packages:

| Package | Description |
|---|---|
| `packages/core` | Core engine — session management, auth, key derivation |
| `packages/sdk` | JavaScript/TypeScript SDK for client applications |
| `packages/react-ui` | React components for embedding Stratum UI |
| `packages/cli` | Command-line interface (`stratum` command) |
| `packages/control-plane` | REST API server and admin control plane |
| `packages/db-adapters` | Database adapters (PostgreSQL and others) |
| `packages/lib` | Shared utilities and internal helpers |
| `packages/demo` | Demo application and usage examples |
| `packages/integration-tests` | End-to-end and integration test suite |

## Questions?

Open a [GitHub Issue](https://github.com/stratum-hq/stratum/issues) — we're happy to help.
