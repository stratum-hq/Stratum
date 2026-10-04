---
"@stratum-hq/react": minor
---

`ConfigEditor` can lock and unlock a key that the current tenant owns. A **Lock** or **Unlock** button is on each own row, and the add row has a **Lock for descendants** option. A key that an ancestor locked stays read-only and still says "Locked by {tenant}".

An edit of an own key keeps its lock and its sensitive flag. `setConfigValue` from `useConfig` and `HeadlessConfigEditor` takes an optional fourth argument, `sensitive`, and `ConfigWithInheritance` has an optional `sensitive` field.
