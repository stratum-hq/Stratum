import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource, EntitySchema } from "typeorm";
import { runWithTenantContext } from "@stratum-hq/sdk";
import type { ResolvedTenantContext } from "@stratum-hq/core";
import type { Pool } from "mysql2/promise";
import { getTestPool, cleanupTestPool } from "./setup.js";
import { registerStratumSubscriber } from "../../integrations/typeorm-subscriber.js";

const MYSQL_URL = process.env.MYSQL_URL || "mysql://root@localhost:3306";

// The database name is unique to this file, so the file can run alongside
// other suites on a shared server.
const DB = "q2_stratum_reads";

interface Owner {
  id: number;
  tenant_id: string;
  name: string;
  notes?: Note[];
}

interface Note {
  id: number;
  tenant_id: string;
  name: string;
  owner_id: number;
  owner?: Owner | null;
}

interface Pin {
  id: number;
  tenant_id: string;
  owner_id: number;
  owner?: Owner | null;
}

interface Tag {
  id: number;
  name: string;
}

const OwnerSchema = new EntitySchema<Owner>({
  name: "Q2Owner",
  tableName: "owners",
  columns: {
    id: { type: Number, primary: true },
    tenant_id: { type: String },
    name: { type: String },
  },
  relations: {
    notes: { type: "one-to-many", target: "Q2Note", inverseSide: "owner" },
  },
});

const NoteSchema = new EntitySchema<Note>({
  name: "Q2Note",
  tableName: "notes",
  columns: {
    id: { type: Number, primary: true },
    tenant_id: { type: String },
    name: { type: String },
    owner_id: { type: Number },
  },
  relations: {
    owner: { type: "many-to-one", target: "Q2Owner", joinColumn: { name: "owner_id" } },
  },
});

const PinSchema = new EntitySchema<Pin>({
  name: "Q2Pin",
  tableName: "pins",
  columns: {
    id: { type: Number, primary: true },
    tenant_id: { type: String },
    owner_id: { type: Number },
  },
  relations: {
    owner: { type: "many-to-one", target: "Q2Owner", joinColumn: { name: "owner_id" }, eager: true },
  },
});

const TagSchema = new EntitySchema<Tag>({
  name: "Q2Tag",
  tableName: "tags",
  columns: {
    id: { type: Number, primary: true },
    name: { type: String },
  },
});

interface Card {
  tenant_id: string;
  id: number;
  name: string;
}

// The primary key includes tenant_id, so each tenant has its own id space.
const CardSchema = new EntitySchema<Card>({
  name: "Q2Card",
  tableName: "cards",
  columns: {
    tenant_id: { type: String, primary: true },
    id: { type: Number, primary: true },
    name: { type: String },
  },
});

const ENTITIES = [OwnerSchema, NoteSchema, PinSchema, TagSchema, CardSchema];

let pool: Pool;
let dataSource: DataSource;
/** Every SQL statement the registered data source sends. */
const sent: string[] = [];

function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return runWithTenantContext({ tenant_id: tenantId } as ResolvedTenantContext, fn);
}

function asA<T>(fn: () => Promise<T>): Promise<T> {
  return asTenant("tenant-a", fn);
}

function ids(rows: { id: number }[]): number[] {
  return rows.map((r) => Number(r.id)).sort((x, y) => x - y);
}

beforeAll(async () => {
  pool = (await getTestPool()) as unknown as Pool;
  await pool.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await pool.query(`CREATE DATABASE \`${DB}\``);
  await pool.query(
    `CREATE TABLE \`${DB}\`.\`owners\` (id INT PRIMARY KEY, tenant_id VARCHAR(255) NOT NULL, name VARCHAR(255))`,
  );
  await pool.query(
    `CREATE TABLE \`${DB}\`.\`notes\` (id INT PRIMARY KEY, tenant_id VARCHAR(255) NOT NULL, name VARCHAR(255), owner_id INT)`,
  );
  await pool.query(
    `CREATE TABLE \`${DB}\`.\`pins\` (id INT PRIMARY KEY, tenant_id VARCHAR(255) NOT NULL, owner_id INT)`,
  );
  await pool.query(`CREATE TABLE \`${DB}\`.\`tags\` (id INT PRIMARY KEY, name VARCHAR(255))`);
  await pool.query(
    `CREATE TABLE \`${DB}\`.\`cards\` (tenant_id VARCHAR(255) NOT NULL, id INT NOT NULL, name VARCHAR(255), PRIMARY KEY (tenant_id, id))`,
  );
  dataSource = new DataSource({
    type: "mysql",
    url: `${MYSQL_URL}/${DB}`,
    entities: ENTITIES,
    synchronize: false,
    logging: ["query"],
    logger: {
      logQuery: (query: string) => void sent.push(query),
      logQueryError: () => undefined,
      logQuerySlow: () => undefined,
      logSchemaBuild: () => undefined,
      logMigration: () => undefined,
      log: () => undefined,
    },
  });
  await dataSource.initialize();
  registerStratumSubscriber(dataSource);
});

