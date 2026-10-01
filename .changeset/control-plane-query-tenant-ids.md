---
"@stratum-hq/control-plane": patch
---

A query-string tenant id (`tenant_id`, `tenant_a`, `tenant_b`) that is not a UUID now gets 400 `VALIDATION_ERROR` instead of a 500, after authentication and before any lookup. The error lists one issue per bad parameter, with the path `["query", "<name>"]`. This covers `GET /api/v1/webhooks`, `GET /api/v1/api-keys`, `GET /api/v1/roles`, `GET /api/v1/audit-logs` and `GET /api/v1/config/diff`. (GHSA-mg93-96h7-h9fq)
