---
"@stratum-hq/control-plane": minor
---

Every 400 `VALIDATION_ERROR` about request fields now lists the failed fields in `error.details.issues`. Each item has `path`, `message` and `code`. Before, a zod failure used `error.issues`, a library `ValidationError` used `error.details.issues`, and the key and role routes used a top-level `details`. The old fields stay as deprecated copies for one release: `error.issues` on every such response, and the top-level `details` on the key and role routes. The deprecated copies now carry the same trimmed issues as `error.details.issues`, with only `path`, `message` and `code`. Before, they carried the raw zod issues, which have more fields that differ per issue code.

The error handler now finds a `StratumError` by its shape, not by `instanceof`. An error from a second copy of `@stratum-hq/core` keeps its status code, code and details.
