# CLAUDE.md

House rules for `stratum-hq/Stratum`. Read this before changing anything.

This file describes what this repository is, what the tests actually prove, what the
known-broken baseline is, and what you must never do here. The "Forbidden actions"
section is the most important part of this document.

---

## 1. What Stratum is

Stratum is a drop-in multi-tenancy library for Node.js, published to npm under the
`@stratum-hq` scope, MIT licensed. It is a library and a set of framework adapters. It is
not an application.

What it provides:

- **Tenant hierarchy.** A tree of tenants stored in PostgreSQL with a materialized path in
  an `ltree` column. Advisory locks guard moves, max depth 20. See
  `packages/lib/src/migrations/001_init.sql` and
  `packages/lib/src/services/tenant-service.ts`.
- **Config inheritance.** Config values resolve up the ancestry chain, root to leaf. A
  parent can lock a key so descendants cannot override it.
  `packages/lib/src/services/config-service.ts`.
- **ABAC permissions with delegation.** Attribute-based policies with hierarchical
  inheritance and deny-overrides-allow, plus permission delegation modes
  (LOCKED / INHERITED / DELEGATED) with cascade revocation.
  `packages/lib/src/services/abac-service.ts`, `permission-service.ts`.
- **Audit log.** Every mutation records actor identity and before / after state.
  `packages/lib/src/services/audit-service.ts`.
- **GDPR erasure and export.** Article 17 hard purge and Article 20 data export.
  `packages/lib/src/services/retention-service.ts`, `consent-service.ts`.
- **Field-level encryption.** AES-256-GCM with key rotation. `packages/lib/src/crypto.ts`.
- **Webhooks.** Lifecycle events with HMAC signatures, retry, and a dead letter queue.
  `packages/lib/src/services/webhook-service.ts`, `event-service.ts`.
- **API keys and roles.** Scoped keys (read / write / admin) with HMAC hashing and role
  assignment. `packages/lib/src/services/api-key-service.ts`, `role-service.ts`.

Isolation strategies: shared table with RLS, schema-per-tenant, and database-per-tenant on
PostgreSQL, with parallel strategies for MongoDB and MySQL in their own packages.

### What Stratum is NOT

**Stratum is not Tenantry.** Tenantry is a separate, proprietary product that is built on
top of this library. Tenantry's code does not live in this repository and never should. If
a task mentions Tenantry features, portals, billing, tickets, or customer data, you are in
the wrong repository. Stop and say so.

Nothing product-specific, customer-specific, or proprietary belongs here. This repository
is a general-purpose open source library and it is **public**.

---

## 2. Repository layout

npm workspaces + Turborepo. All code lives in `packages/*`. Sixteen packages, fourteen of
them published to npm; `demo` and `integration-tests` are `private: true` and are never
published.

One naming trap: the directory is `packages/react-ui` but the package is
`@stratum-hq/react`. Directory name and package name do not match for that one.

### Substantial packages

These carry real implementation. Treat changes here as load-bearing.

| Package | Directory | What it is |
|---|---|---|
| `@stratum-hq/lib` | `packages/lib` | The core library. Tenants, config, ABAC, permissions, audit, GDPR, webhooks, roles, API keys, regions, crypto. The largest and most important package. |
| `@stratum-hq/react` | `packages/react-ui` | React admin components: tenant tree, config editor, permission editor. Design system, dark mode, i18n. |
| `@stratum-hq/cli` | `packages/cli` | `init`, `migrate`, `scaffold`, `doctor`. |
| `@stratum-hq/control-plane` | `packages/control-plane` | Fastify v5 REST API over the library, with auth, scopes, OpenTelemetry, Redis rate limiting. |
| `@stratum-hq/create` | `packages/create` | Project scaffolding, `npx @stratum-hq/create my-app`. |
| `@stratum-hq/core` | `packages/core` | Shared types, Zod schemas, error classes. Everything else depends on it. |
| `@stratum-hq/db-adapters` | `packages/db-adapters` | PostgreSQL adapters: raw pg, Prisma, Sequelize, Drizzle, plus RLS and schema / database isolation. |
| `@stratum-hq/mysql` | `packages/mysql` | MySQL isolation with TypeORM / Knex / Sequelize helpers. |
| `@stratum-hq/mongodb` | `packages/mongodb` | MongoDB isolation with a Mongoose plugin. |
| `@stratum-hq/sdk` | `packages/sdk` | HTTP client for the control plane, LRU cache, Express / Fastify middleware. |

### Thin packages

Small by design. Do not mistake their size for incompleteness, but also do not assume they
are as exercised as the packages above.

| Package | Directory | Note |
|---|---|---|
| `@stratum-hq/nestjs` | `packages/nestjs` | Roughly 240 lines: guard, `@Tenant()` decorator, DI module. |
| `@stratum-hq/test-utils` | `packages/test-utils` | Two source files of cross-tenant isolation assertions. |
| `@stratum-hq/hono` | `packages/hono` | Roughly 80 lines of middleware and ALS context. |
| `@stratum-hq/stratum` | `packages/stratum` | **Empty.** An npm name reservation at version 0.0.1 with a package.json, a README, and a LICENSE. No source, no build, no tests. Do not add code here without an explicit decision to make it a real package. |

