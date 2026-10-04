---
"@stratum-hq/react": patch
---

`PermissionEditor` offers Remove only on the current tenant's own policies, and names the tenant that set each policy.

- An ancestor's policy no longer shows Remove, because the API deletes only the current tenant's own policies. The row says **Set by {tenant}** instead.
- The Source column shows the tenant name, with the same ancestors lookup as `ConfigEditor`. It shows a short tenant ID when that request fails.
- Add and remove errors use plain language, with the raw error message as the toast detail.
- `usePermissions` and `HeadlessPermissionEditor` return each permission with an optional `source_tenant_name`. The new exported type is `PermissionWithSource`.
- New message keys: `permissionEditor.setBy`, `permissionEditor.addFailed`, `permissionEditor.removeFailed`.
