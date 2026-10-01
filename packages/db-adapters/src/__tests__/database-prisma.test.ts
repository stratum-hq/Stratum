import { describe, it, expect } from "vitest";
import { DatabasePrismaAdapter } from "../adapters/database-prisma.js";
import type { DatabasePoolManager } from "../database/pool-manager.js";

class FakePrisma {
  static made: FakePrisma[] = [];
  url: string;
  disconnected = false;
  constructor(options: { datasources: { db: { url: string } } }) {
    this.url = options.datasources.db.url;
    FakePrisma.made.push(this);
  }
  $extends() {
    return this;
  }
  async $executeRaw() {
    return 0;
  }
  async $transaction() {
    return undefined;
  }
  async $connect() {}
  async $disconnect() {
    this.disconnected = true;
  }
}

const BASE = "postgresql://user:pass@db.internal:5432/app?sslmode=require";
const poolManager = {} as DatabasePoolManager;

function make(maxClients?: number) {
  FakePrisma.made = [];
  return new DatabasePrismaAdapter(poolManager, FakePrisma as never, BASE, maxClients);
}

describe("DatabasePrismaAdapter", () => {
  it("points the client at the tenant database and keeps the rest of the URL", () => {
    const client = make().getClient("acme") as unknown as FakePrisma;
    const url = new URL(client.url);
    expect(url.pathname).toBe("/stratum_tenant_acme");
    expect(url.host).toBe("db.internal:5432");
    expect(url.username).toBe("user");
    expect(url.searchParams.get("sslmode")).toBe("require");
  });

  it.each(["x?host=/tmp", "x@other.host", "x/../y", "x$&", "Acme"])(
    "rejects a slug that is not a valid tenant slug (%s)",
    (slug) => {
      expect(() => make().getClient(slug)).toThrow();
      expect(FakePrisma.made).toHaveLength(0);
    },
  );

  it("caches clients up to a bound and disconnects the least recently used", () => {
    const adapter = make(2);
    const a = adapter.getClient("tenant_a") as unknown as FakePrisma;
    const b = adapter.getClient("tenant_b") as unknown as FakePrisma;
    expect(adapter.getClient("tenant_a")).toBe(a);
    adapter.getClient("tenant_c");
    expect(b.disconnected).toBe(true);
    expect(a.disconnected).toBe(false);
    expect(FakePrisma.made).toHaveLength(3);
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

function make7(base = BASE, maxClients?: number) {
  FakePrisma7.made = [];
  return new DatabasePrismaAdapter(poolManager, FakePrisma7, base, {
    driverAdapter: FakeDriverAdapter,
    maxClients,
  });
}

describe("DatabasePrismaAdapter with a driver adapter (Prisma 7)", () => {
  it("gives the driver adapter the tenant database URL and passes no datasources option", () => {
    const client = make7().getClient("acme");
    expect(client.options).not.toHaveProperty("datasources");
    const url = new URL(client.options.adapter.config.connectionString);
    expect(url.pathname).toBe("/stratum_tenant_acme");
    expect(url.host).toBe("db.internal:5432");
    expect(url.username).toBe("user");
    expect(url.searchParams.get("sslmode")).toBe("require");
  });

  it("gives each tenant a different database", () => {
    const adapter = make7();
    const a = adapter.getClient("tenant_a").options.adapter.config.connectionString;
    const b = adapter.getClient("tenant_b").options.adapter.config.connectionString;
    expect(new URL(a).pathname).toBe("/stratum_tenant_tenant_a");
    expect(new URL(b).pathname).toBe("/stratum_tenant_tenant_b");
  });

  it("passes the schema parameter of the base URL to the driver adapter", () => {
    // Prisma 5 and 6 read `schema` from the URL. A driver adapter ignores it,
    // so the tables would silently resolve in `public`.
    const client = make7(`${BASE}&schema=app`).getClient("acme");
    expect(client.options.adapter.options.schema).toBe("app");
  });

  it("leaves the schema unset when the base URL names none", () => {
    const client = make7().getClient("acme");
    expect(client.options.adapter.options.schema).toBeUndefined();
  });

  it("rejects an invalid slug before it creates a client", () => {
    expect(() => make7().getClient("x@other.host")).toThrow();
    expect(FakePrisma7.made).toHaveLength(0);
  });

  it("caches clients up to a bound and disconnects the least recently used", () => {
    const adapter = make7(BASE, 2);
    const a = adapter.getClient("tenant_a");
    const b = adapter.getClient("tenant_b");
    expect(adapter.getClient("tenant_a")).toBe(a);
    adapter.getClient("tenant_c");
    expect(b.disconnected).toBe(true);
    expect(a.disconnected).toBe(false);
    expect(FakePrisma7.made).toHaveLength(3);
  });
});
