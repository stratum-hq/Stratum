import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Stratum, noopLogger } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, getAdminPool } from "./helpers/db.js";

/**
 * `stratum generate api-key` stores the key's hash itself. Once
 * STRATUM_API_KEY_HMAC_SECRET is set, the library authenticates keys by their
 * HMAC hash (version 2), and with allowLegacyKeyHashes: false it refuses an
 * unkeyed SHA-256 hash (version 1). The CLI must hash the way the library
 * does, or the key it prints never authenticates.
 *
 * The CLI runs as the superuser of the test database, so the test is about
 * the hash only, not about the role model.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "../../cli/dist/index.js");

const BASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

// 48 bytes, above the 32-byte minimum the library applies outside development.
const SECRET = "cli-hmac-secret-0123456789-0123456789-0123456789";
const NAME = `cli_hmac_${Date.now()}`;

function generate(name: string, env: Record<string, string | undefined>): { code: number | null; out: string; key: string } {
  const res = spawnSync(process.execPath, [CLI, "generate", "api-key", "--name", name, "--database-url", BASE_URL], {
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test", ...env },
    timeout: 30000,
  });
  // eslint-disable-next-line no-control-regex
  const out = `${res.stdout}${res.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
  const key = out.match(/Key: (\S+)/)?.[1] ?? "";
  return { code: res.status, out, key };
}

/** Validates `key` in a process-local copy of the library's environment. */
async function validate(key: string, secret: string | undefined, allowLegacyKeyHashes: boolean) {
  const saved = process.env.STRATUM_API_KEY_HMAC_SECRET;
  if (secret === undefined) delete process.env.STRATUM_API_KEY_HMAC_SECRET;
  else process.env.STRATUM_API_KEY_HMAC_SECRET = secret;
  try {
    const stratum = new Stratum({ pool: getPool(), adminPool: getAdminPool(), allowLegacyKeyHashes, logger: noopLogger });
    return await stratum.validateApiKey(key);
  } finally {
    if (saved === undefined) delete process.env.STRATUM_API_KEY_HMAC_SECRET;
    else process.env.STRATUM_API_KEY_HMAC_SECRET = saved;
  }
}

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  await getPool().query("DELETE FROM api_keys WHERE name LIKE $1", [`${NAME}%`]);
  await closePool();
});

describe("stratum generate api-key and the API key hash", () => {
  it("stores an HMAC hash (version 2) when STRATUM_API_KEY_HMAC_SECRET is set", async () => {
    const { code, out, key } = generate(`${NAME}_hmac`, { STRATUM_API_KEY_HMAC_SECRET: SECRET });
    expect(code, out).toBe(0);
    expect(key).toMatch(/^sk_test_/);
    const row = await getPool().query("SELECT hash_version FROM api_keys WHERE name = $1", [`${NAME}_hmac`]);
    expect(row.rows).toEqual([{ hash_version: 2 }]);
  });

  it("prints a key that authenticates while legacy hashes are refused", async () => {
    const { code, out, key } = generate(`${NAME}_strict`, { STRATUM_API_KEY_HMAC_SECRET: SECRET });
    expect(code, out).toBe(0);
    const validated = await validate(key, SECRET, false);
    expect(validated).not.toBeNull();
  });

  it("stores a SHA-256 hash (version 1) when no HMAC secret is set, as before", async () => {
    const { code, out, key } = generate(`${NAME}_plain`, { STRATUM_API_KEY_HMAC_SECRET: undefined });
    expect(code, out).toBe(0);
    const row = await getPool().query("SELECT hash_version FROM api_keys WHERE name = $1", [`${NAME}_plain`]);
    expect(row.rows).toEqual([{ hash_version: 1 }]);
    expect(await validate(key, undefined, true)).not.toBeNull();
  });
});
