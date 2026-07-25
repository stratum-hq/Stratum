import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";
import { tenantInput, uniqueSlug } from "./helpers/fixtures.js";

/**
 * diffConfig / computeDrift / batchComputeDrift / getConfigWithInheritance are
 * facade logic layered on top of resolveConfig, and none of them is touched by
 * a real-DB test. The drift status ranking (ok < override < missing < conflict)
 * and the "locked ancestor wins" interaction only behave correctly when the
 * underlying resolveConfig walks a real ancestry_path, so these need Postgres.
 */
describe("config diff & drift against real Postgres (integration)", () => {
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

  const set = (id: string, key: string, value: unknown, locked = false) =>
    stratum.setConfig(id, key, { value, locked, sensitive: false });

  // --- getConfigWithInheritance ---

  it("getConfigWithInheritance resolves the nearest ancestor value and marks it inherited", async () => {
    const root = await stratum.createTenant(tenantInput({ name: "Root", slug: uniqueSlug("gcr") }));
    const child = await stratum.createTenant(
      tenantInput({ name: "Child", slug: uniqueSlug("gcc"), parent_id: root.id }),
    );
    await set(root.id, "theme", "dark");
    await set(child.id, "own", "x");

    const resolved = await stratum.getConfigWithInheritance(child.id);
    expect(resolved.theme.value).toBe("dark");
    expect(resolved.theme.inherited).toBe(true);
    expect(resolved.theme.source_tenant_id).toBe(root.id);
    expect(resolved.own.value).toBe("x");
    expect(resolved.own.inherited).toBe(false);
  });

  it("getConfigWithInheritance shows the ancestor's locked value over a child's own row", async () => {
    const root = await stratum.createTenant(tenantInput({ name: "Root", slug: uniqueSlug("glr") }));
    const child = await stratum.createTenant(
      tenantInput({ name: "Child", slug: uniqueSlug("glc"), parent_id: root.id }),
    );
    await set(child.id, "rate", 5); // child sets it first...
    await set(root.id, "rate", 10, /* locked */ true); // ...then the parent locks it

    const resolved = await stratum.getConfigWithInheritance(child.id);
    expect(resolved.rate.value).toBe(10); // locked ancestor value wins
    expect(resolved.rate.locked).toBe(true);
  });

  // --- diffConfig ---

  it("diffConfig reports a key present on only one side and sorts keys", async () => {
    const a = await stratum.createTenant(tenantInput({ name: "A", slug: uniqueSlug("da") }));
    const b = await stratum.createTenant(tenantInput({ name: "B", slug: uniqueSlug("db") }));
    await set(a.id, "zebra", 1);
    await set(a.id, "alpha", 2);
    await set(b.id, "alpha", 3);

    const diff = await stratum.diffConfig(a.id, b.id);

    expect(diff.tenant_a).toEqual({ id: a.id, name: "A" });
    expect(diff.tenant_b).toEqual({ id: b.id, name: "B" });
    // keys sorted ascending
    expect(diff.diff.map((d) => d.key)).toEqual(["alpha", "zebra"]);

    const alpha = diff.diff.find((d) => d.key === "alpha")!;
    expect(alpha.tenant_a?.value).toBe(2);
    expect(alpha.tenant_b?.value).toBe(3);
    expect(alpha.tenant_a?.status).toBe("own");

    const zebra = diff.diff.find((d) => d.key === "zebra")!;
    expect(zebra.tenant_a?.value).toBe(1);
    expect(zebra.tenant_b).toBeNull(); // only A has it
  });

  it("diffConfig labels an inherited value 'inherited' and a locked one 'locked'", async () => {
    const root = await stratum.createTenant(tenantInput({ name: "Root", slug: uniqueSlug("dir") }));
    const child = await stratum.createTenant(
      tenantInput({ name: "Child", slug: uniqueSlug("dic"), parent_id: root.id }),
    );
    await set(root.id, "inherited_key", "v");
    await set(root.id, "locked_key", "L", /* locked */ true);

    const diff = await stratum.diffConfig(root.id, child.id);
    const inh = diff.diff.find((d) => d.key === "inherited_key")!;
    const lck = diff.diff.find((d) => d.key === "locked_key")!;

    expect(inh.tenant_b?.status).toBe("inherited"); // child inherits it
    expect(lck.tenant_b?.status).toBe("locked");
  });

  // --- computeDrift ---

  it("reports 'ok' with no overrides when the child inherits everything", async () => {
    const parent = await stratum.createTenant(tenantInput({ name: "P", slug: uniqueSlug("dokp") }));
    const child = await stratum.createTenant(
      tenantInput({ name: "C", slug: uniqueSlug("dokc"), parent_id: parent.id }),
    );
    await set(parent.id, "a", 1);
    await set(parent.id, "b", 2);

    const drift = await stratum.computeDrift(parent.id, child.id);
    expect(drift.status).toBe("ok");
    expect(drift.overrides).toBe(0);
    expect(drift.missing).toBe(0);
    expect(drift.conflicts).toBe(0);
    expect(drift.details.every((d) => d.status === "ok")).toBe(true);
  });

  it("reports 'override' when the child sets its own differing value for an unlocked key", async () => {
    const parent = await stratum.createTenant(tenantInput({ name: "P", slug: uniqueSlug("dovp") }));
    const child = await stratum.createTenant(
      tenantInput({ name: "C", slug: uniqueSlug("dovc"), parent_id: parent.id }),
    );
    await set(parent.id, "tier", "gold");
    await set(parent.id, "shared", "same");
    await set(child.id, "tier", "platinum"); // override

    const drift = await stratum.computeDrift(parent.id, child.id);
    expect(drift.status).toBe("override");
    expect(drift.overrides).toBe(1);
    const tier = drift.details.find((d) => d.key === "tier")!;
    expect(tier.status).toBe("override");
    expect(tier.parentValue).toBe("gold");
    expect(tier.childValue).toBe("platinum");
    // the inherited key stays ok
    expect(drift.details.find((d) => d.key === "shared")!.status).toBe("ok");
  });

  it("counts a parent-only key as 'missing' for a non-descendant pair", async () => {
    // computeDrift accepts any two tenants. For two unrelated roots the child
    // does not inherit the parent's keys, so a parent-only key shows as missing
    // and a child-only key as override. missing (rank 2) outranks override.
    const parent = await stratum.createTenant(tenantInput({ name: "P", slug: uniqueSlug("dmp") }));
    const other = await stratum.createTenant(tenantInput({ name: "O", slug: uniqueSlug("dmo") }));
    await set(parent.id, "only_parent", 1);
    await set(other.id, "only_child", 2);

    const drift = await stratum.computeDrift(parent.id, other.id);
    expect(drift.missing).toBe(1);
    expect(drift.overrides).toBe(1);
    expect(drift.status).toBe("missing");
  });

  it("a locked ancestor key resolves to 'ok' (not conflict), because the child cannot diverge from it", async () => {
    // Characterization: setConfig blocks a child from overriding a locked key,
    // and resolveConfig forces the child's resolved value to the ancestor's, so
    // the child never presents a differing own value while the parent is locked.
    // The 'conflict' drift status is therefore not reachable through the public
    // API; a locked key surfaces as 'ok' with details[].locked === true.
    const parent = await stratum.createTenant(tenantInput({ name: "P", slug: uniqueSlug("dlp") }));
    const child = await stratum.createTenant(
      tenantInput({ name: "C", slug: uniqueSlug("dlc"), parent_id: parent.id }),
    );
    await set(parent.id, "policy", "strict", /* locked */ true);

    const drift = await stratum.computeDrift(parent.id, child.id);
    expect(drift.conflicts).toBe(0);
    expect(drift.status).toBe("ok");
    expect(drift.details.find((d) => d.key === "policy")!.locked).toBe(true);
  });

  // --- batchComputeDrift ---

  it("batchComputeDrift aggregates per-child drift into a summary", async () => {
    const parent = await stratum.createTenant(tenantInput({ name: "P", slug: uniqueSlug("bdp") }));
    const clean = await stratum.createTenant(
      tenantInput({ name: "Clean", slug: uniqueSlug("bdclean"), parent_id: parent.id }),
    );
    const drifted = await stratum.createTenant(
      tenantInput({ name: "Drift", slug: uniqueSlug("bddrift"), parent_id: parent.id }),
    );
    await set(parent.id, "flag", "on");
    await set(drifted.id, "flag", "off"); // this child overrides

    const batch = await stratum.batchComputeDrift(parent.id, [clean.id, drifted.id]);

    expect(batch.parent_id).toBe(parent.id);
    expect(batch.results).toHaveLength(2);
    expect(batch.summary.ok).toBe(1);
    expect(batch.summary.override).toBe(1);
    expect(batch.results.find((r) => r.tenant_id === drifted.id)!.status).toBe("override");
  });
});
