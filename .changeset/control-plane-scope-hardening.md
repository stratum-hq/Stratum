---
"@stratum-hq/control-plane": patch
---

Harden control-plane authorization. Admin-scope enforcement is evaluated from the resolved request path. Tenant creation is confined to the caller's key scope: a tenant-scoped key may only create tenants within its own subtree and may not create new root tenants, while global (operator) keys remain unrestricted. The batch create route is authorized the same way as single create.