### Private packages

| Package | Directory | Note |
|---|---|---|
| `@stratum-hq/demo` | `packages/demo` | MSSP hierarchy demo app: an Express-style API plus a Vite web front end. Not published. Has failing tests, see section 5. |
| `@stratum-hq/integration-tests` | `packages/integration-tests` | 20 integration tests against real PostgreSQL. Not published. Its `test` script is a no-op reminder; the real command is `test:integration`. |

Not workspace packages, but present at the repo root: `website/` (Starlight docs),
`landing/` (Astro marketing site), `examples/`, `docker/`, `scripts/`.

---

## 3. Commands

```bash
npm install          # or npm ci
npm run build        # turbo build, 14 tasks
npm test             # turbo test, unit tests only, no database needed
npm run lint         # turbo lint, which is tsc --noEmit per package, 18 tasks
npm run format       # prettier over packages/*/src
```

Integration tests are **not** part of `npm test`. They need a live database:

```bash
docker compose --profile test up -d test-db
cd packages/integration-tests
DATABASE_URL=postgresql://stratum_test:stratum_test@localhost:5433/stratum_test npx vitest run
```

Turbo caches aggressively. If you need to be certain a suite really ran rather than
replaying a cache hit, add `--force`, for example `npx turbo test --force`. A forced run at
full concurrency can get OOM killed on a laptop and exit 137, which looks like a test
failure but is not one. Use `npx turbo test --force --concurrency=2` if that happens.

---

## 4. The testing contract, and what the tests do not prove

`npm test` runs **757 unit tests across 13 packages**. Read the next paragraph before you
treat that number as reassurance.

| Package | Tests |
|---|---|
| `@stratum-hq/lib` | 132 |
| `@stratum-hq/db-adapters` | 124 |
| `@stratum-hq/core` | 114 |
| `@stratum-hq/create` | 93 |
| `@stratum-hq/control-plane` | 62 |
| `@stratum-hq/mysql` | 61 |
| `@stratum-hq/sdk` | 57 |
| `@stratum-hq/mongodb` | 54 |
| `@stratum-hq/react` | 19 |
| `@stratum-hq/nestjs` | 14 |
| `@stratum-hq/test-utils` | 10 |
| `@stratum-hq/hono` | 9 |
| `@stratum-hq/demo` | 8 (4 of them fail, see section 5) |

`@stratum-hq/cli` has a `test` script but zero test files. It passes because of
`--passWithNoTests`. A green CLI test task means nothing was run.

### The important caveat

**No unit test in `@stratum-hq/lib` touches a real database.** All 132 of them run without
Postgres.

The 13 test files in `packages/lib/src` declare 128 `it()` blocks, which vitest expands to
132 cases. Of those 128 declarations, 102 belong to files that stub the database layer
entirely: they `vi.mock("../../pool-helpers.js")` and use `makeMockPool()` from
`packages/lib/src/services/__tests__/test-helpers.ts`, which literally returns
`{} as import("pg").Pool`. Those tests assert on the **SQL strings the service passes to a
fake client**, not on what PostgreSQL does with them.

The remaining 26 declarations, in `crypto.test.ts`, `stratum-als.test.ts`, and
`abac-service.test.ts`, are genuine pure-logic tests of AES-256-GCM, AsyncLocalStorage
context, and policy evaluation. They are meaningful, and they are also not about the
database.

What this means in practice:

- A green `npm test` proves the SQL string was **built** as expected. It does not prove the
  query is valid, that the schema has those columns, that `ltree` behaves as assumed, that
  a transaction rolls back, that RLS actually isolates, or that a constraint fires.
- A refactor that changes SQL text will fail these tests even when behavior is identical.
- A change that keeps the SQL text identical but breaks the schema will pass them.
- The only tests that exercise real database behavior are the 20 in
  `packages/integration-tests`, and they are not in `npm test`.

If you change anything that writes SQL, run the integration suite against a real database
before you claim the change works. Do not report "tests pass" as evidence that a
database-facing change is correct.

---

## 5. Known baseline, do not mistake it for your own regression

These are already broken on the base branch. If you see them, you did not cause them.
Do not open an issue for them, do not "fix" them as a drive-by, and do not let them block
your work. Note them and move on.

1. **`@stratum-hq/demo` fails 4 tests.** `packages/demo/web/src/dark-mode.test.ts` fails 4
   of its 4 assertions with `TypeError: localStorage.clear is not a function` at line 6.
   This is a jsdom setup problem in `packages/demo/vitest.config.ts` /
   `web/src/test-setup.ts`, not a product bug. It makes the top-level `npm test` exit 1
   even when everything else is green, so `npm test` is currently expected to exit
   non-zero.

