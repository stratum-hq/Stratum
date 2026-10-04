---
"@stratum-hq/react": patch
---

Fix `PermissionEditor` Remove, and ask for confirmation first.

- Remove now sends the `policy_id` of the row in `DELETE /api/v1/tenants/:id/permissions/:policyId`. Before, it sent the source tenant ID, so the request did not name the policy.
- Remove asks for confirmation the same way `ConfigEditor` does. The first click shows the question with **Yes, remove** and **Keep**. Escape or **Keep** cancels and moves focus back to Remove.
- New message keys: `permissionEditor.removePrompt`, `permissionEditor.confirmRemoveButton`, `permissionEditor.keepButton`.
