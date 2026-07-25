---
"@stratum-hq/lib": minor
---

feat: add `getTenantBySlug` for indexed slug lookups

`getTenantBySlug(slug, includeArchived?)` resolves a tenant by its globally
unique slug in a single indexed lookup on the `slug` column, the slug-keyed
counterpart to `getTenant`. Consumers that hold a slug no longer have to scan
the unindexed `listTenants` / `listOrganizations` pages. It mirrors `getTenant`
exactly: throws `TenantNotFoundError` when no row matches, and (unless
`includeArchived` is set) `TenantArchivedError` / `TenantSuspendedError` for a
non-active row.
