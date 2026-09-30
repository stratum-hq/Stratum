import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from "vitest";
import dns from "node:dns/promises";
// processDeliveries is internal (not exported from the package entry point);
// import the built module directly so each pass can be awaited.
import { processDeliveries } from "../../lib/dist/services/event-service.js";
import { encrypt } from "../../lib/dist/crypto.js";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
} from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

// Fixed key material before any lib module loads, so the secret encrypted by
// this file decrypts inside the delivery code whichever module copy runs it.
vi.hoisted(() => {
  process.env.STRATUM_ENCRYPTION_KEY = "test-encryption-key-32chars-long!";
  process.env.STRATUM_HKDF_SALT = "00".repeat(32);
});

/**
 * Delivery queue behavior against real Postgres. DNS is stubbed so a test can
 * hold a delivery in its outbound network phase for as long as it likes,
 * without real sleeps.
 * The stubs replace methods on the shared node:dns/promises object, which the
 * built library calls through at request time.
 */
const dnsControl = (() => {
  let release: (() => void) | null = null;
  let gate: Promise<void> = Promise.resolve();
  const state = { outboundWaits: 0 };
  return {
    state,
    hold() {
      gate = new Promise<void>((r) => {
        release = r;
      });
    },
    release() {
      release?.();
      release = null;
    },
    get gate() {
      return gate;
    },
  };
})();

function notFound(): Error {
  return Object.assign(new Error("queryA ENOTFOUND"), { code: "ENOTFOUND" });
}

async function answer(hostname: string): Promise<string[]> {
  if (hostname === "slow-hook.test") {
    dnsControl.state.outboundWaits++;
    await dnsControl.gate;
    throw notFound();
  }
  throw notFound();
}

function stubDns(): void {
  vi.spyOn(dns, "resolve4").mockImplementation(((h: string) =>
    answer(h)) as typeof dns.resolve4);
  vi.spyOn(dns, "resolve6").mockImplementation((async () => {
    throw notFound();
  }) as typeof dns.resolve6);
  vi.spyOn(dns, "lookup").mockImplementation((async (h: string) =>
    (await answer(h)).map((address) => ({
      address,
      family: 4,
    }))) as unknown as typeof dns.lookup);
}

