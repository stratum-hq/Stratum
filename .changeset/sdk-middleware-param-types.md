---
"@stratum-hq/sdk": patch
---

Tighten the middleware parameter types from `any` to minimal structural types.

`expressMiddleware` and `fastifyPlugin` previously typed their framework arguments (`req`/`res`/`next` and `fastify`/`request`/`reply`/`done`) as `any`. They now use small structural `*Like` types so the SDK keeps no hard dependency on `express`/`fastify` types. This is a backward-compatible, type-only refinement with no runtime change: real Express and Fastify objects still satisfy the shapes.
