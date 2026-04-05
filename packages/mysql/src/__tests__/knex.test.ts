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

function createMockKnexWithBuilder(): { knex: KnexLike; mockBuilder: KnexQueryBuilderLike } {
  const mockBuilder = createMockBuilder();
  const knex = vi.fn().mockReturnValue(mockBuilder) as unknown as KnexLike;
  return { knex, mockBuilder };
}

describe("withTenantScope", () => {
  it("returns a scoped query builder factory", () => {
    const { knex } = createMockKnexWithBuilder();
    const scoped = withTenantScope(knex, "tenant1");
    expect(typeof scoped).toBe("function");
  });

  it("scoped builder adds WHERE tenant_id clause for the given tenant", () => {
    const { knex } = createMockKnexWithBuilder();
    const scoped = withTenantScope(knex, "tenant1");
    const builder = scoped("users");

    expect(knex).toHaveBeenCalledWith("users");
    expect(builder.where).toHaveBeenCalledWith("tenant_id", "tenant1");
  });

  it("works with select chains", () => {
    const { knex } = createMockKnexWithBuilder();
    const scoped = withTenantScope(knex, "tenant1");
    const builder = scoped("orders");

    builder.select("id", "total");
    expect(builder.select).toHaveBeenCalledWith("id", "total");
  });

  it("works with update chains", () => {
    const { knex } = createMockKnexWithBuilder();
    const scoped = withTenantScope(knex, "tenant1");
    const builder = scoped("users");

    builder.update({ name: "Alice" });
    expect(builder.update).toHaveBeenCalledWith({ name: "Alice" });
  });

  it("works with delete chains", () => {
    const { knex } = createMockKnexWithBuilder();
    const scoped = withTenantScope(knex, "tenant1");
    const builder = scoped("users");

    builder.delete();
    expect(builder.delete).toHaveBeenCalled();
  });

  it("insert injects tenant_id into a single row", async () => {
    const { knex, mockBuilder } = createMockKnexWithBuilder();
    const originalInsertSpy = mockBuilder.insert as ReturnType<typeof vi.fn>;

    const scoped = withTenantScope(knex, "tenant1");
    const builder = scoped("users");

    await builder.insert({ name: "Bob" });
    expect(originalInsertSpy).toHaveBeenCalledWith({ name: "Bob", tenant_id: "tenant1" });
  });

  it("insert injects tenant_id into each row of a batch", async () => {
    const { knex, mockBuilder } = createMockKnexWithBuilder();
    const originalInsertSpy = mockBuilder.insert as ReturnType<typeof vi.fn>;

    const scoped = withTenantScope(knex, "tenant1");
    const builder = scoped("users");

    await builder.insert([{ name: "Alice" }, { name: "Bob" }]);
    expect(originalInsertSpy).toHaveBeenCalledWith([
      { name: "Alice", tenant_id: "tenant1" },
      { name: "Bob", tenant_id: "tenant1" },
    ]);
  });
});
