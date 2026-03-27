# Stratum + Next.js

Next.js 14 App Router application with Stratum multi-tenancy.

Tenants are resolved at the edge in `src/middleware.ts` from either:
- **Subdomain** — `acme.app.example.com` → tenant slug `acme`
- **Header** — `X-Tenant-ID: <uuid>` (for API or internal requests)

The resolved tenant identifier is forwarded as a response header so that
Server Components can read it via `next/headers` without repeating the
resolution logic.

## Prerequisites

- Node.js 20+
- PostgreSQL 15+

## Setup

```bash
npm install
```

Create a `.env.local` file:

```env
DATABASE_URL=postgres://user:pass@localhost:5432/mydb
ROOT_DOMAIN=app.example.com
```

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

### Subdomain routing (recommended for production)

Set `ROOT_DOMAIN` to your base domain. Subdomains are extracted automatically:

```
acme.app.example.com      → x-tenant-slug: acme
northstar.app.example.com → x-tenant-slug: northstar
```

Wildcard DNS (`*.app.example.com → your server IP`) is required.

### Header routing (useful for development and APIs)

Pass `X-Tenant-ID` with a valid tenant UUID:

```bash
curl -H "X-Tenant-ID: <uuid>" http://localhost:3000
```

## Architecture

```
Request
  └─ src/middleware.ts         Edge: resolve tenant slug/ID, set headers
       └─ src/app/page.tsx     Server Component: read headers, fetch from Stratum
            └─ src/lib/stratum.ts  Singleton Stratum instance (shared across requests)
```

## Extending

- Add more pages under `src/app/` — all Server Components can call `stratum.*` methods directly.
- For API routes, create `src/app/api/*/route.ts` files and import `{ stratum }` from `../lib/stratum`.
- To add caching, wrap `stratum.resolveConfig()` with `React.cache()` or Next.js's `unstable_cache`.
