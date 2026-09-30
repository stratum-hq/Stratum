import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Sequelize, DataTypes, Model, type ModelStatic } from "sequelize";
import type { Pool } from "mysql2/promise";
import { getTestPool, cleanupTestPool } from "./setup.js";
import { withMysqlTenantScope, type SequelizeLike } from "../../integrations/sequelize.js";

const MYSQL_URL = process.env.MYSQL_URL || "mysql://root@localhost:3306";

// The database name is unique to this file, so the file can run alongside
// other suites on a shared server.
const DB = "q2_stratum_sequelize";

interface NoteRow {
  id: number;
  tenant_id: string;
  name: string;
  owner_id: number;
}

let pool: Pool;
let sequelize: Sequelize;
let Note: ModelStatic<Model>;
let Owner: ModelStatic<Model>;
let Tag: ModelStatic<Model>;

async function notes(): Promise<NoteRow[]> {
  const [rows] = await pool.query(`SELECT * FROM \`${DB}\`.\`notes\` ORDER BY id`);
  return rows as NoteRow[];
}

function asA<T>(fn: (transaction: unknown) => Promise<T>): Promise<T> {
  return withMysqlTenantScope(sequelize as unknown as SequelizeLike, "tenant-a", (_scoped, transaction) =>
    fn(transaction),
  );
}

/** Runs a write that may be refused; refusal is an acceptable outcome. */
async function attempt(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    // refused
  }
}

function ids(rows: Model[]): number[] {
  return rows.map((r) => Number(r.get("id"))).sort((x, y) => x - y);
}

const untouched: NoteRow[] = [
  { id: 1, tenant_id: "tenant-a", name: "a-note", owner_id: 2 },
  { id: 2, tenant_id: "tenant-b", name: "b-note", owner_id: 1 },
  { id: 3, tenant_id: "tenant-a", name: "a-note-2", owner_id: 1 },
];

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
  await pool.query(`CREATE TABLE \`${DB}\`.\`tags\` (id INT PRIMARY KEY, name VARCHAR(255))`);
  sequelize = new Sequelize(`${MYSQL_URL}/${DB}`, { dialect: "mysql", logging: false });
  const common = { timestamps: false, underscored: false };
  Owner = sequelize.define(
    "Owner",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true },
      tenant_id: { type: DataTypes.STRING },
      name: { type: DataTypes.STRING },
    },
    { ...common, tableName: "owners" },
  );
  Note = sequelize.define(
    "Note",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true },
      tenant_id: { type: DataTypes.STRING },
      name: { type: DataTypes.STRING },
      owner_id: { type: DataTypes.INTEGER },
    },
    { ...common, tableName: "notes" },
  );
  Tag = sequelize.define(
    "Tag",
    { id: { type: DataTypes.INTEGER, primaryKey: true }, name: { type: DataTypes.STRING } },
    { ...common, tableName: "tags" },
  );
  Note.belongsTo(Owner, { as: "owner", foreignKey: "owner_id" });
  Owner.hasMany(Note, { as: "notes", foreignKey: "owner_id" });
});

afterAll(async () => {
  await sequelize?.close();
  await pool.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await cleanupTestPool();
});

beforeEach(async () => {
  for (const table of ["owners", "notes", "tags"]) {
    await pool.query(`DELETE FROM \`${DB}\`.\`${table}\``);
  }
  await pool.query(`INSERT INTO \`${DB}\`.\`owners\` VALUES (1, 'tenant-a', 'alice'), (2, 'tenant-b', 'bob')`);
  // Note 1 (tenant-a) points at tenant-b's owner, and note 2 (tenant-b) points
  // at tenant-a's owner, so includes can cross the tenant boundary.
  await pool.query(
    `INSERT INTO \`${DB}\`.\`notes\` VALUES (1, 'tenant-a', 'a-note', 2), (2, 'tenant-b', 'b-note', 1), (3, 'tenant-a', 'a-note-2', 1)`,
  );
  await pool.query(`INSERT INTO \`${DB}\`.\`tags\` VALUES (1, 't1'), (2, 't2')`);
});

describe("withMysqlTenantScope Sequelize reads", () => {
  it("findAll returns only the current tenant's rows, with or without the transaction", async () => {
    expect(ids(await asA((transaction) => Note.findAll({ transaction } as object)))).toEqual([1, 3]);
    expect(ids(await asA(() => Note.findAll()))).toEqual([1, 3]);
  });

  it("findByPk and findOne do not return another tenant's row", async () => {
    expect(await asA(() => Note.findByPk(2))).toBeNull();
    expect(await asA(() => Note.findOne({ where: { id: 2 } }))).toBeNull();
    expect((await asA(() => Note.findByPk(3)))?.get("name")).toBe("a-note-2");
  });

  it("count, findAndCountAll and aggregates see only the current tenant's rows", async () => {
    expect(await asA(() => Note.count())).toBe(2);
    expect((await asA(() => Note.findAndCountAll())).count).toBe(2);
    expect(Number(await asA(() => Note.sum("id")))).toBe(4);
    expect(Number(await asA(() => Note.max("id")))).toBe(3);
  });

  it("hooks: false does not skip the tenant filter", async () => {
    expect(ids(await asA(() => Note.findAll({ hooks: false })))).toEqual([1, 3]);
    expect(await asA(() => Note.count({ hooks: false } as object))).toBe(2);
  });

  it("an include does not load another tenant's related row and keeps the parent", async () => {
    const rows = await asA(() => Note.findAll({ include: [{ model: Owner, as: "owner" }], order: [["id", "ASC"]] }));
    expect(rows.map((n) => [n.get("id"), (n.get("owner") as Model | null)?.get("name") ?? null])).toEqual([
      [1, null],
      [3, "alice"],
    ]);
    const owners = await asA(() => Owner.findAll({ include: ["notes"] }));
    expect(owners.map((o) => [o.get("id"), ids(o.get("notes") as Model[])])).toEqual([[1, [3]]]);
  });
});

