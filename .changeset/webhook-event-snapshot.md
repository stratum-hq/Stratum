---
"@stratum-hq/lib": minor
---

An event goes only to the webhooks that existed when Stratum recorded the event. A webhook registered after an event no longer gets a delivery for that event when the background emission runs later.
