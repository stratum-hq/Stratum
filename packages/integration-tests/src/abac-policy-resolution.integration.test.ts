import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import type { CreateAbacPolicyInput } from "@stratum-hq/core";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
  getAdminPool,
} from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * ABAC attribute namespaces and same-tenant policy resolution against real
 * Postgres: subject and resource attributes stay in separate namespaces, and a
 * tenant's policies that share a (resource_type, action, name) composite are all
 * evaluated so deny-overrides-allow holds.
 */
describe("ABAC attribute namespaces + same-name policies (integration)", () => {
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

  const policy = (
    over: Partial<CreateAbacPolicyInput>,
  ): CreateAbacPolicyInput => ({
    name: "p",
    resource_type: "user",
    action: "delete",
    effect: "allow",
    conditions: [],
    ...over,
  });

  it("does not let a resource attribute stand in for a subject attribute of the same name", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("absh") });
    await stratum.createAbacPolicy(
      t.id,
      policy({
        name: "admin-delete-users",
        conditions: [{ attribute: "role", operator: "eq", value: "admin" }],
      }),
    );

    const res = await stratum.evaluateAbac(t.id, {
      subject: { role: "member" },
      action: "delete",
      resource: { type: "user", role: "admin" },
    });

    expect(res.allowed).toBe(false);
  });

  it("does not let a resource attribute switch off a deny condition on a subject attribute", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("absd") });
    await stratum.createAbacPolicy(t.id, policy({ name: "allow-all", priority: 0 }));
    await stratum.createAbacPolicy(
      t.id,
      policy({
        name: "deny-suspended",
        effect: "deny",
        priority: 10,
        conditions: [{ attribute: "status", operator: "eq", value: "suspended" }],
      }),
    );

    const res = await stratum.evaluateAbac(t.id, {
      subject: { status: "suspended" },
      action: "delete",
      resource: { type: "user", status: "active" },
    });

    expect(res.allowed).toBe(false);
  });

  it("evaluates subject.* and resource.* qualified attributes against their own namespace", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("abq") });
    await stratum.createAbacPolicy(
      t.id,
      policy({
        name: "admin-deletes-members",
        conditions: [
          { attribute: "subject.role", operator: "eq", value: "admin" },
          { attribute: "resource.role", operator: "eq", value: "member" },
        ],
      }),
    );

    const allowed = await stratum.evaluateAbac(t.id, {
      subject: { role: "admin" },
      action: "delete",
      resource: { type: "user", role: "member" },
    });
    expect(allowed).toMatchObject({ allowed: true, reason: "explicit_allow" });

    const swapped = await stratum.evaluateAbac(t.id, {
      subject: { role: "member" },
      action: "delete",
      resource: { type: "user", role: "admin" },
    });
    expect(swapped.allowed).toBe(false);
  });

  it("keeps bare attribute names working when only one side carries the attribute", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("abb") });
    await stratum.createAbacPolicy(
      t.id,
      policy({
        name: "admin-delete-old-users",
        conditions: [
          { attribute: "role", operator: "eq", value: "admin" },
          { attribute: "account_age_days", operator: "gt", value: 90 },
        ],
      }),
    );

    const res = await stratum.evaluateAbac(t.id, {
      subject: { role: "admin" },
      action: "delete",
      resource: { type: "user", account_age_days: 120 },
    });
    expect(res).toMatchObject({ allowed: true, reason: "explicit_allow" });
  });

  it("applies a higher-priority deny when the same tenant also has a same-name allow", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("abdup") });
    await stratum.createAbacPolicy(
      t.id,
      policy({ name: "doc-read", resource_type: "document", action: "read", effect: "deny", priority: 100 }),
    );
    await stratum.createAbacPolicy(
      t.id,
      policy({ name: "doc-read", resource_type: "document", action: "read", effect: "allow", priority: 0 }),
    );

    const res = await stratum.evaluateAbac(t.id, {
      subject: {},
      action: "read",
      resource: { type: "document" },
    });
    expect(res).toMatchObject({ allowed: false, reason: "explicit_deny" });
  });

  it("applies a lower-priority deny when the same tenant also has a same-name allow", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("abdup2") });
    await stratum.createAbacPolicy(
      t.id,
      policy({ name: "doc-read", resource_type: "document", action: "read", effect: "allow", priority: 100 }),
    );
    await stratum.createAbacPolicy(
      t.id,
      policy({ name: "doc-read", resource_type: "document", action: "read", effect: "deny", priority: 0 }),
    );

    const res = await stratum.evaluateAbac(t.id, {
      subject: {},
      action: "read",
      resource: { type: "document" },
    });
    expect(res).toMatchObject({ allowed: false, reason: "explicit_deny" });
  });

  it("still lets a descendant's same-name policy override an INHERITED ancestor policy", async () => {
    const root = await stratum.createTenant({ name: "R", slug: uniqueSlug("abor") });
    const child = await stratum.createTenant({ name: "C", slug: uniqueSlug("aboc"), parent_id: root.id });
    await stratum.createAbacPolicy(
      root.id,
      policy({ name: "doc-read", resource_type: "document", action: "read", effect: "deny", mode: "INHERITED" }),
    );
    await stratum.createAbacPolicy(
      child.id,
      policy({ name: "doc-read", resource_type: "document", action: "read", effect: "allow" }),
    );

    const res = await stratum.evaluateAbac(child.id, {
      subject: {},
      action: "read",
      resource: { type: "document" },
    });
    expect(res).toMatchObject({ allowed: true, reason: "explicit_allow" });
  });
});
