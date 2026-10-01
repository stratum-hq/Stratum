import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import {
  PermissionMode,
  RevocationMode,
  TenantArchivedError,
  TenantPendingError,
  TenantSuspendedError,
  type TenantNode,
} from "@stratum-hq/core";
import { getPool, closePool, runMigrations, cleanTestData, getAdminPool } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * Config, permission, webhook and consent writes made through the library
 * directly (no control plane in front) must follow the same rule the control
 * plane applies: only an active tenant can be written. Removals stay allowed so
 * an operator can still clean up a suspended, archived or pending tenant, and a
 * purge still removes everything.
 */

const WEBHOOK_URL = "https://93.184.216.34/hook";

let stratum: Stratum;

beforeAll(async () => {
  await runMigrations();
  stratum = new Stratum({ pool: getPool(), adminPool: getAdminPool() });
});

afterEach(async () => {
  await cleanTestData();
});

afterAll(async () => {
  await closePool();
});

async function activeTenant(): Promise<TenantNode> {
  const slug = uniqueSlug("r10");
  return stratum.createTenant({ name: slug, slug });
}

const states = [
  {
    state: "suspended",
    error: TenantSuspendedError,
    enter: async (t: TenantNode) => {
      await stratum.suspendTenant(t.id);
    },
  },
  {
    state: "archived",
    error: TenantArchivedError,
    enter: async (t: TenantNode) => {
      await stratum.archiveTenant(t.id);
    },
  },
  {
    state: "pending",
    error: TenantPendingError,
    // A pending tenant is one whose storage was never provisioned, so it is
    // created that way rather than entered from active.
    enter: null,
  },
] as const;

async function tenantIn(state: (typeof states)[number]): Promise<TenantNode> {
  if (state.enter === null) {
    const slug = uniqueSlug("r10");
    return stratum.createTenant({ name: slug, slug, isolation_strategy: "SCHEMA_PER_TENANT" });
  }
  const t = await activeTenant();
  await state.enter(t);
  return t;
}

/**
 * A role owned by the tenant. Written in SQL because the library refuses to
 * create a role for a tenant that is not active.
 */
async function tenantRole(tenantId: string): Promise<{ id: string }> {
  const res = await getPool().query<{ id: string }>(
    `INSERT INTO roles (name, scopes, tenant_id) VALUES ($1, $2, $3) RETURNING id`,
    [uniqueSlug("role"), ["read"], tenantId],
  );
  return res.rows[0];
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const res = await getPool().query(sql, params);
  return res.rowCount ?? 0;
}