afterAll(async () => {
  await dataSource?.destroy();
  await pool.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await cleanupTestPool();
});

beforeEach(async () => {
  for (const table of ["owners", "notes", "pins", "tags", "cards"]) {
    await pool.query(`DELETE FROM \`${DB}\`.\`${table}\``);
  }
  await pool.query(`INSERT INTO \`${DB}\`.\`owners\` VALUES (1, 'tenant-a', 'alice'), (2, 'tenant-b', 'bob')`);
  // Note 1 (tenant-a) points at tenant-b's owner, and note 2 (tenant-b) points
  // at tenant-a's owner, so relation joins can cross the tenant boundary.
  await pool.query(
    `INSERT INTO \`${DB}\`.\`notes\` VALUES (1, 'tenant-a', 'a-note', 2), (2, 'tenant-b', 'b-note', 1), (3, 'tenant-a', 'a-note-2', 1)`,
  );
  await pool.query(`INSERT INTO \`${DB}\`.\`pins\` VALUES (1, 'tenant-a', 2), (2, 'tenant-b', 2)`);
  await pool.query(`INSERT INTO \`${DB}\`.\`tags\` VALUES (1, 't1'), (2, 't2'), (3, 't3')`);
  await pool.query(`INSERT INTO \`${DB}\`.\`cards\` VALUES ('tenant-b', 2, 'b-card')`);
  sent.length = 0;
});

describe("StratumTypeOrmSubscriber repository reads", () => {
  it("find and findBy return only the current tenant's rows", async () => {
    const repo = dataSource.getRepository(NoteSchema);
    expect(ids(await asA(() => repo.find()))).toEqual([1, 3]);
    expect(await asA(() => repo.findBy({ id: 2 }))).toEqual([]);
    expect(await asA(() => repo.findAndCount())).toMatchObject([expect.any(Array), 2]);
  });

  it("findOne and findOneBy do not return another tenant's row by id", async () => {
    const repo = dataSource.getRepository(NoteSchema);
    expect(await asA(() => repo.findOneBy({ id: 2 }))).toBeNull();
    expect(await asA(() => repo.findOne({ where: { id: 2 } }))).toBeNull();
    await expect(asA(() => repo.findOneByOrFail({ id: 2 }))).rejects.toThrow();
    expect(await asA(() => repo.preload({ id: 2 }))).toBeUndefined();
    expect((await asA(() => repo.findOneBy({ id: 3 })))?.name).toBe("a-note-2");
  });

  it("count, exists and aggregates see only the current tenant's rows", async () => {
    const repo = dataSource.getRepository(NoteSchema);
    expect(await asA(() => repo.count())).toBe(2);
    expect(await asA(() => repo.countBy({ id: 2 }))).toBe(0);
    expect(await asA(() => repo.exists({ where: { id: 2 } }))).toBe(false);
    expect(await asA(() => repo.existsBy({ id: 2 }))).toBe(false);
    expect(await asA(() => repo.existsBy({ id: 1 }))).toBe(true);
    expect(Number(await asA(() => repo.sum("id")))).toBe(4);
  });
});

