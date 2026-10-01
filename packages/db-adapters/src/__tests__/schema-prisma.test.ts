import { describe, it, expect } from "vitest";
import { SchemaPrismaAdapter } from "../adapters/schema-prisma.js";

const BASE = "postgresql://user:pass@db.internal:5432/app?sslmode=require";

class FakePrisma {
  static made: FakePrisma[] = [];
  disconnected = false;
  constructor(readonly options: { datasources: { db: { url: string } } }) {
    FakePrisma.made.push(this);
  }
  async $disconnect() {
    this.disconnected = true;
  }
}

describe("SchemaPrismaAdapter with a datasource URL (Prisma 5 and 6)", () => {
  it("names the tenant schema in the datasource URL and keeps the rest of the URL", () => {
    const client = new SchemaPrismaAdapter(FakePrisma, BASE).getClient("acme");
    const url = new URL(client.options.datasources.db.url);
    expect(url.searchParams.get("schema")).toBe("tenant_acme");
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.pathname).toBe("/app");
  });
});

// Prisma 7 removed the `datasources` option. Its client takes a driver adapter,
// such as PrismaPg from @prisma/adapter-pg, which holds the connection settings.
class FakeDriverAdapter {
  constructor(
    readonly config: { connectionString: string },
    readonly options: { schema?: string },
  ) {}
}

class FakePrisma7 {
  static made: FakePrisma7[] = [];
  disconnected = false;
  constructor(readonly options: { adapter: FakeDriverAdapter }) {
    FakePrisma7.made.push(this);
  }
  async $disconnect() {
    this.disconnected = true;
  }
}

function make7(maxClients?: number) {
  FakePrisma7.made = [];
  return new SchemaPrismaAdapter(FakePrisma7, BASE, {
    driverAdapter: FakeDriverAdapter,
    maxClients,
  });
}

describe("SchemaPrismaAdapter with a driver adapter (Prisma 7)", () => {
  it("gives the driver adapter the tenant schema and passes no datasources option", () => {
    const client = make7().getClient("acme");
    expect(client.options).not.toHaveProperty("datasources");
    expect(client.options.adapter.options.schema).toBe("tenant_acme");
    expect(client.options.adapter.config.connectionString).toBe(BASE);
  });

  it("gives each tenant a different schema", () => {
    const adapter = make7();
    expect(adapter.getClient("tenant_a").options.adapter.options.schema).toBe("tenant_tenant_a");
    expect(adapter.getClient("tenant_b").options.adapter.options.schema).toBe("tenant_tenant_b");
  });

  it("rejects an invalid slug before it creates a client", () => {
    expect(() => make7().getClient("x&schema=public")).toThrow();
    expect(FakePrisma7.made).toHaveLength(0);
  });

  it("caches clients up to a bound and disconnects the least recently used", () => {
    const adapter = make7(2);
    const a = adapter.getClient("tenant_a");
    const b = adapter.getClient("tenant_b");
    expect(adapter.getClient("tenant_a")).toBe(a);
    adapter.getClient("tenant_c");
    expect(b.disconnected).toBe(true);
    expect(a.disconnected).toBe(false);
    expect(FakePrisma7.made).toHaveLength(3);
  });

  it("disconnects every cached client", async () => {
    const adapter = make7();
    const a = adapter.getClient("tenant_a");
    const b = adapter.getClient("tenant_b");
    await adapter.disconnectAll();
    expect(a.disconnected && b.disconnected).toBe(true);
  });
});

// Prisma 7 throws a PrismaClientConstructorValidationError with this message
// when a caller without types passes the Prisma 5 and 6 form.
describe("a client class that rejects the datasources option", () => {
  it("throws an error that names the driverAdapter option", () => {
    class Rejecting {
      constructor() {
        throw new Error("Unknown property datasources provided to PrismaClient constructor.");
      }
      async $disconnect() {}
    }
    const adapter = new SchemaPrismaAdapter(Rejecting as never, BASE);
    expect(() => adapter.getClient("acme")).toThrow(/driverAdapter/);
  });

  it("keeps any other constructor error unchanged", () => {
    class Rejecting {
      constructor() {
        throw new Error("Invalid datasource URL");
      }
      async $disconnect() {}
    }
    const adapter = new SchemaPrismaAdapter(Rejecting as never, BASE);
    expect(() => adapter.getClient("acme")).toThrow("Invalid datasource URL");
  });
});
