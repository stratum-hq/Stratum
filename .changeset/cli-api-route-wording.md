---
"@stratum-hq/cli": patch
---

`stratum init` and `stratum scaffold` now call the generated `app/api/stratum/[...path]/route.ts` the "Stratum API route" in their output and in the comments they write. "Proxy" now refers only to the Next.js 16 `proxy.ts` tenant check. `stratum init` names the file in which to implement `authorize()`. Behavior does not change.
