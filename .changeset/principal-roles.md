---
"@stratum-hq/lib": minor
---

Add principal-agnostic role assignment: `assignRole(principalType, principalId, roleId)`, `removeRole(...)`, and `resolvePrincipalScopes(...)`. Roles could previously only attach to API keys (`assignRoleToKey`/`resolveKeyScopes`); these let any principal (an application user, a service account) hold a role and resolve its effective scopes via a new `principal_roles` table (migration 018). `resolvePrincipalScopes` fails closed, returning `[]` when a principal has no role. The primitive for application-user RBAC on top of Stratum roles.
