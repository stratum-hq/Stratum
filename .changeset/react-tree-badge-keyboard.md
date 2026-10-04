---
"@stratum-hq/react": minor
---

`TenantTree` and `DraggableTenantTree` show the real isolation strategy and work by keyboard.

- The badge shows the isolation strategy of each tenant: `RLS`, `Schema` or `Database`. Before, every row showed `RLS`. The new message keys are `tenantTree.badgeSchema` and `tenantTree.badgeDatabase`; `tenantTree.badgeRls` keeps its meaning.
- Both trees follow the WAI-ARIA tree pattern. Exactly one tree item is in the tab order. ArrowUp, ArrowDown, Home and End move the focus. ArrowRight expands a tenant and then moves to its first child. ArrowLeft collapses a tenant and then moves to its parent. Enter calls `onSelect`.
- The focus now goes on the `treeitem` element. The tenant label is no longer a separate `role="button"` tab stop, and the expand toggle is out of the tab order. The row buttons are in the tab order of the active row only.
- The row buttons have an `aria-label` that names the tenant. The new message keys are `tenantTree.editTenant`, `tenantTree.addChild`, `tenantTree.archiveTenant` and `tenantTree.moveTenant`.
- Tenant names keep their own case in the body face, and the label `title` holds the full name when it is truncated. The toggle and the row buttons have a 24px target, and the tree has no text smaller than 11px.
- In the Bedrock theme, the rows settle once, on first mount, and do not move on hover.
