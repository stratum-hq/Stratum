---
"@stratum-hq/lib": minor
---

Re-export Stratum's typed error classes as runtime values from the `@stratum-hq/lib` public entry (FR-52).

`@stratum-hq/lib` previously re-exported core's error types only via `export type`, so the error classes were not available as runtime values and could not be used with `instanceof`. Consumers had to import them from `@stratum-hq/core` directly (or match error-message substrings). Every error class in the hierarchy (`StratumError` and its subclasses, plus the `ErrorCode` enum) is now importable as a value:

```ts
import { StratumError, TenantNotFoundError } from "@stratum-hq/lib";

try {
  await stratum.tenants.get(id);
} catch (err) {
  if (err instanceof TenantNotFoundError) {
    // ...
  }
}
```
