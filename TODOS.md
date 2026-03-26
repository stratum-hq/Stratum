# Stratum — Outstanding Work

Last updated: 2026-03-26
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

## P1 — High Priority

- [ ] **Write integration test suite for critical paths** — All existing 417 tests use mocked DB pools. Need NEW integration tests that run against real PostgreSQL for: tenant CRUD, config inheritance, webhook delivery, RLS isolation, GDPR purge, key rotation. (human: 1 week / CC: 1-2 hours)
- [ ] **Add CI E2E pipeline** — GitHub Actions workflow that spins up postgres:16-alpine, runs migrations, executes integration tests. Prevents regression to sandbox-quality code. (human: 2 hours / CC: 15 min)
- [ ] **Update design doc Phase 1.2** — Reframe from "run existing tests against real Postgres" to "write new integration test suite." Existing unit tests are mock-based and valid for logic validation only. (human: 30 min / CC: 5 min)
- [ ] **Default DATABASE_URL uses superuser** — connection.ts:12 falls back to `stratum` superuser which bypasses all RLS. Should default to `stratum_app` (NOBYPASSRLS). (human: 1 hour / CC: 5 min)
- [ ] **Tenant list endpoint bypasses scope guard** — GET /api/v1/tenants/ with a scoped API key can enumerate ALL tenants because fromParamId returns null when there's no :id param. (human: 2 hours / CC: 15 min)

## P2 — Medium Priority

- [x] ~~Add Redis service to docker-compose.yml~~ — already existed in docker-compose.yml
- [x] ~~Config inheritance: archived parent lock disagreement~~ → PR #42
- [x] ~~No circular parent detection~~ → PR #42
- [x] ~~No structured logging in lib package~~ → PR #43
- [x] ~~Webhook routes inconsistent access control~~ → PR #45
- [x] ~~Connection pool has no queue depth limit~~ → PR #46
- [x] ~~Pool eviction race condition~~ → PR #46
- [ ] **Add changesets for monorepo version management** — No automated changelog or semantic versioning. (human: 2 hours / CC: 15 min)

## P3 — Nice to Have

- [x] ~~SSRF TOCTOU gap in webhook delivery~~ → PR #48 (redirect blocking + timeout)
- [x] ~~Key rotation: single-transaction locking~~ → PR #49 (batched with SKIP LOCKED)
- [x] ~~Key rotation: no dual-key read support~~ → PR #49 (STRATUM_ENCRYPTION_KEY_PREVIOUS fallback)
- [x] ~~HKDF salt is all-zeros~~ → PR #48 (configurable via STRATUM_HKDF_SALT)
- [x] ~~React UI: 0 unit tests~~ → PR #47 (19 snapshot + behavior tests for top 5 components)
- [x] ~~CLI: verify scaffold/scan/playground commands work~~ → PR #50 (all functional, version string fixed)
