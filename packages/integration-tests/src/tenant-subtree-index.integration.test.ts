import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type pg from "pg";
import { Stratum } from "@stratum-hq/lib";
import { PermissionMode, RevocationMode } from "@stratum-hq/core";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
} from "./helpers/db.js";

const SUBTREE_INDEX = "idx_tenant_ancestry_path_prefix";

interface RecordedQuery {
  text: string;
  values: unknown[];
}

interface PlanNode {
  "Index Name"?: string;
  "Index Cond"?: string;
  Plans?: PlanNode[];
}

/**
 * The three subtree queries (getDescendants, CASCADE permission revocation and
 * CASCADE ABAC revocation) must return the same rows as before, and each must
 * be able to use a btree index on ancestry_path. A LIKE with a leading
 * wildcard cannot use an index, so every call scanned the whole tenants table.
 */
describe("subtree queries on ancestry_path (integration)", () => {
  let stratum: Stratum;

  beforeAll(async () => {
    await runMigrations();
    stratum = new Stratum({ pool: getPool() });
  });

  afterEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await closePool();
  });

  /**
   * Build two separate trees. The second tree proves that a subtree query does
   * not reach rows outside the subtree.
   *   root_a
   *   ├─ a1
   *   │  ├─ a1x
   *   │  │  └─ a1x_deep
   *   │  └─ a1y            (status='archived')
   *   └─ a2
   *   root_b
   *   └─ b1
   */
  async function seedForest() {
    const create = (slug: string, parent_id?: string) =>
      stratum.createTenant({ name: slug, slug: `sub_${slug}`, parent_id });
    const rootA = await create("root_a");
    const a1 = await create("a1", rootA.id);
    const a1x = await create("a1x", a1.id);
    const a1xDeep = await create("a1x_deep", a1x.id);
    const a1y = await create("a1y", a1.id);
    const a2 = await create("a2", rootA.id);
    const rootB = await create("root_b");
    const b1 = await create("b1", rootB.id);

    await getPool().query(
      `UPDATE tenants SET status = 'archived' WHERE id = $1`,
      [a1y.id],
    );
    return { rootA, a1, a1x, a1xDeep, a1y, a2, rootB, b1 };
  }

  const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

  /**
   * Run `work` and return every query it sends through the shared pool. The
   * lib runs its SQL through pool.connect(), so the recorder wraps the client
   * that call returns and removes itself when the client goes back to the pool.
   */
  async function recordQueries(
    work: () => Promise<unknown>,
  ): Promise<RecordedQuery[]> {
    const pool = getPool();
    const seen: RecordedQuery[] = [];
    const originalConnect = pool.connect;
    const connectClient = originalConnect.bind(pool) as () => Promise<pg.PoolClient>;
    const recordingConnect = async (): Promise<pg.PoolClient> => {
      const client = await connectClient();
      const originalQuery = client.query;
      const originalRelease = client.release;
      const runQuery = originalQuery.bind(client) as (
        text: string,
        values?: unknown[],
      ) => Promise<pg.QueryResult>;
      client.query = ((text: string, values?: unknown[]) => {
        seen.push({ text, values: values ?? [] });
        return runQuery(text, values);
      }) as typeof client.query;
      client.release = ((err?: Error | boolean) => {
        client.query = originalQuery;
        client.release = originalRelease;
        return originalRelease.call(client, err);
      }) as typeof client.release;
      return client;
    };
    pool.connect = recordingConnect as typeof pool.connect;
    try {
      await work();
    } finally {
      pool.connect = originalConnect;
    }
    return seen;
  }

  /** Return the one recorded query that selects a subtree of tenants. */
  function subtreeQuery(queries: RecordedQuery[]): RecordedQuery {
    const matches = queries.filter(
      (q) => /FROM tenants/.test(q.text) && /ancestry_path\s+LIKE/.test(q.text),
    );
    expect(matches).toHaveLength(1);
    return matches[0];
  }

  /**
   * Add active root tenants outside every subtree, then refresh the planner
   * statistics. On a table of a few rows the planner prefers any scan, so the
   * plan says nothing. At this size a subtree query that cannot use the
   * ancestry_path index must scan far more rows than it returns.
   */
  async function seedInstallation() {
    await getPool().query(
      `INSERT INTO tenants (parent_id, ancestry_path, depth, name, slug)
       SELECT NULL, '/', 0, 'filler', 'filler_' || g
       FROM generate_series(1, 5000) AS g`,
    );
    await getPool().query(`ANALYZE tenants`);
  }

  /** Plan `query` with the planner's default settings and return every plan node. */
  async function planNodes(query: RecordedQuery): Promise<PlanNode[]> {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL app.bypass_rls = 'on'");
      const res = await client.query<{ "QUERY PLAN": { Plan: PlanNode }[] }>(
        `EXPLAIN (FORMAT JSON) ${query.text}`,
        query.values,
      );
      const nodes: PlanNode[] = [];
      const walk = (node: PlanNode) => {
        nodes.push(node);
        node.Plans?.forEach(walk);
      };
      walk(res.rows[0]["QUERY PLAN"][0].Plan);
      return nodes;
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  async function expectUsesSubtreeIndex(query: RecordedQuery) {
    const nodes = await planNodes(query);
    const indexed = nodes.filter(
      (n) =>
        n["Index Name"] === SUBTREE_INDEX &&
        (n["Index Cond"] ?? "").includes("ancestry_path"),
    );
    expect(indexed.length).toBeGreaterThan(0);
  }

  it("getDescendants returns the active subtree of each tenant, ordered by depth", async () => {
    const t = await seedForest();

    const fromRoot = await stratum.getDescendants(t.rootA.id);
    expect(ids(fromRoot)).toEqual(ids([t.a1, t.a1x, t.a1xDeep, t.a2]));
    const depths = fromRoot.map((d) => d.depth);
    expect(depths).toEqual([...depths].sort((x, y) => x - y));

    expect(ids(await stratum.getDescendants(t.a1.id))).toEqual(
      ids([t.a1x, t.a1xDeep]),
    );
    expect(ids(await stratum.getDescendants(t.a1x.id))).toEqual(
      ids([t.a1xDeep]),
    );
    expect(await stratum.getDescendants(t.a1xDeep.id)).toEqual([]);
    expect(ids(await stratum.getDescendants(t.rootB.id))).toEqual(ids([t.b1]));
  });

  it("getDescendants with includeArchived adds archived descendants and nothing else", async () => {
    const t = await seedForest();

    expect(ids(await stratum.getDescendants(t.rootA.id, true))).toEqual(
      ids([t.a1, t.a1x, t.a1xDeep, t.a1y, t.a2]),
    );
    expect(ids(await stratum.getDescendants(t.a1.id, true))).toEqual(
      ids([t.a1x, t.a1xDeep, t.a1y]),
    );
  });

  it("CASCADE permission revocation removes copies in the subtree only, archived included", async () => {
    const t = await seedForest();
    const perm = {
      key: "feature:subtree",
      mode: PermissionMode.INHERITED,
      revocation_mode: RevocationMode.CASCADE,
    };
    const everyTenant = [t.rootA, t.a1, t.a1x, t.a1xDeep, t.a2, t.rootB, t.b1];
    const policies = new Map<string, string>();
    for (const tenant of everyTenant) {
      policies.set(tenant.id, (await stratum.createPermission(tenant.id, perm)).id);
    }
    // The library refuses writes to the archived a1y, so its copy is written in SQL.
    await getPool().query(
      `INSERT INTO permission_policies (tenant_id, key, value, mode, revocation_mode, source_tenant_id)
       VALUES ($1, $2, 'true', $3, $4, $1)`,
      [t.a1y.id, perm.key, perm.mode, perm.revocation_mode],
    );

    await stratum.deletePermission(t.a1.id, policies.get(t.a1.id)!);

    const left = await getPool().query<{ id: string }>(
      `SELECT tenant_id AS id FROM permission_policies WHERE key = $1`,
      [perm.key],
    );
    expect(ids(left.rows)).toEqual(ids([t.rootA, t.a2, t.rootB, t.b1]));
  });

  it("CASCADE ABAC revocation removes copies in the subtree only, archived included", async () => {
    const t = await seedForest();
    const policy = {
      name: "subtree_gate",
      resource_type: "report",
      action: "read",
      effect: "allow" as const,
      conditions: [],
    };
    const everyTenant = [t.rootA, t.a1, t.a1x, t.a1xDeep, t.a1y, t.a2, t.rootB, t.b1];
    const policies = new Map<string, string>();
    for (const tenant of everyTenant) {
      policies.set(tenant.id, (await stratum.createAbacPolicy(tenant.id, policy)).id);
    }

    await stratum.deleteAbacPolicy(t.a1.id, policies.get(t.a1.id)!);

    const left = await getPool().query<{ id: string }>(
      `SELECT tenant_id AS id FROM abac_policies WHERE name = $1`,
      [policy.name],
    );
    expect(ids(left.rows)).toEqual(ids([t.rootA, t.a2, t.rootB, t.b1]));
  });

  it("getDescendants uses the ancestry_path index, with and without includeArchived", async () => {
    const t = await seedForest();
    await seedInstallation();

    for (const includeArchived of [false, true]) {
      const queries = await recordQueries(() =>
        stratum.getDescendants(t.a1.id, includeArchived),
      );
      await expectUsesSubtreeIndex(subtreeQuery(queries));
    }
  });

  it("CASCADE permission revocation uses the ancestry_path index", async () => {
    const t = await seedForest();
    await seedInstallation();
    const created = await stratum.createPermission(t.a1.id, {
      key: "feature:plan",
      mode: PermissionMode.INHERITED,
      revocation_mode: RevocationMode.CASCADE,
    });

    const queries = await recordQueries(() =>
      stratum.deletePermission(t.a1.id, created.id),
    );
    await expectUsesSubtreeIndex(subtreeQuery(queries));
  });

  it("CASCADE ABAC revocation uses the ancestry_path index", async () => {
    const t = await seedForest();
    await seedInstallation();
    const created = await stratum.createAbacPolicy(t.a1.id, {
      name: "plan_gate",
      resource_type: "report",
      action: "read",
      effect: "allow",
      conditions: [],
    });

    const queries = await recordQueries(() =>
      stratum.deleteAbacPolicy(t.a1.id, created.id),
    );
    await expectUsesSubtreeIndex(subtreeQuery(queries));
  });
});