describe.each(states)("writes to a $state tenant through the library (integration)", (s) => {
  it("refuses setConfig and writes nothing", async () => {
    const t = await tenantIn(s);
    await expect(stratum.setConfig(t.id, "plan", { value: "pro" })).rejects.toBeInstanceOf(s.error);
    expect(await count(`SELECT 1 FROM config_entries WHERE tenant_id = $1`, [t.id])).toBe(0);
  });

  it("refuses batchSetConfig and writes nothing", async () => {
    const t = await tenantIn(s);
    await expect(
      stratum.batchSetConfig(t.id, [{ key: "plan", value: "pro" }]),
    ).rejects.toBeInstanceOf(s.error);
    expect(await count(`SELECT 1 FROM config_entries WHERE tenant_id = $1`, [t.id])).toBe(0);
  });

  it("refuses createPermission and writes nothing", async () => {
    const t = await tenantIn(s);
    await expect(
      stratum.createPermission(t.id, { key: "feature:x", mode: PermissionMode.INHERITED }),
    ).rejects.toBeInstanceOf(s.error);
    expect(await count(`SELECT 1 FROM permission_policies WHERE tenant_id = $1`, [t.id])).toBe(0);
  });

  it("refuses createWebhook and writes nothing", async () => {
    const t = await tenantIn(s);
    await expect(
      stratum.createWebhook({ tenant_id: t.id, url: WEBHOOK_URL, secret: "s".repeat(32), events: ["tenant.updated"] }),
    ).rejects.toBeInstanceOf(s.error);
    expect(await count(`SELECT 1 FROM webhooks WHERE tenant_id = $1`, [t.id])).toBe(0);
  });

  it("refuses grantConsent and writes nothing", async () => {
    const t = await tenantIn(s);
    await expect(
      stratum.grantConsent(t.id, { subject_id: "user-1", purpose: "marketing" }),
    ).rejects.toBeInstanceOf(s.error);
    expect(await count(`SELECT 1 FROM consent_records WHERE tenant_id = $1`, [t.id])).toBe(0);
  });

  it("refuses createAbacPolicy and writes nothing", async () => {
    const t = await tenantIn(s);
    await expect(
      stratum.createAbacPolicy(t.id, {
        name: "p", resource_type: "report", action: "read", effect: "allow", conditions: [],
      }),
    ).rejects.toBeInstanceOf(s.error);
    expect(await count(`SELECT 1 FROM abac_policies WHERE tenant_id = $1`, [t.id])).toBe(0);
  });

  it("refuses createRole for the tenant and writes nothing", async () => {
    const t = await tenantIn(s);
    await expect(
      stratum.createRole({ name: uniqueSlug("role"), scopes: ["read"], tenant_id: t.id }),
    ).rejects.toBeInstanceOf(s.error);
    expect(await count(`SELECT 1 FROM roles WHERE tenant_id = $1`, [t.id])).toBe(0);
  });

  it("refuses assignRole within the tenant and writes nothing", async () => {
    const t = await tenantIn(s);
    const role = await stratum.createRole({ name: uniqueSlug("role"), scopes: ["read"] });
    const principal = uniqueSlug("user");
    await expect(
      stratum.assignRole("user", principal, role.id, t.id),
    ).rejects.toBeInstanceOf(s.error);
    expect(await count(`SELECT 1 FROM principal_roles WHERE principal_id = $1`, [principal])).toBe(0);
  });

  it("refuses updateRole on the tenant's role and leaves it unchanged", async () => {
    const t = await tenantIn(s);
    const role = await tenantRole(t.id);
    await expect(
      stratum.updateRole(role.id, { scopes: ["read", "write", "admin"] }),
    ).rejects.toBeInstanceOf(s.error);
    const row = await getPool().query(`SELECT scopes FROM roles WHERE id = $1`, [role.id]);
    expect(row.rows[0].scopes).toEqual(["read"]);
  });

  it("refuses assignRoleToKey with the tenant's role and writes nothing", async () => {
    const t = await tenantIn(s);
    const role = await tenantRole(t.id);
    const key = await stratum.createApiKey((await activeTenant()).id, "k");
    await expect(stratum.assignRoleToKey(key.id, role.id)).rejects.toBeInstanceOf(s.error);
    const row = await getPool().query(`SELECT role_id FROM api_keys WHERE id = $1`, [key.id]);
    expect(row.rows[0].role_id).toBeNull();
  });

  it("refuses recordUsage and writes nothing", async () => {
    const t = await tenantIn(s);
    await expect(
      stratum.recordUsage(t.id, { metric: "api_calls", quantity: 1 }),
    ).rejects.toBeInstanceOf(s.error);
    expect(await count(`SELECT 1 FROM usage_events WHERE tenant_id = $1`, [t.id])).toBe(0);
  });
});

