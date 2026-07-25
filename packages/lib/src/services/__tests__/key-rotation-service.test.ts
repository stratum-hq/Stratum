import { describe, it, expect, beforeEach, afterEach } from "vitest";
import pg from "pg";
import { rotateEncryptionKey } from "../key-rotation-service.js";
import { encrypt, decrypt } from "../../crypto.js";

// ---------------------------------------------------------------------------
// In-memory table double
//
// The rotation service batches over real tables. A pure SQL-string mock cannot
// show the batching bug, so this double emulates just enough PostgreSQL row
// semantics for the two statements the service issues per table: a batched
// SELECT (predicate + optional keyset cursor + ORDER BY + LIMIT) and a
// single-row UPDATE by id. It is deliberately faithful to both the previous
// query shape and the fixed one, so the same test exercises whichever the
// service currently emits.
// ---------------------------------------------------------------------------

interface ConfigRow {
  id: string;
  value: string;
  sensitive: boolean;
}
interface WebhookRow {
  id: string;
  secret_hash: string | null;
}

interface Store {
  config: ConfigRow[];
  webhooks: WebhookRow[];
}

function paramFor(sql: string, re: RegExp, params: unknown[]): unknown {
  const m = sql.match(re);
  return m ? params[Number(m[1]) - 1] : undefined;
}

function makeFakePool(store: Store): pg.Pool {
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      const s = sql.trim();
      if (/^(BEGIN|COMMIT|ROLLBACK|RESET|SET)\b/.test(s)) {
        return { rows: [], rowCount: 0 };
      }

      const limit = Number(paramFor(s, /LIMIT \$(\d+)/, params));
      const gtId = paramFor(s, /id > \$(\d+)/, params) as string | undefined;
      const ordered = /ORDER BY id/.test(s);
      // The previous query tried to exclude already-rotated rows with a
      // `value NOT LIKE 'rotated:%'` predicate. Emulate that literally.
      const excludeRotatedPrefix = /NOT LIKE 'rotated:%'/.test(s);
      const byId = <T extends { id: string }>(rows: T[]): T[] =>
        ordered
          ? [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          : rows;

      if (/SELECT id, value FROM config_entries/.test(s)) {
        let rows = store.config.filter((r) => r.sensitive === true);
        if (excludeRotatedPrefix)
          rows = rows.filter((r) => !r.value.startsWith("rotated:"));
        if (gtId !== undefined) rows = rows.filter((r) => r.id > gtId);
        rows = byId(rows).slice(0, limit);
        return {
          rows: rows.map((r) => ({ id: r.id, value: r.value })),
          rowCount: rows.length,
        };
      }
      if (/UPDATE config_entries SET value/.test(s)) {
        const [value, id] = params as [string, string];
        const row = store.config.find((r) => r.id === id);
        // value is a JSONB column: the service passes JSON.stringify(blob) and
        // Postgres parses that JSON text on the way in, so the column holds the
        // decoded string. Mirror that here (SELECT then returns it decoded, as
        // the pg driver does) rather than storing the raw JSON text.
        if (row) row.value = JSON.parse(value) as string;
        return { rows: [], rowCount: row ? 1 : 0 };
      }
      if (/SELECT id, secret_hash FROM webhooks/.test(s)) {
        let rows = store.webhooks.filter((r) => r.secret_hash != null);
        if (gtId !== undefined) rows = rows.filter((r) => r.id > gtId);
        rows = byId(rows).slice(0, limit);
        return {
          rows: rows.map((r) => ({ id: r.id, secret_hash: r.secret_hash })),
          rowCount: rows.length,
        };
      }
      if (/UPDATE webhooks SET secret_hash/.test(s)) {
        const [secret, id] = params as [string, string];
        const row = store.webhooks.find((r) => r.id === id);
        if (row) row.secret_hash = secret;
        return { rows: [], rowCount: row ? 1 : 0 };
      }
      throw new Error(`unexpected SQL in test double: ${s}`);
    },
    release: () => {},
  };
  return { connect: async () => client } as unknown as pg.Pool;
}

// Deterministic ascending ids, all strictly greater than the zero UUID so a
// keyset cursor starting there sees every row.
function seedId(i: number): string {
  return `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`;
}

const OLD_KEY = "old-key-material-abc";
const NEW_KEY = "new-key-material-xyz";

describe("rotateEncryptionKey batching", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.STRATUM_ENCRYPTION_KEY_PREVIOUS;
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("re-encrypts every sensitive config row exactly once past the first batch", async () => {
    const batchSize = 100;
    const total = 250; // spans three batches

    // Seed rows encrypted under the old key.
    process.env.STRATUM_ENCRYPTION_KEY = OLD_KEY;
    const plaintexts: string[] = [];
    const config: ConfigRow[] = [];
    for (let i = 0; i < total; i++) {
      const pt = `config-secret-${i}`;
      plaintexts.push(pt);
      config.push({
        id: seedId(i),
        // The JSONB value column holds the single-encoded ciphertext string, as
        // the pg driver hands it back to the service (setConfig stores it via
        // JSON.stringify, which the driver parses away on read).
        value: encrypt(pt),
        sensitive: true,
      });
    }
    const store: Store = { config, webhooks: [] };
    const pool = makeFakePool(store);

    const result = await rotateEncryptionKey(pool, OLD_KEY, NEW_KEY, batchSize);

    expect(result.config_entries_rotated).toBe(total);

    // Every row must now decrypt under the NEW key back to its original
    // plaintext — i.e. rotated exactly once, none skipped or double-encrypted.
    process.env.STRATUM_ENCRYPTION_KEY = NEW_KEY;
    for (let i = 0; i < total; i++) {
      const blob = store.config[i].value;
      expect(decrypt(blob)).toBe(plaintexts[i]);
    }
  });

  it("re-encrypts every webhook secret exactly once past the first batch", async () => {
    const batchSize = 100;
    const total = 250;

    process.env.STRATUM_ENCRYPTION_KEY = OLD_KEY;
    const plaintexts: string[] = [];
    const webhooks: WebhookRow[] = [];
    for (let i = 0; i < total; i++) {
      const pt = `webhook-secret-${i}`;
      plaintexts.push(pt);
      webhooks.push({ id: seedId(i), secret_hash: encrypt(pt) });
    }
    const store: Store = { config: [], webhooks };
    const pool = makeFakePool(store);

    const result = await rotateEncryptionKey(pool, OLD_KEY, NEW_KEY, batchSize);

    expect(result.webhooks_rotated).toBe(total);

    process.env.STRATUM_ENCRYPTION_KEY = NEW_KEY;
    for (let i = 0; i < total; i++) {
      expect(decrypt(store.webhooks[i].secret_hash as string)).toBe(
        plaintexts[i],
      );
    }
  });
});
