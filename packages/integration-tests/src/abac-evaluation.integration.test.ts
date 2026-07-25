import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { AbacPolicyLockedError } from "@stratum-hq/core";
import type { CreateAbacPolicyInput } from "@stratum-hq/core";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";
import { tenantInput, uniqueSlug } from "./helpers/fixtures.js";

/**
 * ABAC evaluation end to end against real Postgres: policies persisted as JSONB,
 * resolved up the ancestry chain (ORDER BY priority), then evaluated with
 * deny-overrides-allow, wildcards, and conditions. The pure evaluator is
 * unit-tested; what a mock cannot prove is that the DB-backed resolve +
 * inheritance + priority ordering feeds evaluation correctly.
 */
describe("ABAC evaluation + hierarchy (integration)", () => {
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

  const policy = (over: Partial<CreateAbacPolicyInput>): CreateAbacPolicyInput => ({
    name: "p",
    resource_type: "report",
    action: "read",
    effect: "allow",
    conditions: [],
    ...over,
  });

  it("defaults to deny when no policy matches", async () => {
    const t = await stratum.createTenant(tenantInput({ name: "T", slug: uniqueSlug("adny") }));
    const res = await stratum.evaluateAbac(t.id, {
      subject: {},
      action: "read",
      resource: { type: "report" },
    });
    expect(res).toMatchObject({ allowed: false, reason: "no_matching_policy" });
  });

  it("allows when a matching policy's conditions pass and denies when they fail", async () => {
    const t = await stratum.createTenant(tenantInput({ name: "T", slug: uniqueSlug("acnd") }));
    await stratum.createAbacPolicy(t.id, policy({
      name: "admins_read",
      conditions: [{ attribute: "role", operator: "eq", value: "admin" }],
    }));

    const asAdmin = await stratum.evaluateAbac(t.id, {
      subject: { role: "admin" }, action: "read", resource: { type: "report" },
    });
    expect(asAdmin).toMatchObject({ allowed: true, reason: "explicit_allow" });
    expect(asAdmin.matched_policy?.name).toBe("admins_read");

    const asUser = await stratum.evaluateAbac(t.id, {
      subject: { role: "user" }, action: "read", resource: { type: "report" },
    });
    expect(asUser.allowed).toBe(false);
  });

  it("lets deny override allow even when the allow has higher priority", async () => {
    const t = await stratum.createTenant(tenantInput({ name: "T", slug: uniqueSlug("aden") }));
    await stratum.createAbacPolicy(t.id, policy({ name: "allow_all", effect: "allow", priority: 100 }));
    await stratum.createAbacPolicy(t.id, policy({ name: "deny_all", effect: "deny", priority: 1 }));

    const res = await stratum.evaluateAbac(t.id, {
      subject: {}, action: "read", resource: { type: "report" },
    });
    expect(res).toMatchObject({ allowed: false, reason: "explicit_deny" });
    expect(res.matched_policy?.name).toBe("deny_all");
  });

  it("matches wildcard resource_type and action", async () => {
    const t = await stratum.createTenant(tenantInput({ name: "T", slug: uniqueSlug("awld") }));
    await stratum.createAbacPolicy(t.id, policy({
      name: "star", resource_type: "*", action: "*", effect: "allow",
    }));

    const res = await stratum.evaluateAbac(t.id, {
      subject: {}, action: "delete", resource: { type: "anything" },
    });
    expect(res.allowed).toBe(true);
  });

  it("reports the highest-priority allow as the matched policy", async () => {
    const t = await stratum.createTenant(tenantInput({ name: "T", slug: uniqueSlug("apri") }));
    await stratum.createAbacPolicy(t.id, policy({ name: "low", priority: 10 }));
    await stratum.createAbacPolicy(t.id, policy({ name: "high", priority: 50 }));

    const res = await stratum.evaluateAbac(t.id, {
      subject: {}, action: "read", resource: { type: "report" },
    });
    expect(res.allowed).toBe(true);
    expect(res.matched_policy?.name).toBe("high");
  });

  it("evaluates a descendant against an ancestor's inherited policy", async () => {
    const root = await stratum.createTenant(tenantInput({ name: "Root", slug: uniqueSlug("ainr") }));
    const child = await stratum.createTenant(
      tenantInput({ name: "Child", slug: uniqueSlug("ainc"), parent_id: root.id }),
    );
    await stratum.createAbacPolicy(root.id, policy({ name: "root_allow" }));

    const res = await stratum.evaluateAbac(child.id, {
      subject: {}, action: "read", resource: { type: "report" },
    });
    expect(res.allowed).toBe(true);
    expect(res.matched_policy?.name).toBe("root_allow");
  });

  it("blocks a descendant from creating a policy an ancestor LOCKED (same composite)", async () => {
    const root = await stratum.createTenant(tenantInput({ name: "Root", slug: uniqueSlug("alkr") }));
    const child = await stratum.createTenant(
      tenantInput({ name: "Child", slug: uniqueSlug("alkc"), parent_id: root.id }),
    );
    await stratum.createAbacPolicy(root.id, policy({ name: "gate", mode: "LOCKED" }));

    await expect(
      stratum.createAbacPolicy(child.id, policy({ name: "gate" })),
    ).rejects.toThrow(AbacPolicyLockedError);
  });

  it("cascades deleteAbacPolicy to descendant copies of the same composite only", async () => {
    const root = await stratum.createTenant(tenantInput({ name: "Root", slug: uniqueSlug("acar") }));
    const child = await stratum.createTenant(
      tenantInput({ name: "Child", slug: uniqueSlug("acac"), parent_id: root.id }),
    );

    const rootGate = await stratum.createAbacPolicy(root.id, policy({ name: "gate" }));
    await stratum.createAbacPolicy(child.id, policy({ name: "gate" }));
    await stratum.createAbacPolicy(child.id, policy({
      name: "other", resource_type: "doc", action: "write",
    }));

    await stratum.deleteAbacPolicy(root.id, rootGate.id);

    // Child's "gate" copy is gone; its unrelated "other" policy survives.
    const remaining = (await stratum.resolveAbacPolicies(child.id)).map((r) => r.policy.name);
    expect(remaining).toEqual(["other"]);
  });
});