describe.each(states.filter((s) => s.enter !== null))(
  "updates to records of a tenant that became $state (integration)",
  (s) => {
    it("refuses updatePermission and leaves the policy unchanged", async () => {
      const t = await activeTenant();
      const policy = await stratum.createPermission(t.id, { key: "feature:x", value: true });
      await s.enter!(t);

      await expect(
        stratum.updatePermission(t.id, policy.id, { value: false }),
      ).rejects.toBeInstanceOf(s.error);
      const row = await getPool().query(`SELECT value FROM permission_policies WHERE id = $1`, [policy.id]);
      expect(row.rows[0].value).toBe(true);
    });

    it("refuses updateWebhook and leaves the webhook unchanged", async () => {
      const t = await activeTenant();
      const webhook = await stratum.createWebhook({
        tenant_id: t.id, url: WEBHOOK_URL, secret: "s".repeat(32), events: ["tenant.updated"], description: "before",
      });
      await s.enter!(t);

      await expect(
        stratum.updateWebhook(webhook.id, { description: "after" }),
      ).rejects.toBeInstanceOf(s.error);
      const row = await getPool().query(`SELECT description FROM webhooks WHERE id = $1`, [webhook.id]);
      expect(row.rows[0].description).toBe("before");
    });

    it("refuses assignRoleToKey for a key of the tenant and writes nothing", async () => {
      const t = await activeTenant();
      const key = await stratum.createApiKey(t.id, "k");
      const role = await stratum.createRole({ name: uniqueSlug("role"), scopes: ["read"] });
      await s.enter!(t);

      await expect(stratum.assignRoleToKey(key.id, role.id)).rejects.toBeInstanceOf(s.error);
      const row = await getPool().query(`SELECT role_id FROM api_keys WHERE id = $1`, [key.id]);
      expect(row.rows[0].role_id).toBeNull();
    });

    it("still deactivates a webhook of the tenant", async () => {
      const t = await activeTenant();
      const webhook = await stratum.createWebhook({
        tenant_id: t.id, url: WEBHOOK_URL, secret: "s".repeat(32), events: ["tenant.updated"],
      });
      await s.enter!(t);

      await expect(stratum.updateWebhook(webhook.id, { active: false })).resolves.toMatchObject({ active: false });
    });

    it("refuses to reactivate a webhook of the tenant", async () => {
      const t = await activeTenant();
      const webhook = await stratum.createWebhook({
        tenant_id: t.id, url: WEBHOOK_URL, secret: "s".repeat(32), events: ["tenant.updated"],
      });
      await stratum.updateWebhook(webhook.id, { active: false });
      await s.enter!(t);

      await expect(stratum.updateWebhook(webhook.id, { active: true })).rejects.toBeInstanceOf(s.error);
      const row = await getPool().query(`SELECT active FROM webhooks WHERE id = $1`, [webhook.id]);
      expect(row.rows[0].active).toBe(false);
    });
  },
);

describe("maintenance of a non-active tenant through the library (integration)", () => {
  async function suspendedWithRecords() {
    const t = await activeTenant();
    await stratum.setConfig(t.id, "plan", { value: "pro" });
    const policy = await stratum.createPermission(t.id, {
      key: "feature:x", revocation_mode: RevocationMode.CASCADE,
    });
    const webhook = await stratum.createWebhook({
      tenant_id: t.id, url: WEBHOOK_URL, secret: "s".repeat(32), events: ["tenant.updated"],
    });
    await stratum.grantConsent(t.id, { subject_id: "user-1", purpose: "marketing" });
    await stratum.suspendTenant(t.id);
    return { t, policy, webhook };
  }

  it("still removes config, permissions, webhooks and consent of a suspended tenant", async () => {
    const { t, policy, webhook } = await suspendedWithRecords();

    await stratum.deleteConfig(t.id, "plan");
    await stratum.deletePermission(t.id, policy.id);
    await stratum.deleteWebhook(webhook.id);
    expect(await stratum.revokeConsent(t.id, "user-1", "marketing")).toBe(true);

    expect(await count(`SELECT 1 FROM config_entries WHERE tenant_id = $1`, [t.id])).toBe(0);
    expect(await count(`SELECT 1 FROM permission_policies WHERE tenant_id = $1`, [t.id])).toBe(0);
    expect(await count(`SELECT 1 FROM webhooks WHERE tenant_id = $1`, [t.id])).toBe(0);
  });

  it("still purges an archived tenant together with its records", async () => {
    const { t } = await suspendedWithRecords();
    await stratum.archiveTenant(t.id);

    await stratum.purgeTenant(t.id);

    expect(await count(`SELECT 1 FROM tenants WHERE id = $1`, [t.id])).toBe(0);
    expect(await count(`SELECT 1 FROM config_entries WHERE tenant_id = $1`, [t.id])).toBe(0);
    expect(await count(`SELECT 1 FROM consent_records WHERE tenant_id = $1`, [t.id])).toBe(0);
  });

  it("accepts writes again once the tenant is resumed", async () => {
    const { t } = await suspendedWithRecords();
    await stratum.resumeTenant(t.id);

    await expect(stratum.setConfig(t.id, "plan", { value: "team" })).resolves.toBeDefined();
    await expect(stratum.grantConsent(t.id, { subject_id: "user-2", purpose: "marketing" })).resolves.toBeDefined();
  });
});
