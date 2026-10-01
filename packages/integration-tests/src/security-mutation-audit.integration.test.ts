import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import type { AuditContext, AuditEntry } from "@stratum-hq/core";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
  getAdminPool,
} from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * Security-relevant mutations write an audit row, stamped for the owning tenant
 * so that tenant can see it: API key create / rotate / revoke, role assignment
 * to keys and principals, ABAC policy create / delete, and role deletion.
 */
describe("security-relevant mutations are audited (integration)", () => {
  let stratum: Stratum;
  const actor: AuditContext = { actor_id: "sec-actor", actor_type: "api_key", request_id: "req-1" };

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

  async function entries(tenantId: string, action: string): Promise<AuditEntry[]> {
    return stratum.queryAuditLogs({ tenant_id: tenantId, action });
  }

  it("audits API key creation, rotation and revocation for the key's tenant", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("aak") });

    const created = await stratum.createApiKey(t.id, { name: "ci" }, undefined, actor);
    const [createdEntry] = await entries(t.id, "api_key.created");
    expect(createdEntry).toMatchObject({ actor_id: "sec-actor", resource_type: "api_key", resource_id: created.id });
    expect(JSON.stringify(createdEntry)).not.toContain(created.plaintext_key);

    const rotated = await stratum.rotateApiKey(created.id, undefined, actor);
    const [rotatedEntry] = await entries(t.id, "api_key.rotated");
    expect(rotatedEntry).toMatchObject({ resource_id: rotated.id });
    expect(rotatedEntry.before_state).toMatchObject({ id: created.id });
    expect(JSON.stringify(rotatedEntry)).not.toContain(rotated.plaintext_key);

    expect(await stratum.revokeApiKey(rotated.id, actor)).toBe(true);
    const [revokedEntry] = await entries(t.id, "api_key.revoked");
    expect(revokedEntry).toMatchObject({ resource_id: rotated.id });
  });

  it("audits role assignment to and removal from an API key", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("ark") });
    const key = await stratum.createApiKey(t.id, "k");
    const role = await stratum.createRole({ name: "reader", scopes: ["read"], tenant_id: t.id });

    expect(await stratum.assignRoleToKey(key.id, role.id, actor)).toBe(true);
    const [assigned] = await entries(t.id, "api_key.role_assigned");
    expect(assigned).toMatchObject({ resource_id: key.id });
    expect(assigned.after_state).toMatchObject({ role_id: role.id });

    expect(await stratum.removeRoleFromKey(key.id, actor)).toBe(true);
    const [removed] = await entries(t.id, "api_key.role_removed");
    expect(removed).toMatchObject({ resource_id: key.id });
  });

  it("audits role assignment to and removal from a principal", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("arp") });
    const role = await stratum.createRole({ name: "admin", scopes: ["admin"], tenant_id: t.id });

    expect(await stratum.assignRole("user", "u-1", role.id, t.id, actor)).toBe(true);
    const [assigned] = await entries(t.id, "principal.role_assigned");
    expect(assigned).toMatchObject({ resource_type: "principal", resource_id: "user:u-1" });
    expect(assigned.after_state).toMatchObject({ role_id: role.id });

    expect(await stratum.removeRole("user", "u-1", actor)).toBe(true);
    const [removed] = await entries(t.id, "principal.role_removed");
    expect(removed).toMatchObject({ resource_id: "user:u-1" });
    expect(removed.before_state).toMatchObject({ role_id: role.id });
  });

  it("audits ABAC policy creation and deletion", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("aab") });

    const p = await stratum.createAbacPolicy(
      t.id,
      { name: "deny-x", resource_type: "doc", action: "read", effect: "deny", conditions: [] },
      actor,
    );
    const [created] = await entries(t.id, "abac_policy.created");
    expect(created).toMatchObject({ resource_type: "abac_policy", resource_id: p.id });

    await stratum.deleteAbacPolicy(t.id, p.id, actor);
    const [deleted] = await entries(t.id, "abac_policy.deleted");
    expect(deleted).toMatchObject({ resource_id: p.id });
    expect(deleted.before_state).toMatchObject({ name: "deny-x", effect: "deny" });
  });

  it("stamps role.deleted with the role's owning tenant", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("ard") });
    const role = await stratum.createRole({ name: "temp", scopes: ["read"], tenant_id: t.id });

    expect(await stratum.deleteRole(role.id, actor)).toBe(true);
    const [deleted] = await entries(t.id, "role.deleted");
    expect(deleted).toMatchObject({ resource_id: role.id, tenant_id: t.id });
  });
});
