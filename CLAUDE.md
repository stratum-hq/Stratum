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
  an `ltree` column, plus a denormalized `depth` column. `pg_advisory_xact_lock` guards
  create and move so concurrent writes cannot corrupt the tree. See
  `packages/lib/src/migrations/001_init.sql` and
  `packages/lib/src/services/tenant-service.ts`.
  Note: `README.md` claims "max depth 20". No such limit is enforced anywhere in
  `packages/lib` or `packages/core`. Do not rely on it.
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

npm workspaces + Turborepo. All code lives in `packages/*`. Seventeen packages, fifteen of
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
| `@stratum-hq/compliance` | `packages/compliance` | Content-free compliance kernel: coverage scoring, a finding state machine, control types. Four source files, zero runtime dependencies, no database. |
| `@stratum-hq/stratum` | `packages/stratum` | **Empty.** An npm name reservation (currently 0.0.2) with a package.json, a README, and a LICENSE. No source, no build, no tests. Do not add code here without an explicit decision to make it a real package. |

### Private packages

| Package | Directory | Note |
|---|---|---|
| `@stratum-hq/demo` | `packages/demo` | MSSP hierarchy demo app: an Express-style API plus a Vite web front end. Not published. |
| `@stratum-hq/integration-tests` | `packages/integration-tests` | Integration tests against real PostgreSQL. Not published. Its `test` script is a no-op reminder; the real command is `test:integration`. |

Not workspace packages, but present at the repo root: `website/` (Starlight docs),
`landing/` (Astro marketing site), `examples/`, `docker/`, `scripts/`.

---

## 3. Commands