describe("withMysqlTenantScope Sequelize writes", () => {
  it("a bulk update cannot change another tenant's row or move a row to another tenant", async () => {
    await attempt(() => asA(() => Note.update({ name: "changed" }, { where: { id: 2 } })));
    await attempt(() => asA(() => Note.update({ tenant_id: "tenant-b" }, { where: { id: 1 } })));
    expect(await notes()).toEqual(untouched);
  });

  it("a bulk destroy cannot remove another tenant's row", async () => {
    await attempt(() => asA(() => Note.destroy({ where: { id: 2 } })));
    expect(await notes()).toEqual(untouched);
  });

  it("increment cannot change another tenant's row", async () => {
    await attempt(() => asA(() => Note.increment("owner_id", { where: { id: 2 } })));
    expect(await notes()).toEqual(untouched);
  });

  it("an instance save() or destroy() by another tenant's key is refused", async () => {
    await expect(
      asA(() => Note.build({ id: 2, tenant_id: "tenant-a", name: "changed" }, { isNewRecord: false }).save()),
    ).rejects.toThrow(/another tenant/);
    await expect(
      asA(() => Note.build({ id: 2, tenant_id: "tenant-a" }, { isNewRecord: false }).destroy()),
    ).rejects.toThrow(/another tenant/);
    expect(await notes()).toEqual(untouched);
  });

  it("create and bulkCreate write the current tenant's tenant_id", async () => {
    await asA(() => Note.create({ id: 7, tenant_id: "tenant-b", name: "c", owner_id: 1 }));
    await asA(() => Note.bulkCreate([{ id: 8, name: "d", owner_id: 1 }]));
    const rows = await notes();
    expect(rows.filter((r) => r.id >= 7).map((r) => [r.id, r.tenant_id])).toEqual([
      [7, "tenant-a"],
      [8, "tenant-a"],
    ]);
  });

  it("refuses upsert, bulkCreate with updateOnDuplicate, and truncate on a tenant model", async () => {
    await expect(asA(() => Note.upsert({ id: 2, name: "changed", owner_id: 1 }))).rejects.toThrow(/Stratum/);
    await expect(
      asA(() => Note.bulkCreate([{ id: 2, name: "changed", owner_id: 1 }], { updateOnDuplicate: ["name"] })),
    ).rejects.toThrow(/Stratum/);
    await expect(asA(() => Note.truncate())).rejects.toThrow(/Stratum/);
    await expect(asA(() => Note.destroy({ truncate: true }))).rejects.toThrow(/Stratum/);
    expect(await notes()).toEqual(untouched);
  });

  it("reads, updates and deletes the current tenant's own rows", async () => {
    await asA(async () => {
      await Note.update({ name: "renamed" }, { where: { id: 1 } });
      const note = await Note.findByPk(3);
      await note?.update({ name: "saved" });
      await note?.reload();
      await Note.destroy({ where: { id: 1 } });
    });
    expect(await notes()).toEqual([untouched[1], { ...untouched[2], name: "saved" }]);
  });
});

describe("withMysqlTenantScope Sequelize boundaries", () => {
  it("refuses a model query that bypasses the scoped model methods", async () => {
    await expect(
      asA(() => sequelize.getQueryInterface().select(Note as never, "notes", { where: {} } as never)),
    ).rejects.toThrow(/not tenant-scoped/);
  });

  it("refuses include all, which it cannot filter", async () => {
    await expect(asA(() => Note.findAll({ include: [{ all: true }] }))).rejects.toThrow(/include "all"/);
  });

  it("filters a nested include of a tenant model", async () => {
    const owners = await asA(() =>
      Owner.findAll({ include: [{ association: "notes", include: [{ model: Owner, as: "owner" }] }] }),
    );
    const notesOfAlice = owners[0].get("notes") as Model[];
    expect(ids(notesOfAlice)).toEqual([3]);
    expect((notesOfAlice[0].get("owner") as Model).get("name")).toBe("alice");
  });

  it("leaves models without tenant_id unfiltered", async () => {
    expect(ids(await asA(() => Tag.findAll()))).toEqual([1, 2]);
  });

  it("leaves queries outside the helper untouched", async () => {
    expect(ids(await Note.findAll())).toEqual([1, 2, 3]);
  });
});
