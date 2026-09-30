import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { InvalidTenantStateError, StratumError } from "@stratum-hq/core";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * A SCHEMA_PER_TENANT or DB_PER_TENANT tenant is created `pending` and becomes
 * `active` only once its storage has been provisioned. Until then it must not
 * be usable: it does not resolve, its API keys do not authenticate, it takes
 * no children, and it is left out of default listings.
 */

let stratum: Stratum;

beforeAll(async () => {
  await runMigrations();
  stratum = new Stratum({ pool: getPool() });
});

afterEach(async () => {
  await cleanTestData();
});

afterAll(async () => {
  await closePool();
});

function create(
  isolation_strategy: "SHARED_RLS" | "SCHEMA_PER_TENANT" | "DB_PER_TENANT",
  parent_id: string | null = null,
) {
  const slug = uniqueSlug("a9p");
  return stratum.createTenant({ name: slug, slug, parent_id, isolation_strategy });
}

async function expectPendingError(p: Promise<unknown>): Promise<void> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(StratumError);
  expect((err as StratumError).code).toBe("TENANT_PENDING");
}

describe("pending tenant status (integration)", () => {
  it.each(["SCHEMA_PER_TENANT", "DB_PER_TENANT"] as const)(
    "creates a %s tenant as pending",
    async (strategy) => {
      const t = await create(strategy);
      expect(t.status).toBe("pending");
    },
  );

  it("creates a SHARED_RLS tenant as active", async () => {
    const t = await create("SHARED_RLS");
    expect(t.status).toBe("active");
  });

  it("does not resolve a pending tenant, by id, by slug or as a tenant context", async () => {
    const t = await create("SCHEMA_PER_TENANT");
    await expectPendingError(stratum.getTenant(t.id));
    await expectPendingError(stratum.getTenantBySlug(t.slug));
    await expectPendingError(stratum.getTenantContext(t.id));
    expect((await stratum.getTenant(t.id, true)).status).toBe("pending");
  });

  it("does not authenticate an API key of a pending tenant until it is activated", async () => {
    const t = await create("SCHEMA_PER_TENANT");
    const key = await stratum.createApiKey(t.id);
    expect(await stratum.validateApiKey(key.plaintext_key)).toBeNull();

    await stratum.activateTenant(t.id);
    expect((await stratum.validateApiKey(key.plaintext_key))?.tenant_id).toBe(t.id);
  });

  it("refuses to create, batch-create or move a tenant under a pending parent", async () => {
    const P = await create("DB_PER_TENANT");
    await expectPendingError(create("SHARED_RLS", P.id));

    const slug = uniqueSlug("a9p");
    const batch = await stratum.batchCreateTenants([{ name: slug, slug, parent_id: P.id }]);
    expect(batch.created).toHaveLength(0);
    expect(batch.errors).toHaveLength(1);

    const X = await create("SHARED_RLS");
    await expectPendingError(stratum.moveTenant(X.id, P.id));
  });

  it("leaves pending tenants out of default listings and lists them on request", async () => {
    const root = await create("SHARED_RLS");
    const pendingChild = await create("SCHEMA_PER_TENANT", root.id);

    const listed = await stratum.listTenants({ limit: 100 });
    expect(listed.data.map((t) => t.id)).not.toContain(pendingChild.id);
    expect((await stratum.getChildren(root.id)).map((t) => t.id)).not.toContain(pendingChild.id);
    expect((await stratum.getDescendants(root.id)).map((t) => t.id)).not.toContain(pendingChild.id);

    const pending = await stratum.listTenants({ limit: 100 }, { status: "pending" });
    expect(pending.data.map((t) => t.id)).toEqual([pendingChild.id]);
  });

  it("activates a pending tenant, and refuses to activate one that is not pending", async () => {
    const t = await create("SCHEMA_PER_TENANT");
    const active = await stratum.activateTenant(t.id);
    expect(active.status).toBe("active");
    expect((await stratum.getTenant(t.id)).status).toBe("active");

    await expect(stratum.activateTenant(t.id)).rejects.toBeInstanceOf(InvalidTenantStateError);
  });

  it("refuses to activate a pending tenant under a suspended parent", async () => {
    const root = await create("SHARED_RLS");
    const child = await create("SCHEMA_PER_TENANT", root.id);
    await stratum.suspendTenant(root.id);

    await expect(stratum.activateTenant(child.id)).rejects.toMatchObject({ code: "TENANT_SUSPENDED" });
    expect((await stratum.getTenant(child.id, true)).status).toBe("pending");
  });
});
