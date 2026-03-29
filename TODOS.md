# Stratum — Outstanding Work

Last updated: 2026-03-27
Source: CEO review (/plan-ceo-review) + eng review (/plan-eng-review)

## P0 — Critical (shipping blockers)

All P0 items have been fixed via PRs #29-#35. Merge all 7 fix branches to close these:

- [x] ~~Webhook column mismatch~~ → PR #29
- [x] ~~Key rotation HKDF info mismatch~~ → PR #30
- [x] ~~JWT tenant_id trusted without verification~~ → PR #31
- [x] ~~RLS tenant context leak on connection reuse~~ → PR #32
- [x] ~~Demo admin key hardcoded in migrations~~ → PR #33
- [x] ~~Region database_url stored in plaintext~~ → PR #34
- [x] ~~GDPR purge incomplete (roles, source_tenant_id, audit logs)~~ → PR #34
- [x] ~~Migration idempotency guards missing~~ → PR #35
- [x] ~~Duplicate 002_ migration prefix~~ → PR #35

## P1 — High Priority (DX Sprint — CEO review 2026-03-27)

- [x] ~~Write integration test suite for critical paths~~ → PR #37 (5 test suites: tenant-lifecycle, config-inheritance, webhook-delivery, GDPR-purge, key-rotation)
- [x] ~~Add CI E2E pipeline~~ → PR #37 (ci-integration.yml — postgres:16-alpine, runs integration tests)
- [x] ~~Update design doc Phase 1.2~~ — moot (DESIGN.md moved to local-only)
- [x] ~~Default DATABASE_URL uses superuser~~ — changed to `stratum_app` in connection.ts and db.ts
- [x] ~~Tenant list endpoint bypasses scope guard~~ → PR #42 (route handler filters by apiKey.tenant_id + ancestry_path)
- [x] ~~Fix BYPASSRLS hard-fail for dev-mode quickstart~~ — conditional check: warning in dev, hard-fail when stratum.enforce_rls=on
- [x] ~~Resolve migration package boundary for autoMigrate~~ — migrations moved from control-plane to lib (16 SQL files + runner)
- [x] ~~Create examples/ directory~~ — quickstart, flat-tenancy, with-express, with-nextjs, with-hono
- [x] ~~Fix README install instructions~~ — changed to `npm install @stratum-hq/lib pg`

## P2 — Medium Priority

- [x] ~~Add Redis service to docker-compose.yml~~ — already existed in docker-compose.yml
- [x] ~~Config inheritance: archived parent lock disagreement~~ → PR #42
- [x] ~~No circular parent detection~~ → PR #42
- [x] ~~No structured logging in lib package~~ → PR #43
- [x] ~~Webhook routes inconsistent access control~~ → PR #45
- [x] ~~Connection pool has no queue depth limit~~ → PR #46
- [x] ~~Pool eviction race condition~~ → PR #46
- [x] ~~Add changesets for monorepo version management~~ — @changesets/cli installed, configured with access: public, baseBranch: master
- [x] ~~Docker-compose quickstart with pre-loaded extensions~~ — init-extensions.sql mounted into test-db container
- [x] ~~Docs getting-started rewrite~~ — progressive disclosure: flat first, autoMigrate, hierarchy second
- [x] ~~Distribution — launch blog post + comparison page~~ — blog/why-we-built-stratum + /compare pages created
- [x] ~~GitHub repo polish~~ — CONTRIBUTING.md, SECURITY.md, issue templates (bug report + feature request)
- [x] ~~Flat-tenancy convenience API~~ — createOrganization(), listOrganizations(), getOrganization() on Stratum class
- [x] ~~autoMigrate option on Stratum constructor~~ — initialize() with promise mutex, advisory lock, enforceRls support

## P3 — Nice to Have

- [x] ~~SSRF TOCTOU gap in webhook delivery~~ → PR #48 (redirect blocking + timeout)
- [x] ~~Key rotation: single-transaction locking~~ → PR #49 (batched with SKIP LOCKED)
- [x] ~~Key rotation: no dual-key read support~~ → PR #49 (STRATUM_ENCRYPTION_KEY_PREVIOUS fallback)
- [x] ~~HKDF salt is all-zeros~~ → PR #48 (configurable via STRATUM_HKDF_SALT)
- [x] ~~React UI: 0 unit tests~~ → PR #47 (19 snapshot + behavior tests for top 5 components)
- [x] ~~CLI: verify scaffold/scan/playground commands work~~ → PR #50 (all functional, version string fixed)
- [x] ~~Reserve `@stratum-hq/stratum` npm package name~~ → PR #56 (stub package created, npm publish pending 2FA)
- [x] ~~Browser-based playground~~ → PR #67 (PGlite WASM Postgres + CodeMirror, 4 scenario tabs, runs in browser on Cloudflare Pages)
- [x] ~~`npx @stratum-hq/create` scaffolding~~ → PR #58 (express/fastify/nextjs templates, project name validation)

