# @stratum-hq/core

Shared foundation for all [Stratum](https://github.com/stratum-hq/Stratum) packages — TypeScript types, Zod validation schemas, error classes, utility functions, and constants. Every other Stratum package depends on it.

## Installation

```bash
npm install @stratum-hq/core
```

You usually get this transitively as a dependency of `@stratum-hq/lib` or `@stratum-hq/sdk` rather than installing it directly.

## Usage

```typescript
import {
  IsolationStrategy,
  PermissionMode,
  SlugSchema,
  buildAncestryPath,
  TenantNotFoundError,
  type TenantNode,
  type TenantContext,
} from "@stratum-hq/core";

// Enums
IsolationStrategy.SHARED_RLS; // "SHARED_RLS"
PermissionMode.LOCKED;        // "LOCKED"

// Zod schemas — validate untrusted input
SlugSchema.parse("acme_corp"); // passes
SlugSchema.parse("INVALID");   // throws ZodError

// Ancestry helpers
buildAncestryPath("/parent-uuid", "child-uuid"); // "/parent-uuid/child-uuid"

// Typed errors extend StratumError → Error
try {
  /* ... */
} catch (err) {
  if (err instanceof TenantNotFoundError) { /* ... */ }
}
```

## What's Exported

- **Types** — `TenantNode`, `TenantContext`, `ResolvedConfigEntry`, `ResolvedPermission`, `CreateTenantInput`, `SetConfigInput`, `AuditEntry`, `ConsentRecord`, `Region`, `AbacPolicy`, and more.
- **Enums** — `IsolationStrategy` (`SHARED_RLS`, `SCHEMA_PER_TENANT`, `DB_PER_TENANT`), `PermissionMode` (`LOCKED`, `INHERITED`, `DELEGATED`), `RevocationMode` (`CASCADE`, `SOFT`, `PERMANENT`), `TenantStatus`.
- **Zod schemas** — `SlugSchema`, `UUIDSchema`, `PaginationSchema`, `CreateTenantInputSchema`, `SetConfigInputSchema`, `CreatePermissionInputSchema`, `AuditLogQuerySchema`, and their input types.
- **Ancestry utilities** — `buildAncestryPath`, `parseAncestryPath`, `getDepth`, `isAncestorOf`, `isDescendantOf`, `getAncestorIds`.
- **Errors** — `StratumError` plus `TenantNotFoundError`, `ConfigLockedError`, `PermissionRevocationDeniedError`, `IsolationViolationError`, `UnauthorizedError`, `ForbiddenError`, and others.
- **Constants** — `MAX_SLUG_LENGTH` (63), `DEFAULT_CACHE_TTL_MS`, `DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE`, `API_KEY_PREFIX`, `TENANT_HEADER`.

## Links

- Documentation: https://docs.stratum-hq.org/packages/core/
- GitHub: https://github.com/stratum-hq/Stratum

## License

MIT © Christian Crank
