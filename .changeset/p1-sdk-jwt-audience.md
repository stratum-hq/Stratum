---
"@stratum-hq/sdk": minor
"@stratum-hq/nestjs": minor
---

Add optional `jwtAudience` and `jwtIssuer` options to the SDK middleware and the NestJS guard; when set, tokens whose `aud` or `iss` claim does not match are rejected (GHSA-p3jw-vw8m-3rqr).
