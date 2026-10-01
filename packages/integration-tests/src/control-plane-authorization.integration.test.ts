import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import crypto from "node:crypto";
import { Stratum } from "@stratum-hq/lib";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
  getAdminPool,
} from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

// Drives the real control-plane app (full middleware chain) against a real
// Postgres, so authorization is proven end to end: the API key is validated
// against the api_keys table, effective scopes resolve through the role join,
// and a refused mutation is checked against the rows that remain.

const JWT_SECRET = "integration-test-jwt-secret";
// Configure the control plane before its config module is first imported.
process.env.JWT_SECRET = JWT_SECRET;
process.env.RATE_LIMIT_MAX = "1000";

type ControlPlaneApp = typeof import("../../control-plane/dist/app.js");
type ControlPlaneDb = typeof import("../../control-plane/dist/db/connection.js");

let app: Awaited<ReturnType<ControlPlaneApp["buildApp"]>>;
let cpDb: ControlPlaneDb;
let stratum: Stratum;

interface Fixture {
  A: string;
  A1: string;
  A1a: string;
  B: string;
  operatorKey: string;
  writeKeyA: { id: string; plaintext: string };
  adminKeyA: string;
  keyA1: string;
  adminKeyB: string;
}

let fx: Fixture;

async function makeKey(
  tenantId: string | null,
  scopes: string[] | null,
): Promise<{ id: string; plaintext: string }> {
  // createApiKey requires a tenant; an operator key is a key with no tenant.
  const created = await stratum.createApiKey(tenantId ?? fx.A);
  if (tenantId === null) {
    await getPool().query("UPDATE api_keys SET tenant_id = NULL WHERE id = $1", [created.id]);
  }
  if (scopes) {
    await getPool().query("UPDATE api_keys SET scopes = $2 WHERE id = $1", [created.id, scopes]);
  }
  return { id: created.id, plaintext: created.plaintext_key };
}

function withKey(key: string) {
  return { "x-api-key": key };
}

