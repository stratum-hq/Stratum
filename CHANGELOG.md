# Changelog

## 0.2.1 (2026-03-26)

Republish with all security fixes, integration tests, design overhaul, structured logging,
and bug fixes. The 0.2.0 release on npm was published from pre-fix sandbox code on Mar 22.
**If you are on 0.2.0, upgrade immediately** — it contains critical security issues.

Note: `@stratum-hq/react` is at 0.2.2 (0.2.1 was previously occupied on npm).

## 0.2.0 (2026-03-22) — DEPRECATED

### Security Fixes
- **fix(control-plane):** Verify JWT tenant_id claims against database — prevents tenant impersonation
- **fix(db-adapters):** Prevent RLS tenant context leak on connection pool reuse
- **fix(security):** Move demo bootstrap key out of migration path — no more hardcoded admin key in production
- **fix(security,gdpr):** Encrypt region database URLs, complete GDPR tenant purge (roles, cross-tenant permissions, audit logs)

### Bug Fixes
- **fix(lib):** Correct webhook column name `secret_encrypted` → `secret_hash` — webhook delivery was completely broken
- **fix(lib):** Use correct HKDF info string for key rotation — rotation was deriving the wrong AES key
- **fix(migrations):** Add idempotency guards (IF NOT EXISTS) to migrations 001, 004, 005
- **fix(migrations):** Renumber duplicate `002_sort_order.sql` to `014_sort_order.sql`
- **fix:** Update unit tests to match security fixes (RLS session, auth, retention)
- **fix:** Correct integration test assertions and GDPR purge type cast

### Features
- **feat:** Integration test package with 20 tests against real PostgreSQL 16
- **feat:** CI workflow for integration tests (`ci-integration.yml`)

### Design
- **design(landing):** Rebuild with geological warmth design system — SVG icons, asymmetric layouts, Instrument Sans
- **design(react):** Restyle components with sandstone/terracotta/slate palette
- **design(docs):** Apply geological warmth theme to Starlight docs site
- **design(landing):** Add scroll animations, breathing room, light mode contrast fixes
- **design(landing):** Optimize mobile responsiveness

### Documentation
- **docs:** Add DESIGN.md with geological warmth design system
- **docs:** Refresh README — add "Why not tenant_id?" section, update test counts
- **docs:** Fix Node.js prerequisite from >=18 to >=20 in installation guide
- **chore:** Add TODOS.md with full P0-P3 work tracking

## 0.1.0 (2026-03-19)

Initial release — built in sandbox environment.
