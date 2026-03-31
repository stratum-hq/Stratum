import { describe, it, expect, vi } from "vitest";
import { withTenantScope } from "../integrations/knex.js";
import type { KnexLike, KnexQueryBuilderLike } from "../integrations/knex.js";

function createMockBuilder(): KnexQueryBuilderLike {
  const builder: KnexQueryBuilderLike = {
    where: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue([1]),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
  };
  return builder;
}

function createMockKnex(): KnexLike {
  const builder = createMockBuilder();
  const knex = vi.fn().mockReturnValue(builder) as unknown as KnexLike;
  return knex;
}

describe("withTenantScope", () => {
  it("returns a scoped query builder factory", () => {
    const knex = createMockKnex();
    const scoped = withTenantScope(knex, "tenant1");
    expect(typeof scoped).toBe("function");
  });

  it("scoped builder adds WHERE tenant_id clause for the given tenant", () => {
    const knex = createMockKnex();
    const scoped = withTenantScope(knex, "tenant1");
    const builder = scoped("users");

    expect(knex).toHaveBeenCalledWith("users");
    expect(builder.where).toHaveBeenCalledWith("tenant_id", "tenant1");
  });

  it("works with select chains", () => {
    const knex = createMockKnex();
    const scoped = withTenantScope(knex, "tenant1");
    const builder = scoped("orders");

    builder.select("id", "total");
    expect(builder.select).toHaveBeenCalledWith("id", "total");
  });

  it("works with update chains", () => {
    const knex = createMockKnex();
    const scoped = withTenantScope(knex, "tenant1");
    const builder = scoped("users");

    builder.update({ name: "Alice" });
    expect(builder.update).toHaveBeenCalledWith({ name: "Alice" });
  });

  it("works with delete chains", () => {
    const knex = createMockKnex();
    const scoped = withTenantScope(knex, "tenant1");
    const builder = scoped("users");

    builder.delete();
    expect(builder.delete).toHaveBeenCalled();
  });

  it("works with insert", async () => {
    const knex = createMockKnex();
    const scoped = withTenantScope(knex, "tenant1");
    const builder = scoped("users");

    await builder.insert({ name: "Bob" });
    expect(builder.insert).toHaveBeenCalledWith({ name: "Bob" });
  });
});