/** Sign an HS256 JWT with the control plane's secret. */
function signJwt(payload: Record<string, unknown>): string {
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iat: Math.floor(Date.now() / 1000), ...payload })}`;
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

async function tenantExists(id: string): Promise<boolean> {
  const res = await getPool().query("SELECT 1 FROM tenants WHERE id = $1", [id]);
  return res.rows.length > 0;
}

describe("control-plane authorization against real Postgres (integration)", () => {
  beforeAll(async () => {
    await runMigrations();
    stratum = new Stratum({ pool: getPool(), adminPool: getAdminPool() });
    const cpApp: ControlPlaneApp = await import("../../control-plane/dist/app.js");
    cpDb = await import("../../control-plane/dist/db/connection.js");
    app = await cpApp.buildApp();
    app.log.level = "silent";
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await cpDb.closePool();
    await cleanTestData();
    await closePool();
  });

  beforeEach(async () => {
    await cleanTestData();
    const A = await stratum.createTenant({
      name: "Tenant A",
      slug: uniqueSlug("a"),
      metadata: { internal_note: "parent-only" },
    });
    fx = { A: A.id } as Fixture;
    const A1 = await stratum.createTenant({ name: "Tenant A1", slug: uniqueSlug("a1"), parent_id: A.id });
    const A1a = await stratum.createTenant({ name: "Tenant A1a", slug: uniqueSlug("a1a"), parent_id: A1.id });
    const B = await stratum.createTenant({ name: "Tenant B", slug: uniqueSlug("b") });
    fx.A1 = A1.id;
    fx.A1a = A1a.id;
    fx.B = B.id;
    fx.operatorKey = (await makeKey(null, ["read", "write", "admin"])).plaintext;
    // Default column scopes: {read,write}.
    fx.writeKeyA = await makeKey(A.id, null);
    fx.adminKeyA = (await makeKey(A.id, ["read", "write", "admin"])).plaintext;
    fx.keyA1 = (await makeKey(A1.id, ["read", "write", "admin"])).plaintext;
    fx.adminKeyB = (await makeKey(B.id, ["read", "write", "admin"])).plaintext;
  });

  describe("role management requires admin scope", () => {
    it("refuses role creation by a read/write key", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/roles",
        headers: withKey(fx.writeKeyA.plaintext),
        payload: { name: "elevated", scopes: ["admin"], tenant_id: fx.A },
      });
      expect(res.statusCode).toBe(403);
      const rows = await getPool().query("SELECT 1 FROM roles WHERE name = 'elevated'");
      expect(rows.rows).toHaveLength(0);
    });

    it("refuses role assignment by a read/write key, so it keeps its own scopes", async () => {
      const role = await stratum.createRole({ name: "a-admin", scopes: ["admin"], tenant_id: fx.A });
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/roles/assign/${fx.writeKeyA.id}`,
        headers: withKey(fx.writeKeyA.plaintext),
        payload: { role_id: role.id },
      });
      expect(res.statusCode).toBe(403);
      const after = await app.inject({
        method: "GET",
        url: "/api/v1/audit-logs",
        headers: withKey(fx.writeKeyA.plaintext),
      });
      expect(after.statusCode).toBe(403);
    });

    it("still lets a tenant admin create a role in its own tenant", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/roles",
        headers: withKey(fx.adminKeyA),
        payload: { name: "a-readers", scopes: ["read"], tenant_id: fx.A },
      });
      expect(res.statusCode).toBe(201);
    });
  });

  describe("admin scope is decided by the matched route, not the raw URL", () => {
    it("requires admin for purge however the path is spelled", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/tenants/${fx.A1a}/%70urge`,
        headers: withKey(fx.writeKeyA.plaintext),
      });
      expect(res.statusCode).toBe(403);
      expect(await tenantExists(fx.A1a)).toBe(true);
    });

    it("requires admin for export however the path is spelled", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/tenants/${fx.A}/%65xport`,
        headers: withKey(fx.writeKeyA.plaintext),
      });
      expect(res.statusCode).toBe(403);
    });

    it("requires admin for api-keys and maintenance however the path is spelled", async () => {
      const keys = await app.inject({
        method: "GET",
        url: "/api/v1/%61pi-keys",
        headers: withKey(fx.writeKeyA.plaintext),
      });
      expect(keys.statusCode).toBe(403);
      const maint = await app.inject({
        method: "POST",
        url: "/api/v1/%6daintenance/purge-expired?retention_days=1",
        headers: withKey(fx.writeKeyA.plaintext),
      });
      expect(maint.statusCode).toBe(403);
    });
  });

  describe("global roles are operator-only for mutation", () => {
    it("refuses a tenant admin updating or deleting a global role", async () => {
      const global = await stratum.createRole({ name: "global-readonly", scopes: ["read"], tenant_id: null });
      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/roles/${global.id}`,
        headers: withKey(fx.adminKeyA),
        payload: { scopes: ["read", "write", "admin"] },
      });
      expect(patch.statusCode).toBe(403);
      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/roles/${global.id}`,
        headers: withKey(fx.adminKeyA),
      });
      expect(del.statusCode).toBe(403);
      const row = await stratum.getRole(global.id);
      expect(row?.scopes).toEqual(["read"]);
    });

    it("confines a tenant admin's role without a tenant_id to its own tenant", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/roles",
        headers: withKey(fx.adminKeyA),
        payload: { name: "no-tenant-given", scopes: ["read"] },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().tenant_id).toBe(fx.A);
      const globals = await getPool().query("SELECT 1 FROM roles WHERE tenant_id IS NULL");
      expect(globals.rows).toHaveLength(0);
    });

    it("lets an operator key update a global role", async () => {
      const global = await stratum.createRole({ name: "global-op", scopes: ["read"], tenant_id: null });
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/roles/${global.id}`,
        headers: withKey(fx.operatorKey),
        payload: { scopes: ["read", "write"] },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("maintenance and region mutations are operator-only", () => {
    it("refuses purge-expired to a tenant admin key and to a tenant admin JWT", async () => {
      const key = await app.inject({
        method: "POST",
        url: "/api/v1/maintenance/purge-expired?retention_days=1",
        headers: withKey(fx.adminKeyA),
      });
      expect(key.statusCode).toBe(403);
      const token = signJwt({ sub: "u1", tenant_id: fx.A, scopes: ["read", "write", "admin"] });
      const viaJwt = await app.inject({
        method: "POST",
        url: "/api/v1/maintenance/purge-expired?retention_days=1",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(viaJwt.statusCode).toBe(403);
    });

    it("refuses region create, update and delete to a tenant admin key", async () => {
      const region = await stratum.createRegion({ display_name: "EU", slug: uniqueSlug("eu") });
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/regions",
        headers: withKey(fx.adminKeyA),
        payload: { display_name: "X", slug: uniqueSlug("x") },
      });
      expect(create.statusCode).toBe(403);
      const update = await app.inject({
        method: "PATCH",
        url: `/api/v1/regions/${region.id}`,
        headers: withKey(fx.adminKeyA),
        payload: { status: "inactive" },
      });
      expect(update.statusCode).toBe(403);
      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/regions/${region.id}`,
        headers: withKey(fx.adminKeyA),
      });
      expect(del.statusCode).toBe(403);
      expect((await stratum.getRegion(region.id)).status).toBe("active");
    });

    it("lets an operator key run maintenance and manage regions", async () => {
      const purge = await app.inject({
        method: "POST",
        url: "/api/v1/maintenance/purge-expired?retention_days=30",
        headers: withKey(fx.operatorKey),
      });
      expect(purge.statusCode).toBe(200);
      const audit = await getPool().query(
        "SELECT metadata FROM audit_logs WHERE action = 'data.expired_purged'",
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0].metadata).toMatchObject({ retention_days: 30 });
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/regions",
        headers: withKey(fx.operatorKey),
        payload: { display_name: "Y", slug: uniqueSlug("y") },
      });
      expect(create.statusCode).toBe(201);
    });
  });

  describe("role listing stays inside the caller's scope", () => {
    it("does not list other tenants' roles when the tenant_id filter is empty", async () => {
      const foreign = await stratum.createRole({ name: "b-only", scopes: ["read"], tenant_id: fx.B });
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/roles?tenant_id=",
        headers: withKey(fx.writeKeyA.plaintext),
      });
      if (res.statusCode === 200) {
        const ids = (res.json() as Array<{ id: string }>).map((r) => r.id);
        expect(ids).not.toContain(foreign.id);
      } else {
        // Refused: 400 for the empty filter, or 403.
        expect([400, 403]).toContain(res.statusCode);
      }
    });
  });

  describe("ancestor listing does not expose rows above the caller's subtree", () => {
    it("returns only identifying fields for ancestors outside the key's subtree", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/tenants/${fx.A1}/ancestors`,
        headers: withKey(fx.keyA1),
      });
      expect(res.statusCode).toBe(200);
      const [parent] = res.json() as Array<Record<string, unknown>>;
      expect(parent.id).toBe(fx.A);
      expect(parent.name).toBe("Tenant A");
      expect(parent).not.toHaveProperty("metadata");
      expect(parent).not.toHaveProperty("config");
      expect(parent).not.toHaveProperty("connection_config");
    });

    it("returns full rows for ancestors inside the key's subtree", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/tenants/${fx.A1a}/ancestors`,
        headers: withKey(fx.adminKeyA),
      });
      expect(res.statusCode).toBe(200);
      const rows = res.json() as Array<Record<string, unknown>>;
      expect(rows.map((r) => r.id)).toEqual([fx.A, fx.A1]);
      expect(rows[0].metadata).toEqual({ internal_note: "parent-only" });
    });
  });

  describe("role names are unique per tenant", () => {
    it("lets two tenants each define a role with the same name", async () => {
      const a = await app.inject({
        method: "POST",
        url: "/api/v1/roles",
        headers: withKey(fx.adminKeyA),
        payload: { name: "auditor", scopes: ["read"], tenant_id: fx.A },
      });
      expect(a.statusCode).toBe(201);
      const b = await app.inject({
        method: "POST",
        url: "/api/v1/roles",
        headers: withKey(fx.adminKeyB),
        payload: { name: "auditor", scopes: ["read"], tenant_id: fx.B },
      });
      expect(b.statusCode).toBe(201);
    });

    it("still rejects a duplicate name within one tenant and among global roles", async () => {
      await stratum.createRole({ name: "dup", scopes: ["read"], tenant_id: fx.A });
      await expect(stratum.createRole({ name: "dup", scopes: ["read"], tenant_id: fx.A })).rejects.toThrow();
      await stratum.createRole({ name: "gdup", scopes: ["read"], tenant_id: null });
      await expect(stratum.createRole({ name: "gdup", scopes: ["read"], tenant_id: null })).rejects.toThrow();
    });
  });

  describe("per-key rate limits", () => {
    it("rejects a zero-length rate-limit window", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/api-keys",
        headers: withKey(fx.operatorKey),
        payload: { tenant_id: fx.A, rate_limit_max: 10, rate_limit_window: "0 seconds" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("refuses a tenant admin a per-key limit looser than the configured default", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/api-keys",
        headers: withKey(fx.adminKeyA),
        payload: { tenant_id: fx.A, rate_limit_max: 100_000, rate_limit_window: "1 second" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("lets a tenant admin set a stricter per-key limit, and an operator a looser one", async () => {
      const strict = await app.inject({
        method: "POST",
        url: "/api/v1/api-keys",
        headers: withKey(fx.adminKeyA),
        payload: { tenant_id: fx.A, rate_limit_max: 10, rate_limit_window: "1 minute" },
      });
      expect(strict.statusCode).toBe(201);
      const loose = await app.inject({
        method: "POST",
        url: "/api/v1/api-keys",
        headers: withKey(fx.operatorKey),
        payload: { tenant_id: fx.A, rate_limit_max: 100_000, rate_limit_window: "1 second" },
      });
      expect(loose.statusCode).toBe(201);
    });
  });
});
