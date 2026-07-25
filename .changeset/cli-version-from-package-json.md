---
"@stratum-hq/cli": patch
---

Read the CLI `--version` string from `package.json` at runtime (#219, from the #133 v1.0 surface review).

`stratum --version` hardcoded `v0.2.1` while the package was `0.3.0`, so the reported version lied. It now reads the real version from the installed `package.json`.