2. **PR CI gates only part of the suite.** `.github/workflows/ci.yml` filters to six
   packages (`core`, `lib`, `sdk`, `db-adapters`, `cli`, `react`). Since `cli` has no test
   files, that covers **446 of 757 tests**. The other 311, in `create`, `control-plane`,
   `mysql`, `mongodb`, `nestjs`, `hono`, `test-utils`, and `demo`, gate nothing on a pull
   request. A green PR check is not a green suite. Run `npm test` locally.

3. **`CONTRIBUTING.md` is stale.** It says 15 packages, omits `packages/mysql`, and refers
   to `packages/react-ui` without noting the package is named `@stratum-hq/react`. Trust
   this file over that table. Do not fix it as part of an unrelated change.

---

## 6. Forbidden actions

These are not style preferences. Violating any of them causes real, externally visible
damage.

### Never push a git tag

`.github/workflows/publish.yml` triggers on `push: tags: ["v*"]`. It builds, tests, and
then **publishes every non-private package in `packages/*` to npm** using OIDC trusted
publishing. There is no token to be missing and no manual approval step. A tag pushed by
accident ships a real public release of 14 packages to the registry, and npm releases
cannot be unpublished cleanly.

Do not run `git tag`. Do not run `git push --tags`. Do not run `git push --follow-tags`.
Do not create a release through the GitHub UI or `gh release create`, which creates a tag.
If a release is genuinely needed, that is a human decision made outside your task.

### Never publish manually

No `npm publish`. No `npm run release`. No `changeset publish`. Releasing is the tag
workflow's job and nobody else's. Adding a changeset file under `.changeset/` is fine and
expected; running the publish step is not.

### Never commit directly to `main`

Work on a branch. Open a pull request. `main` is the changesets base branch and the branch
CI and the npm README point at.

### Never force-push. Never rewrite history

No `git push --force`, no `--force-with-lease`, no `git rebase` onto a shared branch, no
`git reset --hard` on anything already pushed, no `git filter-repo`, no `git commit
--amend` on a pushed commit.

This repository's history was deliberately cleaned with `git-filter-repo` in July 2026.
The current history is the intended history. Any rewrite risks reintroducing what that
cleanup removed. Do not disturb it.

### This repository is PUBLIC. Keep security detail out of it

Everything you write here is world-readable the moment it is pushed: commit messages, pull
request titles and bodies, code comments, issue text, test names, changeset files, and
branch names.

Never write into this repository:

- The specifics of an unfixed vulnerability: where it is, what triggers it, how to exploit
  it, what an attack path looks like.
- Reproduction steps or proof-of-concept code for an unfixed finding.
- Anything that turns a vague "hardening" commit into a map of what is currently
  exploitable.

Unfixed findings live in the private spec, and only there. Reference them by issue number
or by a neutral description ("harden input validation on the tenant move route"), never by
mechanism. When in doubt, write less. `SECURITY.md` documents the private reporting route
at security@stratum-hq.org; that is where detail belongs.

Fixed and released findings can be discussed normally, but that is a human's call to make,
not yours.

### Also do not

- Add a dependency without saying why in the pull request.
- Add code to `packages/stratum`. It is a name reservation.
- Put Tenantry code, product logic, or customer data anywhere in this repository.
- Delete or rewrite the failing demo tests to make `npm test` green. Fix them properly or
  leave them alone.

---

## 7. The verification contract

The target is a single command, `npm run verify`, that runs **typecheck + lint + test +
build**, with secret scanning wired in, and which a pre-push hook enforces so a bad push is
blocked locally rather than caught later.

**It does not exist yet.** As of this writing there is no `verify` script in the root
`package.json` on `main` or on `epic/102-guardrails`. Adding it is separate tracked work,
as is the `typecheck` task it depends on. Do not assume `npm run verify` will work; check
`package.json` first. When it lands, it becomes the gate and this section should be updated
to say so plainly.

Until then, the gate is these three commands, run locally, in this order:

```bash
npm run lint     # expect exit 0, 18 tasks
npm run build    # expect exit 0, 14 tasks
npm test         # expect exit 1, from the 4 known demo failures only
```

**Local checks are the gate right now.** GitHub Actions minutes for this organization are
exhausted until August 9, so most pull requests are opened with CI skipped. Nothing is
watching your branch. If you did not run the commands and read the output, the change is
unverified, and you must say so rather than implying otherwise.

When you report results, paste the real output. Do not paraphrase a test summary you did
not see, and do not describe a run as green when it exited non-zero for a reason you have
not checked against section 5.

---

## 8. Conventions

- **TypeScript throughout.** Avoid `any`. Node >= 20.
- **Conventional commits**: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- **Changesets** for anything user-visible in a published package. `npm run changeset`,
  commit the generated file. Adding the changeset is your job; publishing is not.
- **Squash merge** is the merge style.
- **Match the surrounding code.** Do not reformat, rename, or "improve" code adjacent to
  your change. Every changed line should trace to the task you were given.
- **Tests live next to their subject** in `__tests__/` directories, named `*.test.ts`.
  Integration tests are `*.integration.test.ts` and live only in
  `packages/integration-tests`.
