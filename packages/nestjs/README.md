# @stratum-hq/nestjs

First-class [NestJS](https://nestjs.com) integration for [Stratum](https://github.com/stratum-hq/Stratum) — a guard that resolves tenants from incoming requests, a `@Tenant()` parameter decorator, and a DI module.

## Installation

```bash
npm install @stratum-hq/nestjs @stratum-hq/sdk @stratum-hq/core
```

Peer dependencies: `@nestjs/common >= 10`, `@nestjs/core >= 10`, `reflect-metadata`.

## Quick Start

```typescript
import { Module } from "@nestjs/common";
import { StratumModule } from "@stratum-hq/nestjs";

@Module({
  imports: [
    StratumModule.forRoot({
      controlPlaneUrl: "http://localhost:3001",
      apiKey: "sk_live_your_key",
      jwtSecret: process.env.JWT_SECRET, // optional: enables JWT verification
      jwtClaimPath: "tenant_id",
    }),
  ],
})
export class AppModule {}
```

The module is `@Global()`, so import it once. Then use the guard and decorator in your controllers:

```typescript
import { Controller, Get, UseGuards } from "@nestjs/common";
import { StratumGuard, Tenant } from "@stratum-hq/nestjs";

@Controller("data")
@UseGuards(StratumGuard)
export class DataController {
  @Get()
  getData(@Tenant() tenant) {
    return { tenantId: tenant.tenant_id, config: tenant.resolved_config };
  }
}
```

## API

- **`StratumModule.forRoot(options)` / `forRootAsync(options)`** — register the SDK client for DI. `forRootAsync` supports `useFactory` + `inject` for config that depends on other providers (e.g. `ConfigService`).
- **`StratumGuard`** — resolves the tenant from the `X-Tenant-ID` header, a verified JWT claim, or custom `resolvers` (in that order). Sets `req.tenant` (full `TenantContext`), plus `req.impersonating` / `req.originalTenantId` when impersonation is enabled. Throws `UnauthorizedException` (401) if no tenant is found.
- **`@Tenant()`** — parameter decorator that extracts `req.tenant`.
- **`StratumContextInterceptor`** — binds the resolved context to AsyncLocalStorage so services can call `getTenantContext()` from `@stratum-hq/sdk` without the request object.

Optional `impersonation` and `resolvers` options let you support admin impersonation (`X-Impersonate-Tenant`) and subdomain-based resolution.

## Links

- Documentation: https://docs.stratum-hq.org/packages/nestjs/
- GitHub: https://github.com/stratum-hq/Stratum

## License

MIT © Christian Crank
