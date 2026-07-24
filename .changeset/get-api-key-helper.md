---
"@stratum-hq/lib": minor
---

Add `getApiKey(id)` to look up a single API key by id, including its owning tenant. Returns null when no key has that id. The primitive for authorizing operations that target an API key by id whose owning tenant is not otherwise in the request (for example scoping role assignment to the key's tenant).
