import { describe, it, expect } from "vitest";
import knexFactory, { type Knex } from "knex";
import { withTenantScope } from "../integrations/knex.js";
import type { KnexLike } from "../integrations/knex.js";

// A real Knex instance with no connection: queries are compiled, never run.
const knex = knexFactory({ client: "mysql2" });

function scoped(tenantId = "tenant1"): (table: string) => Knex.QueryBuilder {
  return withTenantScope(knex as unknown as KnexLike, tenantId) as unknown as (
    table: string,
  ) => Knex.QueryBuilder;
}

describe("withTenantScope", () => {
  it("returns a scoped query builder factory", () => {
    expect(typeof withTenantScope(knex as unknown as KnexLike, "tenant1")).toBe("function");
  });

  it("scoped builder adds WHERE tenant_id clause for the given tenant", () => {
    expect(scoped()("users").toString()).toBe(
      "select * from `users` where `tenant_id` = 'tenant1'",
    );
  });

  it("works with select chains", () => {
    expect(scoped()("orders").select("id", "total").toString()).toBe(
      "select `id`, `total` from `orders` where `tenant_id` = 'tenant1'",
    );
  });

  it("groups the caller's where clauses after the tenant filter", () => {
    expect(scoped()("users").where("id", 1).orWhere("id", 2).toString()).toBe(
      "select * from `users` where `tenant_id` = 'tenant1' and (`id` = 1 or `id` = 2)",
    );
  });

  it("keeps clones independent and scoped", () => {
    const base = scoped()("users").where("id", 1);
    const copy = base.clone().orWhere("id", 9);
    base.orWhere("id", 8);
    expect(base.toString()).toContain("`tenant_id` = 'tenant1' and (`id` = 1 or `id` = 8)");
    expect(copy.toString()).toContain("`tenant_id` = 'tenant1' and (`id` = 1 or `id` = 9)");
  });

  it("works with update chains and drops tenant_id from the data", () => {
    expect(
      scoped()("users").where("id", 1).update({ name: "Alice", TENANT_ID: "other" }).toString(),
    ).toBe("update `users` set `name` = 'Alice' where `tenant_id` = 'tenant1' and (`id` = 1)");
  });

  it("works with delete chains", () => {
    expect(scoped()("users").where("id", 1).delete().toString()).toBe(
      "delete from `users` where `tenant_id` = 'tenant1' and (`id` = 1)",
    );
  });

  it("insert injects tenant_id into a single row", () => {
    expect(scoped()("users").insert({ name: "Bob" }).toString()).toBe(
      "insert into `users` (`name`, `tenant_id`) values ('Bob', 'tenant1')",
    );
  });

  it("insert injects tenant_id into each row of a batch", () => {
    expect(scoped()("users").insert([{ name: "Alice" }, { name: "Bob" }]).toString()).toBe(
      "insert into `users` (`name`, `tenant_id`) values ('Alice', 'tenant1'), ('Bob', 'tenant1')",
    );
  });

  it("allows onConflict().ignore()", () => {
    expect(scoped()("users").insert({ id: 1 }).onConflict("id").ignore().toString()).toBe(
      "insert ignore into `users` (`id`, `tenant_id`) values (1, 'tenant1')",
    );
  });

  it("refuses onConflict().merge(), upsert(), truncate() and changes to tenant_id", () => {
    expect(() => scoped()("users").insert({ id: 1 }).onConflict("id").merge()).toThrow();
    expect(() => scoped()("users").upsert({ id: 1 })).toThrow();
    expect(() => scoped()("users").truncate()).toThrow();
    expect(() => scoped()("users").update("tenant_id", "other")).toThrow();
    expect(() => scoped()("users").increment("tenant_id", 1)).toThrow();
  });
});
