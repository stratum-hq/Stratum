---
"@stratum-hq/cli": patch
---

The policy checks of `doctor` and `scan` recognize the policies of `@stratum-hq/lib` migration 032: the legacy form of `tenant_isolation`, and a `stratum_control_plane` policy that applies to exactly the control role (from the `stratum.control_role` setting of the connection, default `stratum_control`). `doctor` reports whether the control-role hardening is active.
