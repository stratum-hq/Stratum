---
"@stratum-hq/control-plane": minor
---

Global operator API keys now receive tenant-state errors (403 `TENANT_SUSPENDED`, 410 `TENANT_ARCHIVED`, 409 `TENANT_PENDING`) on config, permission, webhook and consent writes to a tenant that is not active, and usage events are refused for a tenant that is not active (GHSA-54ff-f8q6-8mfx).
