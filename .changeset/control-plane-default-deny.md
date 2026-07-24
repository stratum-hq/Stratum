---
"@stratum-hq/control-plane": minor
---

Enforce default-deny authorization on the control plane. Every route must declare its tenant scope; a route that declares none is refused, so a route added without a guard fails closed rather than serving data.
