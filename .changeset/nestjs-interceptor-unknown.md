---
"@stratum-hq/nestjs": patch
---

`StratumInterceptor.intercept()` is now typed as returning `Observable<unknown>` instead of `Observable<any>`. Runtime behavior is unchanged.
