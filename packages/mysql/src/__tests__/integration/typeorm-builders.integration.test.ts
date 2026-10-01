import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DataSource, EntitySchema } from "typeorm";
import { runWithTenantContext } from "@stratum-hq/sdk";
import type { ResolvedTenantContext } from "@stratum-hq/core";
import type { Pool } from "mysql2/promise";
import { getTestPool, cleanupTestPool } from "./setup.js";
import { registerStratumSubscriber } from "../../integrations/typeorm-subscriber.js";

const MYSQL_URL = process.env.MYSQL_URL || "mysql://root@localhost:3306";

// Database names are unique to this file, so the file can run alongside other
// suites on a shared server.
const DB = "q2_stratum_builders";
const VIEW_DB = "q2_stratum_views";

interface Note {
  id: number;
  tenant_id: string;
  name: string;
}

const NoteSchema = new EntitySchema<Note>({
  name: "Q2BNote",
  tableName: "notes",
  columns: {
    id: { type: Number, primary: true },
    tenant_id: { type: String },
    name: { type: String },
  },
});

interface Memo {
  id: number;
  tenantId: string;
  name: string;
}

// The tenant column is mapped to a property with another name.
const MemoSchema = new EntitySchema<Memo>({
  name: "Q2BMemo",
  tableName: "memos",
  columns: {
    id: { type: Number, primary: true },
    tenantId: { type: String, name: "tenant_id" },
    name: { type: String },
  },
});

interface Tag {
  id: number;
  name: string;
}

const TagSchema = new EntitySchema<Tag>({
  name: "Q2BTag",
  tableName: "tags",
  columns: {
    id: { type: Number, primary: true },
    name: { type: String },
  },
});

let pool: Pool;
let dataSource: DataSource;

function asA<T>(fn: () => Promise<T>): Promise<T> {
  return runWithTenantContext({ tenant_id: "tenant-a" } as ResolvedTenantContext, fn);
}

async function rows<T>(sql: string): Promise<T[]> {
  const [result] = await pool.query(sql);
  return result as T[];
}

const notes = () => rows<Note>(`SELECT * FROM \`${DB}\`.\`notes\` ORDER BY id`);

const untouched: Note[] = [
  { id: 1, tenant_id: "tenant-a", name: "a-note" },
  { id: 2, tenant_id: "tenant-b", name: "b-note" },
];

beforeAll(async () => {
  pool = (await getTestPool()) as unknown as Pool;
  await pool.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await pool.query(`CREATE DATABASE \`${DB}\``);
  await pool.query(
    `CREATE TABLE \`${DB}\`.\`notes\` (id INT PRIMARY KEY, tenant_id VARCHAR(255) NOT NULL, name VARCHAR(255))`,
  );
  await pool.query(
    `CREATE TABLE \`${DB}\`.\`memos\` (id INT PRIMARY KEY, tenant_id VARCHAR(255) NOT NULL, name VARCHAR(255))`,
  );
  await pool.query(`CREATE TABLE \`${DB}\`.\`tags\` (id INT PRIMARY KEY, name VARCHAR(255))`);
  dataSource = new DataSource({
    type: "mysql",
    url: `${MYSQL_URL}/${DB}`,
    entities: [NoteSchema, MemoSchema, TagSchema],
    synchronize: false,
  });
  await dataSource.initialize();
  registerStratumSubscriber(dataSource);
});

afterAll(async () => {
  await dataSource?.destroy();
  await pool.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await pool.query(`DROP DATABASE IF EXISTS \`${VIEW_DB}\``);
  await cleanupTestPool();
});

beforeEach(async () => {
  for (const table of ["notes", "memos", "tags"]) {
    await pool.query(`DELETE FROM \`${DB}\`.\`${table}\``);
  }
  await pool.query(`INSERT INTO \`${DB}\`.\`notes\` VALUES (1, 'tenant-a', 'a-note'), (2, 'tenant-b', 'b-note')`);
  await pool.query(`INSERT INTO \`${DB}\`.\`memos\` VALUES (2, 'tenant-b', 'b-memo')`);
});

