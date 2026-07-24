---
"@stratum-hq/lib": minor
---

Harden webhook egress validation to reject private, loopback, link-local, unspecified, and cloud-metadata targets across every address notation, including bracketed and IPv4-mapped IPv6 literals. Webhook deliveries now bind a timestamp into their signature for replay resistance, and a `verifyWebhookSignature` helper is exported so consumers can validate the signature and timestamp freshness of incoming deliveries.
