---
"@stratum-hq/sdk": patch
---

Remove the unused `lru-cache` dependency. The SDK cache in `src/cache.ts` has its own implementation, so installs of `@stratum-hq/sdk` no longer pull in `lru-cache`.