describe("StratumTypeOrmSubscriber query builder reads", () => {
  const notes = () => dataSource.getRepository(NoteSchema).createQueryBuilder("n");

  it("getMany, getOne, getRawMany and getRawOne return only the current tenant's rows", async () => {
    expect(ids(await asA(() => notes().getMany()))).toEqual([1, 3]);
    expect(await asA(() => notes().where("n.id = :id", { id: 2 }).getOne())).toBeNull();
    const raw = await asA(() => notes().select("n.id", "id").getRawMany<{ id: number }>());
    expect(ids(raw)).toEqual([1, 3]);
    expect(await asA(() => notes().select("n.id", "id").where("n.id = 2").getRawOne())).toBeUndefined();
  });

  it("an orWhere cannot widen a read past the tenant", async () => {
    const rows = await asA(() => notes().where("n.id = 1").orWhere("n.id = 2").getMany());
    expect(ids(rows)).toEqual([1]);
  });

  it("getCount, getManyAndCount and getExists see only the current tenant's rows", async () => {
    expect(await asA(() => notes().getCount())).toBe(2);
    const [rows, count] = await asA(() => notes().getManyAndCount());
    expect(ids(rows)).toEqual([1, 3]);
    expect(count).toBe(2);
    expect(await asA(() => notes().where("n.id = 2").getExists())).toBe(false);
  });

  it("stream() returns only the current tenant's rows", async () => {
    const streamed = await asA(async () => {
      const stream = await notes().select("n.id", "id").stream();
      const out: { id: number }[] = [];
      for await (const row of stream) out.push(row as { id: number });
      return out;
    });
    expect(ids(streamed)).toEqual([1, 3]);
  });

  it("scopes a read that names the entity's table instead of the entity", async () => {
    const rows = await asA(() =>
      dataSource.createQueryBuilder().select("n.id", "id").from("notes", "n").getRawMany<{ id: number }>(),
    );
    expect(ids(rows)).toEqual([1, 3]);
  });

  it("scopes a tenant subquery inside a read of an entity without tenant_id", async () => {
    const rows = await asA(() =>
      dataSource
        .getRepository(TagSchema)
        .createQueryBuilder("t")
        .where((qb) => "t.id IN " + qb.subQuery().select("n.id").from(NoteSchema, "n").getQuery())
        .getMany(),
    );
    expect(ids(rows)).toEqual([1, 3]);
  });
});

describe("StratumTypeOrmSubscriber relation reads", () => {
  it("leftJoinAndSelect does not load another tenant's related row and keeps the parent", async () => {
    const rows = await asA(() =>
      dataSource.getRepository(NoteSchema).createQueryBuilder("n").leftJoinAndSelect("n.owner", "o").orderBy("n.id").getMany(),
    );
    expect(rows.map((n) => [n.id, n.owner?.name ?? null])).toEqual([
      [1, null],
      [3, "alice"],
    ]);
  });

  it("a one-to-many join does not load another tenant's children", async () => {
    const owners = await asA(() =>
      dataSource.getRepository(OwnerSchema).createQueryBuilder("o").leftJoinAndSelect("o.notes", "n").getMany(),
    );
    expect(owners.map((o) => [o.id, ids(o.notes ?? [])])).toEqual([[1, [3]]]);
  });

  it("find with relations does not load another tenant's related row", async () => {
    const repo = dataSource.getRepository(NoteSchema);
    for (const relationLoadStrategy of ["join", "query"] as const) {
      const rows = await asA(() => repo.find({ relations: { owner: true }, order: { id: "ASC" }, relationLoadStrategy }));
      expect(rows.map((n) => [n.id, n.owner?.name ?? null])).toEqual([
        [1, null],
        [3, "alice"],
      ]);
    }
  });

  it("an eager relation does not load another tenant's related row", async () => {
    const pins = await asA(() => dataSource.getRepository(PinSchema).find());
    expect(pins.map((p) => [p.id, p.owner ?? null])).toEqual([[1, null]]);
  });

  it("paginates a join with take and skip over the current tenant's rows only", async () => {
    const [owners, count] = await asA(() =>
      dataSource
        .getRepository(OwnerSchema)
        .createQueryBuilder("o")
        .leftJoinAndSelect("o.notes", "n")
        .orderBy("o.id")
        .take(10)
        .skip(0)
        .getManyAndCount(),
    );
    expect(owners.map((o) => [o.id, ids(o.notes ?? [])])).toEqual([[1, [3]]]);
    expect(count).toBe(1);
    const second = await asA(() =>
      dataSource.getRepository(OwnerSchema).find({ relations: { notes: true }, take: 1, skip: 1 }),
    );
    expect(second).toEqual([]);
  });
});

