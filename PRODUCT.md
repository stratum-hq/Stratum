# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Backend and platform engineers at B2B SaaS companies, evaluating whether to adopt a
multi-tenancy library instead of hand-rolling `tenant_id` columns. They read code before
copy, check claims against the docs, and make the adoption decision in the docs and the
Playground rather than on the marketing page. MSP/MSSP-style hierarchies (reseller,
client, team) are a use case they may have, not a separate audience.

Developers embedding `@stratum-hq/react` into their own product are also users of that
package's styles: its components render inside someone else's design system.

## Product Purpose

Stratum is a drop-in multi-tenancy library for Node.js, published under `@stratum-hq` on
npm and MIT licensed. It is a library and a set of framework adapters, not an
application. It gives a team tenant hierarchy, config inheritance, permissions, audit and
GDPR tooling from day one, so they can start flat and grow into nested tenancy and
stronger isolation without a migration rewrite. Success is an engineer choosing Stratum
over building it themselves, and getting to a working hierarchy quickly.

## Positioning

Hierarchical tenancy as the core model: a tenant tree where config values inherit down
the ancestry and a parent can lock a key, with permission delegation
(LOCKED / INHERITED / DELEGATED) and cascade revocation. Isolation can move between
shared-table RLS, schema-per-tenant and database-per-tenant on PostgreSQL, with parallel
strategies for MongoDB and MySQL.

## Operating Context

- Surfaces: the marketing site `landing/` (stratum-hq.org), the Starlight docs
  `website/` (docs.stratum-hq.org) including the browser Playground, the
  `@stratum-hq/react` component package, and the demo dashboard `packages/demo/web`.
- Evaluation path: read the site, check the docs and comparisons, try the Playground or
  scaffold with `@stratum-hq/create`, then install.
- Live in production. `landing/` and `website/` deploy to Cloudflare Pages on every push
  to `main`; packages release to npm by tag.

## Capabilities and Constraints

- Tenant hierarchy in PostgreSQL (`ltree` materialized path); no depth limit enforced.
- Config inheritance with locks; ABAC permissions with delegation; audit log; GDPR
  Article 17 purge and Article 20 export; AES-256-GCM field encryption; webhooks with
  HMAC, retry and dead letter queue; scoped API keys and roles.
- Terminology to keep exact: package names are case-sensitive (`@stratum-hq/lib`), and
  state words are LOCKED, INHERITED, DELEGATED.
- `@stratum-hq/react` ships into other people's apps; its styles must not take over the
  host page.

## Brand Commitments

- The product name is Stratum. Tenantry, a separate proprietary product built on Stratum,
  does not appear on any Stratum surface.
- The visual identity is recorded in `DESIGN.md` (Bedrock).

## Evidence on Hand

- Integration test suites across PostgreSQL, MongoDB and MySQL in CI, and the security
  hardening releases in `CHANGELOG.md`.
- The browser Playground (docs.stratum-hq.org/playground/) and the `@stratum-hq/create`
  scaffolder.
- Blog posts ("The State of Multi-Tenancy in Node.js, Fall 2026", "Multi-Tenancy Security
  in the AI Era") and the `/compare` pages.
- Absent: customer logos, testimonials, adoption or download numbers. Do not invent them.

## Product Principles

- Show the model, don't describe it: the tenant tree and inheritance are the pitch.
- Every claim must match the code and the docs; mismatched numbers or install commands
  cost trust with an audience that checks.
- Let engineers try before they install.
- The library serves the host app: embedded components adapt to it, not the other way
  around.
