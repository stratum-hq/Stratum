---
"@stratum-hq/control-plane": patch
---

An error below 500 that has no Stratum code now gets a code from its status, not `VALIDATION_ERROR`. The codes are `BAD_REQUEST` (400 and any unlisted status), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), and `RATE_LIMITED` (429). A Fastify schema validation error keeps `VALIDATION_ERROR`. A client that read `VALIDATION_ERROR` for a request body that is not valid JSON must now read `BAD_REQUEST`.