describe("StratumTypeOrmSubscriber read scoping rules", () => {
  it("adds the tenant condition once per tenant alias, however often the query is built", async () => {
    const qb = dataSource.getRepository(NoteSchema).createQueryBuilder("n").leftJoinAndSelect("n.owner", "o");
    const first = await asA(async () => qb.getQuery());
    const second = await asA(async () => qb.getQuery());
    expect(first).toBe(second);
    expect(first.match(/`tenant_id` = :stratumTenantId/g)).toHaveLength(2);
    await asA(() => qb.getMany());
    await asA(() => qb.getCount());
    for (const sql of sent) {
      expect(sql.match(/`tenant_id` = \?/g) ?? []).toHaveLength(2);
    }
  });

  it("save() does not load another tenant's row before writing", async () => {
    await asA(() => dataSource.getRepository(NoteSchema).save({ id: 2, name: "changed" })).catch(() => undefined);
    const [rows] = await pool.query(`SELECT * FROM \`${DB}\`.\`notes\` WHERE id = 2`);
    expect(rows).toEqual([{ id: 2, tenant_id: "tenant-b", name: "b-note", owner_id: 1 }]);
    const load = sent.find((sql) => /^SELECT/i.test(sql) && /`notes`/.test(sql));
    expect(load).toMatch(/`tenant_id` = \?/);
  });

  it("refuses reads of a tenant entity outside a tenant context", async () => {
    const repo = dataSource.getRepository(NoteSchema);
    await expect(repo.find()).rejects.toThrow();
    await expect(repo.findOneBy({ id: 2 })).rejects.toThrow();
    await expect(repo.count()).rejects.toThrow();
    await expect(repo.createQueryBuilder("n").getRawMany()).rejects.toThrow();
    await expect(
      dataSource.getRepository(TagSchema).createQueryBuilder("t").leftJoin(NoteSchema, "n", "n.id = t.id").getMany(),
    ).rejects.toThrow();
    expect(sent.filter((sql) => /`notes`/.test(sql))).toEqual([]);
  });

  it("leaves entities without tenant_id unfiltered, inside or outside a tenant context", async () => {
    const tags = dataSource.getRepository(TagSchema);
    expect(ids(await tags.find())).toEqual([1, 2, 3]);
    expect(ids(await asA(() => tags.find()))).toEqual([1, 2, 3]);
    expect(sent.some((sql) => /tenant_id/.test(sql))).toBe(false);
  });

  it("leaves a data source without the subscriber untouched", async () => {
    const plain = new DataSource({
      type: "mysql",
      url: `${MYSQL_URL}/${DB}`,
      entities: ENTITIES,
      synchronize: false,
    });
    await plain.initialize();
    try {
      expect(ids(await plain.getRepository(NoteSchema).find())).toEqual([1, 2, 3]);
      expect(ids(await asA(() => plain.getRepository(NoteSchema).find()))).toEqual([1, 2, 3]);
    } finally {
      await plain.destroy();
    }
  });
});

describe("StratumTypeOrmSubscriber save() of another tenant's row", () => {
  async function cards(): Promise<Card[]> {
    const [rows] = await pool.query(`SELECT * FROM \`${DB}\`.\`cards\` ORDER BY tenant_id, id`);
    return rows as Card[];
  }

  it("refuses save() with another tenant's full composite key instead of creating a row", async () => {
    await expect(
      asA(() => dataSource.getRepository(CardSchema).save({ tenant_id: "tenant-b", id: 2, name: "changed" })),
    ).rejects.toThrow(/another tenant/);
    expect(await cards()).toEqual([{ tenant_id: "tenant-b", id: 2, name: "b-card" }]);
  });

  it("refuses an insert() with another tenant's primary key with the Stratum error", async () => {
    await expect(
      asA(() => dataSource.getRepository(NoteSchema).insert({ id: 2, name: "x", owner_id: 1 })),
    ).rejects.toThrow(/another tenant/);
  });

  it("save() creates the current tenant's own row when only the tenant-local id matches", async () => {
    await asA(() => dataSource.getRepository(CardSchema).save({ id: 2, name: "a-card" }));
    expect(await cards()).toEqual([
      { tenant_id: "tenant-a", id: 2, name: "a-card" },
      { tenant_id: "tenant-b", id: 2, name: "b-card" },
    ]);
  });
});

describe("StratumTypeOrmSubscriber repeated execute()", () => {
  it("adds the tenant condition once when an update builder is executed twice", async () => {
    const qb = dataSource.createQueryBuilder().update(NoteSchema).set({ name: "renamed" }).where("id = 1");
    await asA(() => qb.execute());
    await asA(() => qb.execute());
    const updates = sent.filter((sql) => /^UPDATE/i.test(sql));
    expect(updates).toHaveLength(2);
    for (const sql of updates) expect(sql.match(/`tenant_id` = \?/g)).toHaveLength(1);
  });
});
