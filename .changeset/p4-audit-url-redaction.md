---
"@stratum-hq/lib": minor
---

Webhook and region audit entries record URLs as `scheme://host/` plus a path fingerprint (`#fp=` and the first 12 hex characters of sha256 of the path), or `[REDACTED]` for a URL without a host; migration 030 applies the same form to existing audit rows, and webhook URL validation errors no longer echo the full URL (GHSA-jx2p-pffr-c5gh).

Upgrade note: migration 030 scrubs audit rows only. Region rows whose `control_plane_url` already contains credentials keep that value in the `regions` table; update those regions with a URL that has no credentials.