describe("StratumTypeOrmSubscriber writes without listeners", () => {
  it("save() with listeners off writes the current tenant's tenant_id", async () => {
    await asA(() =>
      dataSource.getRepository(NoteSchema).save({ id: 9, tenant_id: "tenant-b", name: "n" }, { listeners: false }),
    );
    expect((await notes()).find((n) => n.id === 9)?.tenant_id).toBe("tenant-a");
  });

  it("an insert builder with listeners off writes the current tenant's tenant_id", async () => {
    await asA(() =>
      dataSource
        .createQueryBuilder()
        .insert()
        .into(NoteSchema)
        .values({ id: 9, tenant_id: "tenant-b", name: "n" })
        .callListeners(false)
        .execute(),
    );
    expect((await notes()).find((n) => n.id === 9)?.tenant_id).toBe("tenant-a");
  });

  it("an insert builder with listeners off cannot take another tenant's primary key", async () => {
    await expect(
      asA(() =>
        dataSource
          .createQueryBuilder()
          .insert()
          .into(NoteSchema)
          .values({ id: 2, name: "n" })
          .callListeners(false)
          .execute(),
      ),
    ).rejects.toThrow(/another tenant/);
    expect(await notes()).toEqual(untouched);
  });

  it("an update builder with listeners off cannot move a row to another tenant", async () => {
    await asA(() =>
      dataSource
        .createQueryBuilder()
        .update(NoteSchema)
        .set({ tenant_id: "tenant-b", name: "moved" })
        .where("id = 1")
        .callListeners(false)
        .execute(),
    ).catch(() => undefined);
    expect((await notes())[0].tenant_id).toBe("tenant-a");
  });

  it("refuses an insert with another tenant's key with an insert error, not a save() error", async () => {
    let message = "";
    await asA(() => dataSource.getRepository(NoteSchema).insert({ id: 2, name: "n" })).catch((err: Error) => {
      message = err.message;
    });
    expect(message).toMatch(/another tenant/);
    expect(message).not.toMatch(/save\(\)/);
  });
});

describe("StratumTypeOrmSubscriber tenant column under another property name", () => {
  it("save() writes the current tenant to a tenant_id column mapped to tenantId", async () => {
    await asA(() => dataSource.getRepository(MemoSchema).save({ id: 5, name: "m" }));
    expect(await rows(`SELECT id, tenant_id FROM \`${DB}\`.\`memos\` WHERE id = 5`)).toEqual([
      { id: 5, tenant_id: "tenant-a" },
    ]);
  });

  it("refuses save() with another tenant's key through a tenantId property", async () => {
    await expect(asA(() => dataSource.getRepository(MemoSchema).save({ id: 2, name: "changed" }))).rejects.toThrow(
      /another tenant/,
    );
    expect(await rows(`SELECT * FROM \`${DB}\`.\`memos\``)).toEqual([
      { id: 2, tenant_id: "tenant-b", name: "b-memo" },
    ]);
  });

  it("an update cannot move a row through the tenantId property", async () => {
    await asA(() => dataSource.getRepository(MemoSchema).save({ id: 5, name: "m" }));
    await asA(() => dataSource.getRepository(MemoSchema).update({ id: 5 }, { tenantId: "tenant-b" })).catch(
      () => undefined,
    );
    expect(await rows(`SELECT tenant_id FROM \`${DB}\`.\`memos\` WHERE id = 5`)).toEqual([{ tenant_id: "tenant-a" }]);
  });
});

describe("StratumTypeOrmSubscriber INSERT ... SELECT", () => {
  it("copies only the current tenant's rows from a tenant entity into another table", async () => {
    await asA(() =>
      dataSource
        .createQueryBuilder()
        .insert()
        .into(TagSchema, ["id", "name"])
        .valuesFromSelect(
          dataSource.getRepository(NoteSchema).createQueryBuilder("n").select("n.id", "id").addSelect("n.name", "name"),
        )
        .execute(),
    );
    expect(await rows(`SELECT * FROM \`${DB}\`.\`tags\``)).toEqual([{ id: 1, name: "a-note" }]);
  });

  it("refuses an INSERT ... SELECT into a tenant entity", async () => {
    await expect(
      asA(() =>
        dataSource
          .createQueryBuilder()
          .insert()
          .into(NoteSchema, ["id", "tenant_id", "name"])
          .valuesFromSelect((qb) => qb.select("t.id + 100", "id").addSelect("'tenant-b'", "tenant_id").addSelect("t.name", "name").from(TagSchema, "t"))
          .execute(),
      ),
    ).rejects.toThrow(/Stratum/);
    expect(await notes()).toEqual(untouched);
  });
});

