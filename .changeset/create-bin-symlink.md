---
"@stratum-hq/create": patch
---

`npx @stratum-hq/create <name>` now runs the scaffolder. Before this fix, the command exited 0 and did nothing when npm ran the bin through its `node_modules/.bin` symlink. The `create-stratum` bin is now `dist/bin.js`, which always calls `main()`.
