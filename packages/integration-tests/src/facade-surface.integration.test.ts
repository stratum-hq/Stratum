import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import type { AuditContext, CreateAbacPolicyInput } from "@stratum-hq/core";
import { PermissionMode, RevocationMode } from "@stratum-hq/core";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";
import { tenantInput, uniqueSlug } from "./helpers/fixtures.js";

/**
 * A completeness pass over Stratum facade methods that no real-DB test reaches:
 * getTenantContext, batchCreateTenants, the flat-tenancy org aliases, the API
 * key list/get/dormant readers, webhook get/update/list-deliveries, the role
 * read/update/delete/remove surface, getAuditEntry, getAbacPolicies, and the
 * GDPR Article 20 export shape. Each is pure SQL, so a mocked pool proves none.
 */
describe("Stratum facade completeness against real Postgres (integration)", () => {
  let stratum: Stratum;
  const actor: AuditContext = { actor_id: "u1", actor_type: "system" };

  beforeAll(async () => {
    process.env.STRATUM_ENCRYPTION_KEY = "test-encryption-key-32chars-long!";
    await runMigrations();
    stratum = new Stratum({ pool: getPool() });
  });

  afterEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    delete process.env.STRATUM_ENCRYPTION_KEY;
    await closePool();
  });

  // --- Tenant convenience surface ---

  describe("getTenantContext", () => {
    it("assembles tenant, resolved config, permissions and ancestors in one shot", async () => {
      const root = await stratum.createTenant(tenantInput({ name: "Root", slug: uniqueSlug("tcr") }));
      const child = await stratum.createTenant(
        tenantInput({ name: "Child", slug: uniqueSlug("tcc"), parent_id: root.id }),
      );
      await stratum.setConfig(root.id, "brand", { value: "acme", locked: false, sensitive: false });
      await stratum.createPermission(child.id, {
        key: "invoice:read",
        value: true,
        mode: PermissionMode.INHERITED,
        revocation_mode: RevocationMode.CASCADE,
      });

      const ctx = await stratum.getTenantContext(child.id);
      expect(ctx.tenant.id).toBe(child.id);
      expect(ctx.config.brand.value).toBe("acme"); // inherited from root
      expect(ctx.config.brand.inherited).toBe(true);
      expect(ctx.ancestors.map((a) => a.id)).toEqual([root.id]);
      expect(Object.keys(ctx.permissions).length).toBeGreaterThan(0);
    });
  });

  describe("flat-tenancy org aliases", () => {
    it("createOrganization makes a root and getOrganization/listOrganizations return only roots", async () => {
      const org = await stratum.createOrganization({
        name: "Org",
        slug: uniqueSlug("org"),
        config: {},
        metadata: {},
        isolation_strategy: "SHARED_RLS",
      });
      expect(org.parent_id).toBeNull();

      // A nested tenant must NOT appear in listOrganizations.
      await stratum.createTenant(
        tenantInput({ name: "Nested", slug: uniqueSlug("nst"), parent_id: org.id }),
      );

      const fetched = await stratum.getOrganization(org.id);
      expect(fetched.id).toBe(org.id);

      const orgs = await stratum.listOrganizations({ limit: 50 });
      expect(orgs.data.every((t) => t.parent_id === null)).toBe(true);
      expect(orgs.data.map((t) => t.id)).toContain(org.id);
    });
  });

  describe("batchCreateTenants", () => {
    // A TENANT_CREATED event is a row in webhook_events (type 'tenant.created').
    // emitEvent is fire-and-forget, so give any in-flight insert a moment to land
    // before asserting on its presence -- or its absence.
    const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 250));

    it("creates every tenant in a valid batch, persists them, and emits one event per tenant plus one batch audit", async () => {
      const slugA = uniqueSlug("bca");
      const slugB = uniqueSlug("bcb");
      const result = await stratum.batchCreateTenants(
        [tenantInput({ name: "A", slug: slugA }), tenantInput({ name: "B", slug: slugB })],
        actor,
      );
      expect(result.created).toHaveLength(2);
      expect(result.errors).toHaveLength(0);

      for (const t of result.created) {
        expect((await stratum.getTenant(t.id)).id).toBe(t.id); // really in the DB
      }

      await settle();
      const events = await getPool().query<{ n: string }>(
        `SELECT count(*)::text AS n FROM webhook_events
         WHERE type = 'tenant.created' AND data->'tenant'->>'slug' = ANY($1)`,
        [[slugA, slugB]],
      );
      expect(events.rows[0].n).toBe("2"); // one TENANT_CREATED per persisted tenant

      const audit = await getPool().query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_logs WHERE action = 'tenant.batch_created'`,
      );
      expect(audit.rows[0].n).toBe("1"); // a single batch audit entry for the commit
    });

    it("all-or-nothing: a mid-batch failure commits nothing and emits no event or audit for any tenant in the batch", async () => {
      const taken = uniqueSlug("dupe");
      await stratum.createTenant(tenantInput({ name: "Existing", slug: taken }));

      const survivor = uniqueSlug("bcsurv");
      const result = await stratum.batchCreateTenants(
        [
          tenantInput({ name: "Survivor", slug: survivor }), // inserted first
          tenantInput({ name: "Clash", slug: taken }), // duplicate -> aborts the txn
        ],
        actor,
      );

      // The batch is a single transaction: the unique-violation on the second row
      // rolls the first insert back too. `created` must reflect that nothing
      // persisted, and the facade must emit no TENANT_CREATED event and write no
      // audit entry for the rolled-back tenant. (Issue #213: previously created[]
      // still listed the survivor, so the facade emitted a phantom webhook + audit
      // for a row that never committed.)
      expect(result.errors).toHaveLength(1);
      expect(result.created).toHaveLength(0);

      const persisted = await getPool().query<{ n: string }>(
        `SELECT count(*)::text AS n FROM tenants WHERE slug = $1`,
        [survivor],
      );
      expect(persisted.rows[0].n).toBe("0"); // rolled back: not actually in the DB

      await settle(); // let any (buggy) fire-and-forget emission land before asserting absence
      const events = await getPool().query<{ n: string }>(
        `SELECT count(*)::text AS n FROM webhook_events
         WHERE type = 'tenant.created' AND data->'tenant'->>'slug' = $1`,
        [survivor],
      );
      expect(events.rows[0].n).toBe("0"); // no phantom webhook for the rolled-back tenant

      const audit = await getPool().query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_logs WHERE action = 'tenant.batch_created'`,
      );
      expect(audit.rows[0].n).toBe("0"); // no phantom audit for a batch that committed nothing
    });
  });

  // --- API key readers ---

  describe("API key list/get/dormant", () => {
    it("listApiKeys scopes to a tenant and getApiKey fetches by id (null when unknown)", async () => {
      const t1 = await stratum.createTenant(tenantInput({ name: "T1", slug: uniqueSlug("ak1") }));
      const t2 = await stratum.createTenant(tenantInput({ name: "T2", slug: uniqueSlug("ak2") }));
      const k1 = await stratum.createApiKey(t1.id, "k1");
      await stratum.createApiKey(t2.id, "k2");

      const t1Keys = await stratum.listApiKeys(t1.id);
      expect(t1Keys.map((k) => k.id)).toEqual([k1.id]);

      const got = await stratum.getApiKey(k1.id);
      expect(got?.tenant_id).toBe(t1.id);
      expect(await stratum.getApiKey("00000000-0000-0000-0000-000000000000")).toBeNull();
    });

    it("listDormantKeys returns never-used keys and excludes one that was just validated", async () => {
      const t = await stratum.createTenant(tenantInput({ name: "T", slug: uniqueSlug("dk") }));
      const unused = await stratum.createApiKey(t.id, "unused");
      const used = await stratum.createApiKey(t.id, "used");

      // Using a key stamps last_used_at, taking it out of the dormant set.
      await stratum.validateApiKey(used.plaintext_key);

      const dormant = await stratum.listDormantKeys();
      const ids = dormant.map((k) => k.id);
      expect(ids).toContain(unused.id);
      expect(ids).not.toContain(used.id);
    });
  });

  // --- Webhook read/update ---

  describe("webhook get/update/list-deliveries", () => {
    const secret = "raw-shared-secret-0123";

    it("getWebhook fetches by id and updateWebhook patches active/description", async () => {
      const hook = await stratum.createWebhook({
        tenant_id: null,
        url: "https://example.com/hook",
        secret,
        events: ["tenant.created"],
      });

      expect((await stratum.getWebhook(hook.id)).url).toBe("https://example.com/hook");

      const updated = await stratum.updateWebhook(hook.id, {
        active: false,
        description: "paused",
      });
      expect(updated.active).toBe(false);
      expect(updated.description).toBe("paused");
    });

    it("listWebhookDeliveries throws for an unknown webhook and returns rows for a real one", async () => {
      await expect(
        stratum.listWebhookDeliveries("00000000-0000-0000-0000-000000000000"),
      ).rejects.toThrow();

      const t = await stratum.createTenant(tenantInput({ name: "T", slug: uniqueSlug("wd") }));
      const hook = await stratum.createWebhook({
        tenant_id: t.id,
        url: "https://example.com/webhook",
        secret,
        events: ["tenant.created"],
      });

      expect(await stratum.listWebhookDeliveries(hook.id)).toEqual([]); // none yet

      // Insert an event + delivery directly, then read them back through the facade.
      const ev = await getPool().query<{ id: string }>(
        `INSERT INTO webhook_events (type, tenant_id) VALUES ('tenant.created', $1) RETURNING id`,
        [t.id],
      );
      await getPool().query(
        `INSERT INTO webhook_deliveries (webhook_id, event_id, status, completed_at)
         VALUES ($1, $2, 'success', now())`,
        [hook.id, ev.rows[0].id],
      );

      const deliveries = await stratum.listWebhookDeliveries(hook.id);
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].status).toBe("success");
      expect(deliveries[0].webhook_id).toBe(hook.id);
    });
  });

  // --- Role read/update/delete/remove ---

  describe("role read/update/delete/remove", () => {
    it("getRole/listRoles reflect writes and updateRole patches scopes", async () => {
      const t = await stratum.createTenant(tenantInput({ name: "T", slug: uniqueSlug("role") }));
      const role = await stratum.createRole({ name: "editor", scopes: ["read"], tenant_id: t.id });

      expect((await stratum.getRole(role.id))?.name).toBe("editor");
      expect(await stratum.getRole("00000000-0000-0000-0000-000000000000")).toBeNull();

      const updated = await stratum.updateRole(role.id, { scopes: ["read", "write"] });
      expect(updated?.scopes).toEqual(["read", "write"]);

      const listed = await stratum.listRoles(t.id);
      expect(listed.map((r) => r.id)).toContain(role.id);
    });

    it("deleteRole removes the role and returns whether a row was deleted", async () => {
      const role = await stratum.createRole({ name: "temp", scopes: ["read"] });
      expect(await stratum.deleteRole(role.id)).toBe(true);
      expect(await stratum.getRole(role.id)).toBeNull();
      expect(await stratum.deleteRole(role.id)).toBe(false); // already gone
    });

    it("assignRole then removeRole toggles a principal's scope resolution", async () => {
      const t = await stratum.createTenant(tenantInput({ name: "T", slug: uniqueSlug("prin") }));
      const role = await stratum.createRole({ name: "svc", scopes: ["admin"], tenant_id: t.id });

      await stratum.assignRole("service_account", "svc-1", role.id, t.id);
      expect(await stratum.resolvePrincipalScopes("service_account", "svc-1", t.id)).toEqual(["admin"]);

      expect(await stratum.removeRole("service_account", "svc-1")).toBe(true);
      expect(await stratum.resolvePrincipalScopes("service_account", "svc-1", t.id)).toEqual([]);
    });
  });

  // --- Audit + ABAC getters ---

  describe("getAuditEntry and getAbacPolicies", () => {
    it("getAuditEntry fetches a written entry by id and returns null for an unknown id", async () => {
      const t = await stratum.createTenant(tenantInput({ name: "T", slug: uniqueSlug("aud") }), actor);
      const [entry] = await stratum.queryAuditLogs({ tenant_id: t.id, limit: 50 });
      expect(entry).toBeDefined();

      const fetched = await stratum.getAuditEntry(entry.id);
      expect(fetched?.id).toBe(entry.id);
      expect(fetched?.action).toBe("tenant.created");
      expect(await stratum.getAuditEntry("00000000-0000-0000-0000-000000000000")).toBeNull();
    });

    it("getAbacPolicies returns the tenant's own policies", async () => {
      const t = await stratum.createTenant(tenantInput({ name: "T", slug: uniqueSlug("abac") }));
      const mk = (over: Partial<CreateAbacPolicyInput>): CreateAbacPolicyInput => ({
        name: "p",
        resource_type: "report",
        action: "read",
        effect: "allow",
        conditions: [],
        ...over,
      });
      await stratum.createAbacPolicy(t.id, mk({ name: "one" }));
      await stratum.createAbacPolicy(t.id, mk({ name: "two", effect: "deny" }));

      const policies = await stratum.getAbacPolicies(t.id);
      expect(policies.map((p) => p.name).sort()).toEqual(["one", "two"]);
    });
  });

  // --- GDPR Article 20 export shape ---

  describe("exportTenantData shape", () => {
    it("returns every data category for the tenant (Article 20 completeness)", async () => {
      const t = await stratum.createTenant(tenantInput({ name: "Export", slug: uniqueSlug("exp") }));
      await stratum.setConfig(t.id, "k", { value: 1, locked: false, sensitive: false });
      await stratum.createApiKey(t.id, "key");
      await stratum.grantConsent(t.id, { subject_id: "s1", purpose: "marketing" });

      const dump = await stratum.exportTenantData(t.id);

      // The export must carry all nine categories, keyed and typed as expected.
      expect(Object.keys(dump).sort()).toEqual(
        [
          "api_keys",
          "audit_logs",
          "config_entries",
          "consent_records",
          "permission_policies",
          "tenant",
          "webhook_deliveries",
          "webhook_events",
          "webhooks",
        ].sort(),
      );
      expect((dump.tenant as { id: string }).id).toBe(t.id);
      expect(Array.isArray(dump.config_entries)).toBe(true);
      expect((dump.config_entries as unknown[]).length).toBe(1);
      expect((dump.api_keys as unknown[]).length).toBe(1);
      expect((dump.consent_records as unknown[]).length).toBe(1);
    });
  });
});
