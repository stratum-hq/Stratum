import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
  getAdminPool,
} from "./helpers/db.js";

/** Polls until `check` returns true, or fails after `timeoutMs`. */
async function waitFor(check: () => Promise<boolean>, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe("webhook deliveries use the webhooks that existed when the event was created (integration)", () => {
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

  it("does not deliver an event to a webhook registered after the event was created", async () => {
    const parent = await stratum.createTenant({ name: "Snapshot parent", slug: "wh_snap_parent" });
    const before = await stratum.createWebhook({
      tenant_id: parent.id,
      url: "https://example.com/before",
      secret: "before-secret",
      events: ["tenant.updated"],
    });

    // The EXCLUSIVE lock blocks the INSERT into webhook_events. The emission
    // then waits between the start of its event insert and its webhook
    // selection, which is the interval that the second webhook falls into.
    const holder = await getPool().connect();
    let held = false;
    try {
      await holder.query("BEGIN");
      await holder.query("LOCK TABLE webhook_events IN EXCLUSIVE MODE");
      held = true;

      await stratum.updateTenant(parent.id, { name: "Snapshot parent renamed" });
      await waitFor(async () => {
        const res = await getPool().query(
          `SELECT 1 FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND query LIKE '%INSERT INTO webhook_events%'`,
        );
        return res.rows.length > 0;
      }, "the event insert to wait on the lock");

      const after = await stratum.createWebhook({
        tenant_id: parent.id,
        url: "https://example.com/after",
        secret: "after-secret",
        events: ["tenant.updated"],
      });

      await holder.query("COMMIT");
      held = false;

      await waitFor(
        async () => (await stratum.listWebhookDeliveries(before.id)).length > 0,
        "the delivery to the webhook that existed before the event",
      );
      // A delivery row for the second webhook can follow the first row. The
      // pause gives the emission time to finish before the check.
      await new Promise((r) => setTimeout(r, 500));
      expect(await stratum.listWebhookDeliveries(before.id)).toHaveLength(1);
      expect(await stratum.listWebhookDeliveries(after.id)).toEqual([]);
    } finally {
      if (held) await holder.query("ROLLBACK");
      holder.release();
    }
  });
});