- [ ] **Differentiate landing page visual rhythms** — index.astro, what-is-stratum.astro, and compare.astro share identical eyebrow->H1->intro structure, making the site feel template-generated. Give each page its own visual entry point. Depends on Nav/Footer component extraction. (human: 1 day / CC: 20 min)

## P4 — Future Expansion (gleaned from competitive analysis)

Source: Competitive analysis of [lanemc/multi-tenant-saas-toolkit](https://github.com/lanemc/multi-tenant-saas-toolkit) — 2026-03-27

- [x] ~~Sequelize adapter~~ → PR #57 (transaction-wrapping for tenant isolation, SequelizeLike structural interface, 13 tests). Mongoose deferred — requires MongoDB rearchitecture.
- [x] ~~ABAC policy engine~~ → PR #60 (hierarchical ABAC with 9 operators, LOCKED/INHERITED/DELEGATED modes, deny-overrides-allow, migration 017, control-plane routes, 14 unit tests)
- [x] ~~NestJS support~~ → PR #59 (StratumGuard, @Tenant() decorator, StratumModule.forRoot/forRootAsync, impersonation, custom resolvers, 14 tests)
- [x] ~~"30-second quickstart" marketing~~ → PR #56 (README hero rewritten with flat-tenancy 5-line quickstart, autoMigrate emphasis)

## P5 — Ecosystem Gaps (gleaned from ecosystem research 2026-03-29)

Source: Analysis of 204 npm packages, 6 GitHub repos, community threads, blog posts. Blog post: /blog/the-state-of-multi-tenancy-in-nodejs

### SDK Expansion (widen the moat)
- [ ] **Drizzle ORM adapter** — Drizzle is the fastest-growing Node.js ORM (2025-2026). morka17/multi-tenant-user-role-base-app uses it. No multi-tenancy adapter exists on npm. First-mover opportunity. (human: 1 week / CC: 2 hours)
- [ ] **Hono framework middleware** — Hono is gaining adoption for edge/serverless. No existing multi-tenancy middleware. Would complement the Express/Fastify/NestJS set. (human: 3 days / CC: 1 hour)
- [ ] **Mongoose adapter** — Deferred from P4. mongo-tenant (68 months abandoned, 4,743 dl/wk from inertia alone) proves demand exists. MongoDB rearchitecture required. (human: 2 weeks / CC: 4 hours)

### DX Improvements (reduce friction)
- [ ] **AsyncLocalStorage tenant context** — The 2026 community consensus: AsyncLocalStorage is the correct way to propagate tenant context through async call chains. Stratum currently requires passing pool/tenant explicitly. Add opt-in ALS-based context so downstream code can call `Stratum.currentTenant()` without prop-drilling. (human: 1 week / CC: 2 hours)
- [ ] **Cross-tenant isolation test helpers** — Only 1 source in our entire survey explicitly tests that tenant A cannot read tenant B's data. Ship a `@stratum-hq/test-utils` package with helpers: `assertIsolation(tenantA, tenantB, table)`, `assertConfigInheritance(parent, child)`, etc. (human: 3 days / CC: 1 hour)
- [ ] **Migration runner for N tenant schemas** — Zero community sources address running ALTER TABLE across 500 tenant schemas. Stratum's schema-per-tenant mode needs a `migrateAllSchemas()` utility that runs migrations idempotently across all tenant schemas with progress reporting. (human: 1 week / CC: 2 hours)

### Content and SEO (own the search results)
- [ ] **Comparison pages for each ORM** — "prisma multi tenant", "sequelize multi tenant", "knex multi tenant" are all high-intent search terms with no good answers. Create landing pages: /compare/prisma, /compare/sequelize, /compare/drizzle showing how Stratum works with each. (human: 1 week / CC: 2 hours)
- [ ] **"Multi-tenancy checklist" interactive tool** — A checklist page on the docs site: "Do you need tenant hierarchy? Config inheritance? GDPR? Schema isolation?" with checkboxes that show which Stratum features match. SEO bait + lead qualification. (human: 3 days / CC: 1.5 hours)

### Architecture (long-term)
- [ ] **Connection pooler integration guide** — Every separate-DB tutorial uses unbounded in-process LRU caches. Document how Stratum works with PgBouncer/Supavisor for production connection management. (human: 2 days / CC: 1 hour)
- [ ] **Cost calculator for isolation strategies** — Nobody in the ecosystem quantifies the cost of separate-DB vs shared-RLS at 100/1000/10000 tenants. Build a simple calculator page: input tenant count, get estimated infra cost per strategy. (human: 3 days / CC: 1.5 hours)
