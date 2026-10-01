---
"@stratum-hq/db-adapters": minor
---

Exports the policy checks that `createPolicy` uses: `tablePolicyIssues`, `tablePolicyWarnings`, `permissivePolicyIssue`, `isControlPlanePolicy`, `DEFAULT_CONTROL_ROLE` and the `PolicyRow` type. `@stratum-hq/cli` now uses them, so both apply the same rules (GHSA-mg93-96h7-h9fq).
