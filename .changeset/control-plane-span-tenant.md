---
"@stratum-hq/control-plane": patch
---

Request spans now carry the `stratum.tenant_id` attribute for authenticated callers, with API keys and with JWTs. The hook read the tenant before authentication ran, so the attribute was never set. Spans also record the request path without its query string in the span name, `http.url`, and `http.route`.
