# Stratum + Next.js

Next.js 16 App Router application with Stratum multi-tenancy.

Tenants are resolved in `src/proxy.ts` from either:
- **Bearer token**: the `tenant_id` claim of an HS256 JWT that verifies with
  `JWT_SECRET` (for API clients and signed-in sessions)
- **Subdomain**: `acme.app.example.com` → tenant slug `acme`

The proxy forwards the result as a request header, so Server Components
can read it via `next/headers` without repeating the resolution logic. It
deletes any client-sent copy of that header first. The header names are in
`src/lib/tenant-headers.ts`.

## Prerequisites

- Node.js 20.9 or later (Next.js 16 needs it)
- PostgreSQL 15+

## Setup

```bash
npm install
```

Create a `.env.local` file:

```env
DATABASE_URL=postgres://user:pass@localhost:5432/mydb
ROOT_DOMAIN=app.example.com
JWT_SECRET=<output of: openssl rand -hex 32>
```

Keep `JWT_SECRET` out of source control. Without it, any request that sends a
bearer token fails.

## Run

**Development:**
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000).

**Production:**
```bash
npm run build
npm start
```

## Tenant routing

### Bearer token (authenticated requests)

The proxy verifies the token with `jose` and reads the `tenant_id` claim.
A token that does not verify, or that has no `tenant_id` claim, gets `401`.
Your identity provider or login route issues the token in a real application.
For local testing, sign one with the same secret:

```bash
TOKEN=$(node --input-type=module -e 'import { SignJWT } from "jose"; console.log(await new SignJWT({ tenant_id: process.argv[1] }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode(process.env.JWT_SECRET)))' "<uuid>")

curl -H "Authorization: Bearer $TOKEN" http://localhost:3000
```

### Subdomain routing (public tenant pages)

Set `ROOT_DOMAIN` to your base domain. Subdomains are extracted automatically:

```
acme.app.example.com      → tenant slug acme
northstar.app.example.com → tenant slug northstar
```

Wildcard DNS (`*.app.example.com → your server IP`) is required.

A subdomain selects which tenant's page to show. It does not prove that the
caller belongs to that tenant. Use the bearer token for anything that must be
limited to the tenant's own users.

### Why not an `X-Tenant-ID` header

A client can set any request header, so a tenant ID read from a client header
lets the caller choose any tenant. Read a tenant header only when a gateway you
control sets it and removes any copy the client sent. The `@stratum-hq/sdk`
middleware calls this `trustTenantHeader`.

## Architecture

```
Request
  └─ src/proxy.ts              Verify token or read subdomain, set request headers
       └─ src/app/page.tsx     Server Component: read headers, fetch from Stratum
            └─ src/lib/stratum.ts  Singleton Stratum instance (shared across requests)
```

## Extending

- Add more pages under `src/app/`. All Server Components can call `stratum.*` methods directly.
- For API routes, create `src/app/api/*/route.ts` files and import `{ stratum }` from `../lib/stratum`.
- To add caching, wrap `stratum.resolveConfig()` with `React.cache()` or Next.js's `unstable_cache`.
