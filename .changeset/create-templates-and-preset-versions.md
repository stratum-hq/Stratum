---
"@stratum-hq/create": minor
---

The `express` and `fastify` templates now generate the tenant middleware the docs describe: the tenant comes from the `tenant_id` claim of a bearer token verified with `JWT_SECRET` (HS256, using `jose`, now a dependency of every template), and `GET /tenants` answers 401 without one. The servers are the same as the express and fastify presets write. The generated README no longer points these templates at a `src/middleware.ts` that does not exist.

The Drizzle presets now pin `drizzle-orm ^0.45.3` and `drizzle-kit ^0.31.11`, override the esbuild that drizzle-kit pulls in through `@esbuild-kit/core-utils` to `^0.25.4`, and generate the `src/schema.ts` that `drizzle.config.ts` points at. On PostgreSQL, `drizzle.config.ts` connects with `DATABASE_ADMIN_URL` when it is set.

Generated dependency ranges now start past published advisories: `fastify ^5.12.5` (was `^4.26.0`, a major upgrade), `express ^4.22.3`, `hono ^4.13.7`, `@hono/node-server ^1.19.15`, `@nestjs/core`, `@nestjs/common` and `@nestjs/platform-express ^11.1.18`, `mongoose ^8.24.1`, `mysql2 ^3.23.1`, and `tsx ^4.19.3`.

An invalid `--preset` now exits before anything is written, so it no longer leaves an empty project directory, and with `--force` it no longer removes the existing one.
