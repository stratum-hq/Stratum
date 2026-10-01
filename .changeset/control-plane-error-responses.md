---
"@stratum-hq/control-plane": minor
---

Make the control plane's error responses match its docs. (#472)

- **Breaking for clients of `PUT /api/v1/tenants/:id/config/batch`:** a batch that is rolled back is no longer answered with `200 OK`. A key locked by an ancestor gets `403 CONFIG_LOCKED`, the status of a single locked write, and an invalid entry gets `400 VALIDATION_ERROR`. Nothing is written in either case, and `error.details` holds the per-key result (`results`, `succeeded`, `failed`, `rolled_back: true`). A batch that is written in full still gets `200 OK` with the same result.
- A path id that is not a UUID, on any route, gets `400 VALIDATION_ERROR` instead of `500`. A caller without credentials still gets `401` first.
- A path that matches no route gets the documented `{ "error": { "code": "NOT_FOUND", ... } }` body. It is still `401` before authentication.
- A 5xx response is logged through the Fastify logger, with the request id, in every environment, not only when `NODE_ENV` is `development`. The client still gets no detail of the cause.
- Startup prints "Running migrations..." once.
- The docs now give `CONFIG_LOCKED` its real status, 403, which is unchanged.
