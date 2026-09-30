---
"@stratum-hq/core": patch
---

Deprecate `TenantEvent.TENANT_PURGED` (`tenant.purged`). `purgeTenant` never emits this event, because the purge erases the event log of the tenant with the tenant itself. A webhook can still subscribe to it, but it receives no delivery. The next major version removes it.