```bash
npm install          # or npm ci
npm run build        # turbo build, 15 tasks
npm test             # turbo test test:root, unit tests only, no database needed
npm run lint         # turbo lint lint:root, which is ESLint per package plus the root, 17 tasks
npm run typecheck    # turbo typecheck, tsc --noEmit per package
npm run verify       # lint + typecheck + test + build; the pre-push hook runs this
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

`npm test` runs the unit tests of every package that has a `test` script, plus the root
`test:root` task. The root task runs the repository policy tests in `scripts/__tests__/`.
Read the next section before you treat a green run as reassurance.

This file does not record test counts, because each change makes a recorded count wrong.
To get the current counts, run `npx turbo test --force --concurrency=2`. Vitest prints a
`Tests` line for each package.

### The important caveat

**No unit test in `@stratum-hq/lib` touches a real database.** All of them run without
Postgres.

Most test files in `packages/lib/src` stub the database layer entirely: they
`vi.mock("../../pool-helpers.js")` and use `makeMockPool()` from
`packages/lib/src/services/__tests__/test-helpers.ts`, which literally returns
`{} as import("pg").Pool`. Those tests assert on the **SQL strings the service passes to a
fake client**, not on what PostgreSQL does with them.

The rest, such as `crypto.test.ts`, `stratum-als.test.ts`, and `abac-service.test.ts`, are
genuine pure-logic tests of AES-256-GCM, AsyncLocalStorage context, policy evaluation, and
the public error surface. They are meaningful, and they are also not about the database.

What this means in practice:

- A green `npm test` proves the SQL string was **built** as expected. It does not prove the
  query is valid, that the schema has those columns, that `ltree` behaves as assumed, that
  a transaction rolls back, that RLS actually isolates, or that a constraint fires.
- A refactor that changes SQL text will fail these tests even when behavior is identical.
- A change that keeps the SQL text identical but breaks the schema will pass them.
- The only tests that exercise real database behavior are the ones in
  `packages/integration-tests` (plus the `src/__tests__/integration/` suites in `mysql` and
  `mongodb`), and they are not in `npm test`. CI runs them in `ci-integration.yml` and
  `ci-mongo-integration.yml`.

If you change anything that writes SQL, run the integration suite against a real database
before you claim the change works. Do not report "tests pass" as evidence that a
database-facing change is correct.

---

## 5. Known baseline, do not mistake it for your own regression

As of 2026-09-30 there are **no known failures** on `main`: `npm run verify` passes, and
`npm test` exits 0 across all 15 packages. If something fails, assume it is real until you
have checked it against `main`.

The earlier baseline items (the demo `localStorage` failures, PR CI covering only six
packages, and the stale `CONTRIBUTING.md` table) have all been fixed. When a new
known-broken item appears, list it here with the exact error, so the next person does not
mistake it for their own regression.

---

## 6. Forbidden actions

These are not style preferences. Violating any of them causes real, externally visible
damage.

### Releases follow one procedure, and only that one

`.github/workflows/publish.yml` triggers on `push: tags: ["v*"]` and **publishes every
non-private package in `packages/*` to npm** using OIDC trusted publishing. npm releases
cannot be unpublished cleanly, so a release is only ever cut this way.

The maintainer has authorized agents to cut releases (2026-09-30), following exactly
these steps:

1. **Version on a branch.** On a branch off up-to-date `main`, run `npx changeset version`,
   check the resulting version bumps and CHANGELOG entries, and open a
   `chore: version packages` pull request. Squash-merge it only once it is green.
2. **Gate on the merged commit.** On the merged `main` commit, run `npm run verify`,
   `npm run lint:secrets`, `npm run lint:deps`, and the integration suites, and read the
   output. Do not tag a commit you have not verified.
3. **Tag it deliberately.** Create an **annotated** tag on that exact `main` commit, named
   after the `@stratum-hq/lib` version (`vMAJOR.MINOR.PATCH`), with a message that names the
   packages and the headline changes:
   `git tag -a vX.Y.Z <sha> -m "Release vX.Y.Z (<packages>): <summary>"`.
4. **Push that one tag.** `STRATUM_RELEASE_TAG=vX.Y.Z git push origin refs/tags/vX.Y.Z`.
   The pre-push guard blocks every other tag push.
5. **Let the gates run.** `scripts/release-guard.sh` refuses tags that are lightweight,
   misnamed, or not on `main`. The `publish` job then waits for approval from a required
   reviewer on the `publish` environment. Watch the run to completion and confirm on npm
   that every intended package version is live.
6. **Security releases.** Publish the related GitHub security advisories, with their patched
   versions filled in, only after npm serves the patched versions.

Still never: `git push --tags`, `git push --follow-tags`, lightweight tags, tags on commits
that are not on `main`, moving or deleting a tag that has been pushed, or
`gh release create` / the GitHub UI to create a tag.

### Never publish manually

No `npm publish`. No `npm run release`. No `changeset publish`. Publishing is the tag
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
- Delete, skip, or weaken a failing test to make `npm test` green. Fix the cause properly
  or leave the test alone.

---

## 7. The verification contract

The gate is `npm run verify`, which runs **lint + typecheck + test + build**. The pre-push
hook (`.githooks/pre-push`, installed by the root `prepare` script) runs the
forbidden-action guards first, then `verify`, and blocks the push if either fails.

Two guardrail checks are **not** part of `verify`, the hooks, or any CI workflow yet, so
run them yourself:

```bash
npm run verify        # expect exit 0
npm run lint:secrets  # expect exit 0
npm run lint:deps     # expect exit 0; needs the network
```

`npm run lint:secrets:staged` is the variant that reads the index rather than the working
tree, for use in a hook.

The last two are the guardrails, and they fail in opposite ways, which is worth knowing
before you hit one.

`lint:secrets` is **not** a ratchet. It expects zero and has no regenerate command on
purpose. A finding is either a false positive, which you record by hand in
`scripts/secret-allowlist.json` with a reason, or an incident, which you rotate. The demo
stack's global-admin bootstrap key is already allowlisted, with the reasoning written out;
do not add to that list casually. See `docs/secret-scanning.md`.

`lint:deps` **is** a ratchet over the current `npm audit` counts, per severity, split into
`runtime` and `all`. It fails when a count rises, and it also fails when a count falls,
until you run `npm run lint:deps:write` and commit the baseline. Failing on improvement is
deliberate: it is what makes the number go down instead of the baseline going stale. Do not
regenerate it to make a rise go away without saying so in the PR. It needs the network,
and it records counts only because this repository is public. See
`docs/dependency-policy.md`.

CI (`ci.yml`) runs lint, typecheck, build, and the full unit suite on every pull request,
and `ci-integration.yml` / `ci-mongo-integration.yml` run the database suites. CI does not
run `lint:secrets`, `lint:deps`, or the Storybook build in `packages/react-ui`, so a green
PR check says nothing about those. If you did not run the commands and read the output, the
change is unverified, and you must say so rather than implying otherwise.

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
