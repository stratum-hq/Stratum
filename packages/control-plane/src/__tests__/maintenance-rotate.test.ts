import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { Stratum } from "@stratum-hq/lib";
import { errorHandler } from "../middleware/error-handler.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { createAuthorizeMiddleware } from "../middleware/authorize.js";
import { createTenantScopeEnforcer } from "../middleware/tenant-scope.js";
import { createMaintenanceRoutes } from "../routes/maintenance.js";
import { createMockStratum, setupAdminApiKey, authHeaders } from "./test-helpers.js";

const URL = "/api/v1/maintenance/rotate-encryption-key";
const OLD_SALT = "a1".repeat(32);
const NEW_SALT = "b2".repeat(32);
const RESULT = { config_entries_rotated: 1, webhooks_rotated: 0, already_rotated: 0, unreadable: [] };

let app: FastifyInstance;
let stratum: Stratum;
let rotate: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  rotate = vi.fn().mockResolvedValue(RESULT);
  stratum = Object.assign(createMockStratum(), { rotateEncryptionKey: rotate });
  setupAdminApiKey(stratum);

  app = Fastify({ logger: false });
  app.addHook("preHandler", createAuthMiddleware(stratum));
  app.addHook("preHandler", createAuthorizeMiddleware());
  app.addHook("preHandler", createTenantScopeEnforcer(stratum));
  app.setErrorHandler(errorHandler);
  await app.register(createMaintenanceRoutes(stratum), { prefix: "/api/v1/maintenance" });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

function post(payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: URL, headers: authHeaders(), payload });
}

describe("POST /api/v1/maintenance/rotate-encryption-key", () => {
  it("passes old_salt and new_salt to rotateEncryptionKey", async () => {
    const res = await post({ old_key: "k1", new_key: "k2", old_salt: OLD_SALT, new_salt: NEW_SALT });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(RESULT);
    expect(rotate).toHaveBeenCalledWith("k1", "k2", expect.anything(), { oldSalt: OLD_SALT, newSalt: NEW_SALT });
  });

  it("passes no salt when the body gives none", async () => {
    const res = await post({ old_key: "k1", new_key: "k2" });

    expect(res.statusCode).toBe(200);
    expect(rotate).toHaveBeenCalledWith("k1", "k2", expect.anything(), { oldSalt: undefined, newSalt: undefined });
  });

  it("accepts the same key on both sides when the salts differ", async () => {
    const res = await post({ old_key: "k1", new_key: "k1", old_salt: OLD_SALT, new_salt: NEW_SALT });

    expect(res.statusCode).toBe(200);
    expect(rotate).toHaveBeenCalledWith("k1", "k1", expect.anything(), { oldSalt: OLD_SALT, newSalt: NEW_SALT });
  });

  it("accepts the same key on both sides when only new_salt is given", async () => {
    const res = await post({ old_key: "k1", new_key: "k1", new_salt: NEW_SALT });

    expect(res.statusCode).toBe(200);
    expect(rotate).toHaveBeenCalledOnce();
  });

  it.each([
    ["no salt", {}],
    ["the same salt on both sides", { old_salt: OLD_SALT, new_salt: OLD_SALT }],
    ["the same salt in a different letter case", { old_salt: OLD_SALT, new_salt: OLD_SALT.toUpperCase() }],
  ])("refuses the same key on both sides with %s", async (_label, salts) => {
    const res = await post({ old_key: "k1", new_key: "k1", ...salts });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(rotate).not.toHaveBeenCalled();
  });

  it.each([
    ["an odd-length salt", "abc"],
    ["a salt with a character that is not hex", "zz11"],
    ["a salt with a 0x prefix", "0xa1b2"],
    ["an empty salt", ""],
    ["a salt that is not a string", 1234],
  ])("refuses %s in old_salt or new_salt", async (_label, badSalt) => {
    for (const field of ["old_salt", "new_salt"]) {
      const res = await post({ old_key: "k1", new_key: "k2", [field]: badSalt });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatchObject({ code: "VALIDATION_ERROR", message: expect.stringContaining(field) });
    }
    expect(rotate).not.toHaveBeenCalled();
  });

  it("still requires old_key and new_key", async () => {
    const res = await post({ old_key: "k1", old_salt: OLD_SALT, new_salt: NEW_SALT });

    expect(res.statusCode).toBe(400);
    expect(rotate).not.toHaveBeenCalled();
  });
});
