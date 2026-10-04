---
"@stratum-hq/react": patch
---

`Skeleton` takes its corner radius only from `--stratum-radius-sm`. It no longer carries a 4px fallback, so the theme alone sets its corners.
