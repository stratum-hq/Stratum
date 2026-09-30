---
"@stratum-hq/core": minor
"@stratum-hq/lib": minor
---

Add the `tenant.activated` webhook event. `activateTenant` emits it once each time it moves a pending tenant to `active`. A failed activation emits no event. `TenantEvent.TENANT_ACTIVATED` is the new enum member, and webhooks can now subscribe to it.