describe("webhook delivery queue (integration)", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(() => {
    stubDns();
  });

  afterEach(async () => {
    dnsControl.release();
    vi.restoreAllMocks();
    dnsControl.state.outboundWaits = 0;
    await cleanTestData();
  });

  afterAll(async () => {
    delete process.env.STRATUM_ENCRYPTION_KEY;
    delete process.env.STRATUM_HKDF_SALT;
    await closePool();
  });

  async function rawTenant(): Promise<string> {
    const slug = uniqueSlug("wq");
    const r = await getPool().query<{ id: string }>(
      `INSERT INTO tenants (name, slug, ancestry_path, depth) VALUES ($1,$2,'/',0) RETURNING id`,
      [slug, slug],
    );
    return r.rows[0].id;
  }
  async function rawWebhook(
    tenantId: string,
    url: string,
    secretHash = encrypt("s"),
  ): Promise<string> {
    const r = await getPool().query<{ id: string }>(
      `INSERT INTO webhooks (tenant_id, url, secret_hash, events, active)
       VALUES ($1,$2,$3,ARRAY['tenant.created'],true) RETURNING id`,
      [tenantId, url, secretHash],
    );
    return r.rows[0].id;
  }
  async function rawEvent(tenantId: string): Promise<string> {
    const r = await getPool().query<{ id: string }>(
      `INSERT INTO webhook_events (type, tenant_id) VALUES ('tenant.created',$1) RETURNING id`,
      [tenantId],
    );
    return r.rows[0].id;
  }
  async function pendingDeliveries(
    webhookId: string,
    eventId: string,
    n: number,
    ageSeconds = 0,
  ): Promise<string[]> {
    const r = await getPool().query<{ id: string }>(
      `INSERT INTO webhook_deliveries (webhook_id, event_id, status, attempts, created_at)
       SELECT $1, $2, 'pending', 0, now() - make_interval(secs => $4) + make_interval(secs => g)
       FROM generate_series(1, $3) g
       RETURNING id`,
      [webhookId, eventId, n, ageSeconds],
    );
    return r.rows.map((row) => row.id);
  }
  async function delivery(id: string) {
    const r = await getPool().query<{
      status: string;
      attempts: number;
      due_later: boolean;
      last_error: string | null;
    }>(
      `SELECT status, attempts, (next_retry_at > now()) AS due_later, last_error
       FROM webhook_deliveries WHERE id = $1`,
      [id],
    );
    return r.rows[0];
  }
  async function idleInTransaction(): Promise<number> {
    const r = await getPool().query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid()
         AND state LIKE 'idle in transaction%'`,
    );
    return Number(r.rows[0].n);
  }

  describe("failures before the HTTP request", () => {
    it("counts a delivery whose URL fails validation as a failed attempt and schedules a retry", async () => {
      const t = await rawTenant();
      const wh = await rawWebhook(t, "http://127.0.0.1:9/hook");
      const [id] = await pendingDeliveries(wh, await rawEvent(t), 1);

      await processDeliveries(getPool());

      const row = await delivery(id);
      expect(row.status).toBe("pending");
      expect(row.attempts).toBe(1);
      expect(row.due_later).toBe(true);
      expect(row.last_error).toBeTruthy();
    });

    it("moves a delivery whose secret cannot be decrypted to failed after the maximum attempts", async () => {
      const t = await rawTenant();
      // Public IP literal: passes URL validation; the stored secret does not decrypt.
      const wh = await rawWebhook(
        t,
        "https://203.0.113.10/hook",
        "not-decryptable",
      );
      const [id] = await pendingDeliveries(wh, await rawEvent(t), 1);

      for (let i = 0; i < 5; i++) {
        await processDeliveries(getPool());
        await getPool().query(
          `UPDATE webhook_deliveries SET next_retry_at = now() - interval '1 second'
           WHERE id = $1 AND status = 'pending'`,
          [id],
        );
      }

      const row = await delivery(id);
      expect(row.status).toBe("failed");
      expect(row.attempts).toBe(5);
    });

    it("keeps delivering other tenants' webhooks when one tenant has a backlog of undeliverable ones", async () => {
      const noisy = await rawTenant();
      const noisyHook = await rawWebhook(noisy, "http://127.0.0.1:9/hook");
      await pendingDeliveries(noisyHook, await rawEvent(noisy), 120, 3600);

      const other = await rawTenant();
      const otherHook = await rawWebhook(other, "http://127.0.0.1:10/hook");
      const [otherId] = await pendingDeliveries(
        otherHook,
        await rawEvent(other),
        1,
      );

      await processDeliveries(getPool());
      await processDeliveries(getPool());

      expect((await delivery(otherId)).attempts).toBeGreaterThanOrEqual(1);
    });
    it("delivers another tenant's webhook while one tenant's endpoint is stalled", async () => {
      const noisy = await rawTenant();
      const noisyHook = await rawWebhook(noisy, "http://slow-hook.test/hook");
      await pendingDeliveries(noisyHook, await rawEvent(noisy), 20, 3600);

      const other = await rawTenant();
      const otherHook = await rawWebhook(other, "http://127.0.0.1:10/hook");
      const [otherId] = await pendingDeliveries(
        otherHook,
        await rawEvent(other),
        1,
      );

      dnsControl.hold();
      const run = processDeliveries(getPool());
      await vi.waitFor(
        async () => {
          const row = await delivery(otherId);
          expect(row.attempts).toBe(1);
          expect(row.last_error).toBeTruthy();
        },
        { timeout: 3000 },
      );
      // The noisy tenant's deliveries are still waiting on the network.
      expect(dnsControl.state.outboundWaits).toBeGreaterThan(0);

      dnsControl.release();
      await run;
    });
  });

  describe("outbound calls do not hold database connections", () => {
    it("holds no transaction open while a delivery waits on the network", async () => {
      const t = await rawTenant();
      const wh = await rawWebhook(t, "http://slow-hook.test/hook");
      await pendingDeliveries(wh, await rawEvent(t), 1);

      dnsControl.hold();
      const run = processDeliveries(getPool());
      await vi.waitFor(
        () => expect(dnsControl.state.outboundWaits).toBeGreaterThan(0),
        {
          timeout: 5000,
        },
      );

      expect(await idleInTransaction()).toBe(0);

      dnsControl.release();
      await run;
    });

    it("keeps the pool available when many delivery runs are triggered against a stalled endpoint", async () => {
      const t = await rawTenant();
      const wh = await rawWebhook(t, "http://slow-hook.test/hook");
      await pendingDeliveries(wh, await rawEvent(t), 8);

      dnsControl.hold();
      // One trigger per emitted event, as emitEvent/retry do.
      const runs = Array.from({ length: 8 }, () =>
        processDeliveries(getPool()),
      );
      await vi.waitFor(
        () => expect(dnsControl.state.outboundWaits).toBeGreaterThan(0),
        {
          timeout: 5000,
        },
      );
      // Let every trigger reach its outbound phase.
      await new Promise((r) => setTimeout(r, 200));

      const acquired = await Promise.race([
        getPool()
          .query("SELECT 1")
          .then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 1000)),
      ]);
      expect(acquired).toBe(true);
      expect(await idleInTransaction()).toBe(0);

      dnsControl.release();
      await Promise.all(runs);
    });
  });
});
