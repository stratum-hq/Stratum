import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * Typed listing of the webhook event stream against real Postgres:
 * listWebhookEvents is tenant-scoped, paginated, newest-first, and narrowable
 * by type and a created_at window; listDeliveriesByEvent returns exactly the
 * deliveries of one event. Rows are seeded directly (with explicit, spaced
 * created_at values so ordering and pagination are deterministic) rather than
 * through the fire-and-forget delivery loop.
 *
 * Cross-tenant isolation is proven the production way: a non-superuser,
 * NOBYPASSRLS role subject to migration 019's row-level security, so the test
 * exercises a real policy rather than an app-layer WHERE that a superuser would
 * satisfy trivially.
 */
const APP_ROLE = "stratum_evt_rls_test";

describe("webhook event listing (integration)", () => {
  let stratum: Stratum;

  beforeAll(async () => {
    process.env.STRATUM_ENCRYPTION_KEY = "test-encryption-key-32chars-long!";
    await runMigrations();
    stratum = new Stratum({ pool: getPool() });

    // A non-superuser, non-BYPASSRLS role is the whole point of the isolation
    // test: it is subject to RLS exactly like the production app role.
    const c = await getPool().connect();
    try {
      await c.query(`DO $$ BEGIN
        CREATE ROLE ${APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
      await c.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
      await c.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`,
      );
    } finally {
      c.release();
    }
  });

  afterEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    delete process.env.STRATUM_ENCRYPTION_KEY;
    await closePool();
  });

  async function rawTenant(slug: string): Promise<string> {
    const r = await getPool().query<{ id: string }>(
      `INSERT INTO tenants (name, slug, ancestry_path, depth) VALUES ($1,$2,'/',0) RETURNING id`,
      [slug, slug],
    );
    return r.rows[0].id;
  }
  /** Insert an event created `secondsAgo` in the past so ordering is deterministic. */
  async function rawEvent(
    tenantId: string,
    type = "tenant.created",
    secondsAgo = 0,
  ): Promise<string> {
    const r = await getPool().query<{ id: string }>(
      `INSERT INTO webhook_events (type, tenant_id, data, created_at)
       VALUES ($1,$2,'{}', now() - ($3 || ' seconds')::interval) RETURNING id`,
      [type, tenantId, secondsAgo],
    );
    return r.rows[0].id;
  }
  /** Insert an event at an exact created_at so several rows can share a timestamp. */
  async function rawEventAtExact(tenantId: string, createdAt: string): Promise<string> {
    const r = await getPool().query<{ id: string }>(
      `INSERT INTO webhook_events (type, tenant_id, data, created_at)
       VALUES ('tenant.created',$1,'{}',$2::timestamptz) RETURNING id`,
      [tenantId, createdAt],
    );
    return r.rows[0].id;
  }
  async function rawWebhook(tenantId: string): Promise<string> {
    const r = await getPool().query<{ id: string }>(
      `INSERT INTO webhooks (tenant_id, url, secret_hash, events) VALUES ($1,'https://example.com/h','h',$2) RETURNING id`,
      [tenantId, ["tenant.created"]],
    );
    return r.rows[0].id;
  }
  async function rawDelivery(webhookId: string, eventId: string, status: string): Promise<string> {
    const r = await getPool().query<{ id: string }>(
      `INSERT INTO webhook_deliveries (webhook_id, event_id, status, completed_at)
       VALUES ($1,$2,$3, CASE WHEN $3 = 'pending' THEN NULL ELSE now() END) RETURNING id`,
      [webhookId, eventId, status],
    );
    return r.rows[0].id;
  }

  it("scopes the listing to the requested tenant", async () => {
    const a = await rawTenant(uniqueSlug("evt_a"));
    const b = await rawTenant(uniqueSlug("evt_b"));
    const a1 = await rawEvent(a, "tenant.created", 20);
    const a2 = await rawEvent(a, "tenant.updated", 10);
    await rawEvent(b, "tenant.created", 15); // other tenant: excluded

    const events = await stratum.listWebhookEvents({ tenantId: a });
    expect(events.map((e) => e.id).sort()).toEqual([a1, a2].sort());
    for (const e of events) expect(e.tenant_id).toBe(a);
  });

  it("returns events newest-first", async () => {
    const a = await rawTenant(uniqueSlug("evt_ord"));
    const oldest = await rawEvent(a, "tenant.created", 30);
    const middle = await rawEvent(a, "tenant.created", 20);
    const newest = await rawEvent(a, "tenant.created", 10);

    const events = await stratum.listWebhookEvents({ tenantId: a });
    expect(events.map((e) => e.id)).toEqual([newest, middle, oldest]);
    // Contract: created_at is returned as a string (::text), not a Date.
    expect(typeof events[0].created_at).toBe("string");
  });

  it("paginates with limit and offset over the newest-first order", async () => {
    const a = await rawTenant(uniqueSlug("evt_pg"));
    // e0 oldest .. e4 newest -> newest-first is [e4,e3,e2,e1,e0].
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await rawEvent(a, "tenant.created", (5 - i) * 10));
    }
    const desc = [...ids].reverse();

    const page1 = await stratum.listWebhookEvents({ tenantId: a, limit: 2, offset: 0 });
    const page2 = await stratum.listWebhookEvents({ tenantId: a, limit: 2, offset: 2 });
    const page3 = await stratum.listWebhookEvents({ tenantId: a, limit: 2, offset: 4 });

    expect(page1.map((e) => e.id)).toEqual(desc.slice(0, 2));
    expect(page2.map((e) => e.id)).toEqual(desc.slice(2, 4));
    expect(page3.map((e) => e.id)).toEqual(desc.slice(4, 6)); // one row, no overlap
  });

  it("filters by event type", async () => {
    const a = await rawTenant(uniqueSlug("evt_type"));
    const created = await rawEvent(a, "tenant.created", 30);
    await rawEvent(a, "tenant.updated", 20);
    await rawEvent(a, "config.updated", 10);

    const events = await stratum.listWebhookEvents({ tenantId: a, type: "tenant.created" });
    expect(events.map((e) => e.id)).toEqual([created]);
    expect(events[0].type).toBe("tenant.created");
  });

  it("filters by a created_at window (from/to inclusive)", async () => {
    const a = await rawTenant(uniqueSlug("evt_time"));
    const old = await rawEvent(a, "tenant.created", 300); // ~5 min ago
    const mid = await rawEvent(a, "tenant.created", 120); // ~2 min ago
    const recent = await rawEvent(a, "tenant.created", 10);

    const from = new Date(Date.now() - 200 * 1000).toISOString();
    const to = new Date(Date.now() - 60 * 1000).toISOString();

    const afterFrom = await stratum.listWebhookEvents({ tenantId: a, from });
    expect(afterFrom.map((e) => e.id).sort()).toEqual([mid, recent].sort());
    expect(afterFrom.map((e) => e.id)).not.toContain(old);

    const window = await stratum.listWebhookEvents({ tenantId: a, from, to });
    expect(window.map((e) => e.id)).toEqual([mid]);
  });

  it("lists exactly the deliveries of one event", async () => {
    const a = await rawTenant(uniqueSlug("evt_del"));
    const w = await rawWebhook(a);
    const event = await rawEvent(a);
    const other = await rawEvent(a);
    const d1 = await rawDelivery(w, event, "success");
    const d2 = await rawDelivery(w, event, "failed");
    await rawDelivery(w, other, "pending"); // different event: excluded

    const deliveries = await stratum.listDeliveriesByEvent(event);
    expect(deliveries.map((d) => d.id).sort()).toEqual([d1, d2].sort());
    for (const d of deliveries) expect(d.event_id).toBe(event);
    expect(deliveries.map((d) => d.status).sort()).toEqual(["failed", "success"]);
    // Contract: delivery timestamps are returned as strings (::text), not Dates.
    expect(typeof deliveries[0].created_at).toBe("string");
    expect(typeof deliveries[0].completed_at).toBe("string"); // success/failed rows are completed

    // An event with no deliveries (or an unknown id) yields an empty list.
    expect(await stratum.listDeliveriesByEvent("00000000-0000-0000-0000-000000000000")).toEqual([]);
  });

  it("paginates deterministically when rows share a created_at (id tiebreaker)", async () => {
    const a = await rawTenant(uniqueSlug("evt_tie"));
    const ts = new Date(Date.now() - 60 * 1000).toISOString();
    const ids = new Set<string>();
    for (let i = 0; i < 4; i++) ids.add(await rawEventAtExact(a, ts));

    // With only created_at DESC these rows would order arbitrarily; the id
    // tiebreaker makes the order total, so it is stable across calls...
    const full1 = (await stratum.listWebhookEvents({ tenantId: a, limit: 100 })).map((e) => e.id);
    const full2 = (await stratum.listWebhookEvents({ tenantId: a, limit: 100 })).map((e) => e.id);
    expect(full1).toHaveLength(4);
    expect(full2).toEqual(full1);

    // ...and paging it covers every row exactly once, no overlap or gap.
    const page1 = (await stratum.listWebhookEvents({ tenantId: a, limit: 2, offset: 0 })).map((e) => e.id);
    const page2 = (await stratum.listWebhookEvents({ tenantId: a, limit: 2, offset: 2 })).map((e) => e.id);
    expect(page1).toEqual(full1.slice(0, 2));
    expect(page2).toEqual(full1.slice(2, 4));
    expect(new Set([...page1, ...page2])).toEqual(ids);
  });

  it("hides another tenant's events from a non-superuser role bound to tenant A", async () => {
    const a = await rawTenant(uniqueSlug("evt_iso_a"));
    const b = await rawTenant(uniqueSlug("evt_iso_b"));
    const aEvent = await rawEvent(a, "tenant.created", 10);
    const bEvent = await rawEvent(b, "tenant.created", 10);

    // App-layer guarantee via the public facade: A's listing never contains B.
    const facade = await stratum.listWebhookEvents({ tenantId: a });
    expect(facade.map((e) => e.id)).toEqual([aEvent]);

    // Defense in depth: under the RLS role with context = A, B's event is
    // invisible even to a query that explicitly asks for it.
    const c = await getPool().connect();
    try {
      await c.query("BEGIN");
      await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [a]);

      // No WHERE filter at all: RLS must scope this to tenant A.
      const all = await c.query<{ id: string; tenant_id: string }>(
        "SELECT id, tenant_id FROM webhook_events",
      );
      expect(all.rows.map((r) => r.id)).toEqual([aEvent]);
      expect(all.rows.every((r) => r.tenant_id === a)).toBe(true);

      // Explicitly asking for B's event returns nothing: RLS filters first.
      const askB = await c.query("SELECT id FROM webhook_events WHERE id = $1", [bEvent]);
      expect(askB.rowCount ?? 0).toBe(0);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });
});
