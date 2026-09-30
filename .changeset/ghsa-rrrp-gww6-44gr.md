---
"@stratum-hq/cli": minor
"@stratum-hq/create": minor
"@stratum-hq/react": minor
"@stratum-hq/test-utils": minor
---

Harden defaults in generated projects, CLI checks, React hooks and test helpers (GHSA-rrrp-gww6-44gr). Behavior changes: `StratumProvider`'s `apiKey` is optional and generated React code uses a server-side proxy instead; `TenantThemeProvider` ignores `customCss` that is not plain declarations; `assertConfigInheritance` now takes a Stratum instance instead of a pg pool.
