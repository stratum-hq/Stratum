import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Stratum } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, cleanTestData, getAdminPool } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

const execFileAsync = promisify(execFile);
const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

// The salt this test process encrypts under: STRATUM_HKDF_SALT (hex) when set,
// else the hex form of the non-production default salt in lib's crypto.ts.
const OLD_SALT =
  process.env.STRATUM_HKDF_SALT || Buffer.from("stratum-non-production-hkdf-salt-v1", "utf8").toString("hex");

// Decrypts the way lib's crypto.ts does: HKDF-SHA256 with info "stratum-aes-key".
// This derivation is independent of lib, so a fault in lib's derivation fails the test.
function decryptAs(blob: string, keyMaterial: string, saltHex: string): string {
  const key = Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(keyMaterial, "utf8"), Buffer.from(saltHex, "hex"), "stratum-aes-key", 32),
  );
  const [, ivHex, authTagHex, ciphertextHex] = blob.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"), {
    authTagLength: 16,
  });
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  return decipher.update(Buffer.from(ciphertextHex, "hex")).toString("utf8") + decipher.final("utf8");
}

// lib reads STRATUM_HKDF_SALT once, when it loads. A new Node process is the
// only way to start lib on a different salt, as a deployment restart does.
// The process prints the resolved value of one config key, or exits non-zero.
async function resolveInNewProcess(env: Record<string, string>, tenantId: string, key: string): Promise<unknown> {
  const script = `
    import pg from "pg";
    import { Stratum } from "@stratum-hq/lib";
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const resolved = await new Stratum({ pool }).resolveConfig(process.argv[1]);
      process.stdout.write(JSON.stringify(resolved[process.argv[2]].value));
    } finally {
      await pool.end();
    }
    process.exit(0);
  `;
  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", script, tenantId, key], {
    cwd: PACKAGE_DIR,
    env: { PATH: process.env.PATH ?? "", NODE_ENV: "production", DATABASE_URL, ...env },
  });
  return JSON.parse(stdout);
}

describe("Key rotation to a new HKDF salt (integration)", () => {
  const OLD_KEY = "salt-rotation-old-key-material-1";
  const NEW_KEY = "salt-rotation-new-key-material-2";
  const NEW_SALT = crypto.randomBytes(32).toString("hex");
  const savedKey = process.env.STRATUM_ENCRYPTION_KEY;

  let stratum: Stratum;

  beforeAll(async () => {
    delete process.env.STRATUM_ENCRYPTION_KEY_PREVIOUS;
    delete process.env.STRATUM_HKDF_SALT_PREVIOUS;
    await runMigrations();
    stratum = new Stratum({ pool: getPool(), adminPool: getAdminPool() });
  });

  afterEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    if (savedKey === undefined) delete process.env.STRATUM_ENCRYPTION_KEY;
    else process.env.STRATUM_ENCRYPTION_KEY = savedKey;
    await closePool();
  });

  it("moves values from the old key and salt to the new key and salt, readable under the new pair only", async () => {
    // lib writes under the old pair.
    process.env.STRATUM_ENCRYPTION_KEY = OLD_KEY;
    const tenant = await stratum.createTenant({ name: "Salt Rotation", slug: uniqueSlug("rot_salt") });
    await stratum.setConfig(tenant.id, "db_password", { value: "salted-secret", locked: false, sensitive: true });
    const hook = await stratum.createWebhook({
      tenant_id: tenant.id,
      url: "https://example.com/hook-salt-rotation",
      secret: "webhook-secret-salt-rotation",
      events: ["tenant.created"],
    });
    const readRaw = async () => ({
      config: (
        await getPool().query<{ value: string }>(
          "SELECT value FROM config_entries WHERE tenant_id = $1 AND key = $2",
          [tenant.id, "db_password"],
        )
      ).rows[0].value,
      hook: (await getPool().query<{ secret_hash: string }>("SELECT secret_hash FROM webhooks WHERE id = $1", [hook.id]))
        .rows[0].secret_hash,
    });
    const before = await readRaw();
    expect(JSON.parse(decryptAs(before.config, OLD_KEY, OLD_SALT))).toBe("salted-secret");

    const newPair = { STRATUM_ENCRYPTION_KEY: NEW_KEY, STRATUM_HKDF_SALT: NEW_SALT };

    // Before rotation, lib on the new pair reads the old values only through the previous pair.
    await expect(resolveInNewProcess(newPair, tenant.id, "db_password")).rejects.toThrow();
    await expect(
      resolveInNewProcess(
        { ...newPair, STRATUM_ENCRYPTION_KEY_PREVIOUS: OLD_KEY, STRATUM_HKDF_SALT_PREVIOUS: OLD_SALT },
        tenant.id,
        "db_password",
      ),
    ).resolves.toBe("salted-secret");

    const result = await stratum.rotateEncryptionKey(OLD_KEY, NEW_KEY, undefined, {
      oldSalt: OLD_SALT,
      newSalt: NEW_SALT,
    });
    expect(result).toEqual({ config_entries_rotated: 1, webhooks_rotated: 1, already_rotated: 0, unreadable: [] });

    // The stored values open with the new pair and with no other combination.
    const after = await readRaw();
    expect(JSON.parse(decryptAs(after.config, NEW_KEY, NEW_SALT))).toBe("salted-secret");
    expect(decryptAs(after.hook, NEW_KEY, NEW_SALT)).toBe("webhook-secret-salt-rotation");
    for (const blob of [after.config, after.hook]) {
      expect(() => decryptAs(blob, OLD_KEY, OLD_SALT)).toThrow();
      expect(() => decryptAs(blob, NEW_KEY, OLD_SALT)).toThrow();
      expect(() => decryptAs(blob, OLD_KEY, NEW_SALT)).toThrow();
    }

    // After rotation, lib on the new pair reads the value with no previous pair set.
    await expect(resolveInNewProcess(newPair, tenant.id, "db_password")).resolves.toBe("salted-secret");

    // A second run finds every value already on the new pair.
    const again = await stratum.rotateEncryptionKey(OLD_KEY, NEW_KEY, undefined, {
      oldSalt: OLD_SALT,
      newSalt: NEW_SALT,
    });
    expect(again).toEqual({ config_entries_rotated: 0, webhooks_rotated: 0, already_rotated: 2, unreadable: [] });
  });
});
