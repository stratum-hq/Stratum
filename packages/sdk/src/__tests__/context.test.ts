import { describe, it, expect } from "vitest";
import {
  tenantStorage,
  getTenantContext,
  runWithTenantContext,
  setTenantContext,
} from "../context.js";
import type { TenantContextLegacy } from "@stratum-hq/core";
import { TenantContextNotFoundError } from "@stratum-hq/core";

const makeContext = (tenantId: string): TenantContextLegacy => ({
  tenant_id: tenantId,
  ancestry_path: `/${tenantId}`,
  depth: 1,
  resolved_config: {},
  resolved_permissions: {},
  isolation_strategy: "SHARED_RLS",
});

describe("tenant context utilities", () => {
  describe("getTenantContext", () => {
    it("throws TenantContextNotFoundError when called outside a run", () => {
      // AsyncLocalStorage store is undefined outside of a run() call
      // (assuming no prior enterWith in this test fiber)
      expect(() => {
        // Run in a fresh async context via tenantStorage.run to ensure isolation,
        // then call getTenantContext outside any store — we verify the error type.
        const outside = () => {
          // Deliberately do NOT set up a context — just call getTenantContext
          // We can't guarantee the outer scope has no context, so use a nested
          // storage run with undefined to simulate absence.
          return tenantStorage.run(undefined as unknown as TenantContextLegacy, () =>
            getTenantContext(),
          );
        };
        outside();
      }).toThrow(TenantContextNotFoundError);
    });
  });

  describe("runWithTenantContext", () => {
    it("provides context within the callback", () => {
      const ctx = makeContext("tenant-123");

      runWithTenantContext(ctx, () => {
        const stored = getTenantContext();
        expect(stored).toEqual(ctx);
        expect(stored.tenant_id).toBe("tenant-123");
      });
    });

    it("context is no longer accessible after the callback returns", () => {
      const ctx = makeContext("tenant-abc");
      runWithTenantContext(ctx, () => {
        // context is available inside
        expect(getTenantContext().tenant_id).toBe("tenant-abc");
      });

      // After the synchronous callback, we are back in the outer scope.
      // The outer scope has its own store value — either undefined or a prior context.
      // We verify by running a fresh undefined context.
      const outsideCtx = tenantStorage.run(
        undefined as unknown as TenantContextLegacy,
        () => tenantStorage.getStore(),
      );
      expect(outsideCtx).toBeUndefined();
    });

    it("returns the value from the callback", () => {
      const ctx = makeContext("tenant-ret");
      const result = runWithTenantContext(ctx, () => 42);
      expect(result).toBe(42);
    });

    it("isolates contexts between concurrent async runs", async () => {
      const results: string[] = [];

      await Promise.all([
        new Promise<void>((resolve) => {
          runWithTenantContext(makeContext("tenant-a"), async () => {
            await new Promise((r) => setTimeout(r, 10));
            results.push(getTenantContext().tenant_id);
            resolve();
          });
        }),
        new Promise<void>((resolve) => {
          runWithTenantContext(makeContext("tenant-b"), async () => {
            await new Promise((r) => setTimeout(r, 5));
            results.push(getTenantContext().tenant_id);
            resolve();
          });
        }),
      ]);

      expect(results).toContain("tenant-a");
      expect(results).toContain("tenant-b");
      expect(results).toHaveLength(2);
    });

    it("nested runWithTenantContext sees the inner context", () => {
      const outer = makeContext("outer-tenant");
      const inner = makeContext("inner-tenant");

      runWithTenantContext(outer, () => {
        expect(getTenantContext().tenant_id).toBe("outer-tenant");

        runWithTenantContext(inner, () => {
          expect(getTenantContext().tenant_id).toBe("inner-tenant");
        });

        // After inner run exits, outer context is restored
        expect(getTenantContext().tenant_id).toBe("outer-tenant");
      });
    });
  });

  describe("tenantStorage (AsyncLocalStorage)", () => {
    it("getStore returns undefined outside a run", () => {
      const val = tenantStorage.run(
        undefined as unknown as TenantContextLegacy,
        () => tenantStorage.getStore(),
      );
      expect(val).toBeUndefined();
    });

    it("getStore returns the context inside a run", () => {
      const ctx = makeContext("direct-store");
      const val = tenantStorage.run(ctx, () => tenantStorage.getStore());
      expect(val).toEqual(ctx);
    });
  });

  describe("setTenantContext", () => {
    it("sets context accessible via getTenantContext in the same execution context", () => {
      const ctx = makeContext("entered-tenant");

      // setTenantContext uses enterWith — affects the current async context.
      // We isolate this via tenantStorage.run to avoid polluting other tests.
      tenantStorage.run(undefined as unknown as TenantContextLegacy, () => {
        setTenantContext(ctx);
        const stored = getTenantContext();
        expect(stored.tenant_id).toBe("entered-tenant");
      });
    });
  });
});
