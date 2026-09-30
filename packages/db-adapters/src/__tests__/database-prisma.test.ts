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
