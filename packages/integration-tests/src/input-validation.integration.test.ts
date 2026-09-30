import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum, ValidationError } from "@stratum-hq/lib";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
} from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * Library callers that skip the control plane get a ValidationError, not a
 * PostgreSQL error, for input that a column cannot store. Each case also checks
 * that no row reached the table.
 */
describe("library input validation against real Postgres (integration)", () => {
  let stratum: Stratum;

  beforeAll(async () => {
    await runMigrations();
    stratum = new Stratum({ pool: getPool() });
  }, 30000);

  afterEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await closePool();
  });

  it("createAbacPolicy rejects a priority outside the int4 range with a ValidationError", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("ivp") });

    const err = await stratum
      .createAbacPolicy(t.id, {
        name: "p",
        resource_type: "doc",
        action: "read",
        effect: "allow",
        conditions: [],
        priority: 2147483648,
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ValidationError);
    const rows = await getPool().query(`SELECT 1 FROM abac_policies WHERE tenant_id = $1`, [t.id]);
    expect(rows.rowCount).toBe(0);
  });

  it("grantConsent rejects an 'infinity' expires_at with a ValidationError", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("ivc") });

    const err = await stratum
      .grantConsent(t.id, { subject_id: "s1", purpose: "analytics", expires_at: "infinity" })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ValidationError);
    const rows = await getPool().query(`SELECT 1 FROM consent_records WHERE tenant_id = $1`, [t.id]);
    expect(rows.rowCount).toBe(0);
  });

  it("recordAuditEvent rejects an invalid sourceIp with a ValidationError", async () => {
    const t = await stratum.createTenant({ name: "T", slug: uniqueSlug("iva") });

    const err = await stratum
      .recordAuditEvent({
        tenantId: t.id,
        actorId: "user-1",
        action: "x",
        resourceType: "y",
        resourceId: null,
        sourceIp: "not-an-ip",
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ValidationError);
    const rows = await getPool().query(
      `SELECT 1 FROM audit_logs WHERE tenant_id = $1 AND actor_id = 'user-1'`,
      [t.id],
    );
    expect(rows.rowCount).toBe(0);
  });
});
