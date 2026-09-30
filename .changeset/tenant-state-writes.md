---
"@stratum-hq/lib": minor
---

Config, permission, webhook and consent writes now require an active tenant and throw TenantSuspendedError, TenantArchivedError or TenantPendingError otherwise; removals still work (GHSA-54ff-f8q6-8mfx).
