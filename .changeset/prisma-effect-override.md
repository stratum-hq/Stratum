---
"@stratum-hq/create": patch
---

The Prisma presets' generated `package.json` also overrides `effect`, a dependency of `@prisma/config` that every Prisma 7 release pins to 3.20.0, with 3.22.1 or a later 3.x release, which has no published high advisory. Projects that an earlier release generated do not change; to update one, add `"effect": "^3.22.1"` to its `overrides`.
