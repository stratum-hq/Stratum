---
"@stratum-hq/lib": minor
---

Config, permission, webhook, consent, ABAC policy, tenant role, role assignment and usage writes now require an active tenant and throw TenantSuspendedError, TenantArchivedError or TenantPendingError otherwise; removals and webhook deactivation still work (GHSA-54ff-f8q6-8mfx).
