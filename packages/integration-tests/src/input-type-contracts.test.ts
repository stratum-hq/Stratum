import { describe, it, expect } from "vitest";
import type { Stratum } from "@stratum-hq/lib";
import { TenantEvent } from "@stratum-hq/core";
import type {
  CreateTenantInput,
  SetConfigInput,
  CreatePermissionInput,
  CreateWebhookInput,
  PaginationInput,
  AuditLogQuery,
} from "@stratum-hq/core";

/**
 * Compile-time contract for the public input types. These assertions run as
 * trivial tests, but their real job is to make `tsc --noEmit` (the package
 * `typecheck`) fail if any of these types regress from the schema INPUT type
 * back to the OUTPUT type (`z.infer`), which would make every documented
 * happy-path call require fields that carry a Zod `.default()`.
 *
 * See stratum-hq/Stratum#166.
 */
describe("public input types are the schema INPUT (pre-defaults)", () => {
  it("createTenant accepts just name and slug", () => {
    // The exact documented happy-path call. Only compiles because parent_id,
    // config, metadata, and isolation_strategy are optional on the INPUT type.
    const input = {
      name: "Acme",
      slug: "acme",
    } satisfies Parameters<Stratum["createTenant"]>[0];
    // ...and the parameter type is CreateTenantInput.
    const asCore: CreateTenantInput = input;
    expect(asCore.slug).toBe("acme");

    // @ts-expect-error name and slug are still required (no defaults).
    const _missing = {} satisfies CreateTenantInput;
    void _missing;
  });

  it("setConfig accepts a value with no locked/sensitive flags", () => {
    const input = {
      value: 42,
    } satisfies Parameters<Stratum["setConfig"]>[2];
    const asCore: SetConfigInput = input;
    expect(asCore.value).toBe(42);
  });

  it("createPermission accepts just a key", () => {
    const input = { key: "billing.view" } satisfies CreatePermissionInput;
    expect(input.key).toBe("billing.view");
  });

  it("createWebhook accepts url, secret, and events without tenant_id", () => {
    const input = {
      url: "https://example.test/hook",
      secret: "at-least-sixteen-chars",
      events: [TenantEvent.TENANT_CREATED],
    } satisfies CreateWebhookInput;
    expect(input.events).toHaveLength(1);
  });

  it("pagination and audit-log queries accept an empty object", () => {
    const page = {} satisfies PaginationInput;
    const query = {} satisfies AuditLogQuery;
    expect(page).toEqual({});
    expect(query).toEqual({});
  });
});
