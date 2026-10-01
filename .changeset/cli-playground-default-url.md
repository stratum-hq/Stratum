---
"@stratum-hq/cli": patch
---

`stratum playground` warns again when it falls back to the default database URL, and names the URL it uses (without the password). The check compared against an old default, so the warning never appeared. (#476)