interface NoteView {
  id: number;
  tenant_id: string;
}

describe("StratumTypeOrmSubscriber view entities", () => {
  it("synchronize() creates a query builder view without the read scope, and reads of the view are scoped", async () => {
    await pool.query(`DROP DATABASE IF EXISTS \`${VIEW_DB}\``);
    await pool.query(`CREATE DATABASE \`${VIEW_DB}\``);
    const ViewSchema = new EntitySchema<NoteView>({
      name: "Q2BNoteView",
      tableName: "note_view",
      type: "view",
      expression: (ds: DataSource) =>
        ds
          .createQueryBuilder()
          .select("n.id", "id")
          .addSelect("n.tenant_id", "tenant_id")
          .from(NoteSchema, "n"),
      columns: {
        id: { type: Number, primary: true },
        tenant_id: { type: String },
      },
    });
    const views = new DataSource({
      type: "mysql",
      url: `${MYSQL_URL}/${VIEW_DB}`,
      entities: [NoteSchema, ViewSchema],
      synchronize: false,
    });
    await views.initialize();
    try {
      registerStratumSubscriber(views);
      await views.synchronize();
      const [definition] = await rows<{ VIEW_DEFINITION: string }>(
        `SELECT VIEW_DEFINITION FROM information_schema.VIEWS WHERE TABLE_SCHEMA = '${VIEW_DB}' AND TABLE_NAME = 'note_view'`,
      );
      expect(definition.VIEW_DEFINITION).not.toMatch(/stratumTenantId|tenant-a/);
      await pool.query(`INSERT INTO \`${VIEW_DB}\`.\`notes\` VALUES (1, 'tenant-a', 'a'), (2, 'tenant-b', 'b')`);
      const seen = await asA(() => views.getRepository(ViewSchema).find());
      expect(seen.map((v) => Number(v.id))).toEqual([1]);
    } finally {
      await views.destroy();
    }
  });
});

interface Item {
  tenant_id: string;
  sku: string;
  name: string;
}

const ItemSchema = new EntitySchema<Item>({
  name: "Q2BItem",
  tableName: "items",
  columns: {
    tenant_id: { type: String, primary: true },
    sku: { type: String, primary: true },
    name: { type: String },
  },
});

describe("StratumTypeOrmSubscriber upserts and nested saves", () => {
  it("checks the key of a save() started by a subscriber while an upsert runs", async () => {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS \`${DB}\`.\`items\` (tenant_id VARCHAR(255) NOT NULL, sku VARCHAR(64) NOT NULL, name VARCHAR(255), PRIMARY KEY (tenant_id, sku))`,
    );
    const nested = new DataSource({
      type: "mysql",
      url: `${MYSQL_URL}/${DB}`,
      entities: [NoteSchema, ItemSchema],
      synchronize: false,
    });
    await nested.initialize();
    try {
      registerStratumSubscriber(nested);
      // A subscriber that saves a note while the item upsert's listeners run.
      nested.subscribers.push({
        beforeInsert: (event: { metadata: { name: string } }) =>
          event.metadata.name === "Q2BItem"
            ? nested.getRepository(NoteSchema).save({ id: 2, name: "from-subscriber" })
            : undefined,
      });
      await expect(
        asA(() =>
          nested
            .createQueryBuilder()
            .insert()
            .into(ItemSchema)
            .values({ sku: "s1", name: "i" })
            .orUpdate(["name"], ["tenant_id", "sku"])
            .execute(),
        ),
      ).rejects.toThrow(/another tenant/);
      expect(await notes()).toEqual(untouched);
    } finally {
      await nested.destroy();
    }
  });
});
