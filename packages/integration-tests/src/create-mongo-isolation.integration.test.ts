import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scaffoldProject } from "./helpers/create-cli.js";
import { useWorkspaceStratumPackages } from "./helpers/workspace-tarballs.js";
import { ROLE_PREFIX } from "./helpers/role-model.js";

/**
 * Generates the MongoDB presets of each strategy with the built
 * `@stratum-hq/create`, installs them with the workspace builds of the Stratum
 * packages, follows the setup the generated project describes, and then uses
 * the generated tenant helper as the app user. A tenant must reach only its
 * own data, and a slug taken from the request (such as the x-tenant-slug
 * header or the subdomain) must reach no tenant's data.
 *
 * Needs a MongoDB server: MONGODB_URL, for example mongodb://localhost:27017.
 * Without it the suite is skipped. Every database name carries the test role
 * prefix, and the suite drops what it creates. Installs need network access
 * to the npm registry for third-party packages.
 */

const MONGODB_URL = process.env.MONGODB_URL;

const PREFIX = ROLE_PREFIX.replace(/[^a-z0-9_]/g, "");

const TENANT_A = "00000000-0000-4000-8000-00000000000a";
const TENANT_B = "00000000-0000-4000-8000-00000000000b";
const TENANT_C = "00000000-0000-4000-8000-00000000000c";

// Runs in the generated project. B's data is written by name as the admin
// user, so it is there whatever the helper does. Each read prints what the
// helper returns for a tenant ID or a slug, or "refused".
const CHECK = `
import mongoose from "mongoose";
const h: any = await import("./src/stratum-mongoose.js");
const [strategy, A, B, slugB, C] = process.argv.slice(2);
const ItemSchema = new mongoose.Schema({ body: String });

const admin = await mongoose.createConnection(process.env.MONGODB_ADMIN_URI!).asPromise();
const bItems =
  strategy === "collection"
    ? admin.collection("items_" + slugB)
    : admin.useDb("stratum_tenant_" + slugB).collection("items");
await bItems.insertOne({ body: "b-secret" });
await admin.close();

const model = async (tenant: string) =>
  strategy === "collection"
    ? await h.getTenantModel("items", ItemSchema, tenant)
    : (await h.getTenantConnection(tenant)).model("Item", ItemSchema, "items");
const sees = (tenant: string) =>
  model(tenant)
    .then((m: any) => m.find())
    .then((docs: any[]) => docs.map((d) => d.body).sort(), () => "refused");

const attempt = (fn: () => Promise<unknown>) => fn().catch(() => "refused");
await attempt(async () => (await model(A)).create({ body: "a-note" }));
const aUpdated = await attempt(
  async () => (await (await model(A)).updateMany({ body: "b-secret" }, { body: "changed-by-a" })).modifiedCount,
);
const result = {
  aSees: await sees(A),
  aUpdated,
  bSees: await sees(B),
  // What a forged x-tenant-slug header or subdomain would carry.
  slugOfB: await sees(slugB),
  // C is not provisioned.
  cSees: await sees(C),
};
console.log("RESULT " + JSON.stringify(result));
process.exit(0);
`;

// Lists, as the admin user, the privileges of the app user, what the
// databases hold, and the routing records.
const INSPECT = `
import mongoose from "mongoose";
const admin = await mongoose.createConnection(process.env.MONGODB_ADMIN_URI!).asPromise();
const appUri = new URL(process.env.MONGODB_URI!);
const user = decodeURIComponent(appUri.username);
const authDb = appUri.searchParams.get("authSource") ?? appUri.pathname.slice(1);
const info = await admin.useDb(authDb).db!.command({ usersInfo: user, showPrivileges: true });
const privileges = (info.users[0]?.inheritedPrivileges ?? [])
  .map((p: any) => \`\${p.resource.db}.\${p.resource.collection}: \${[...p.actions].sort().join(",")}\`)
  .sort();
const { databases } = await admin.db!.admin().listDatabases();
console.log("INSPECT " + JSON.stringify({ user, roles: info.users[0]?.roles ?? [], privileges, databases: databases.map((d: any) => d.name).sort() }));
await admin.close();
process.exit(0);
`;

// Creates the root user of the generated docker-compose.yml, as the MongoDB
// image does on first start. Runs against the test server, SERVER_URL.
const SETUP = `
import mongoose from "mongoose";
const [user, pwd] = process.argv.slice(2);
const server = await mongoose.createConnection(process.env.SERVER_URL!).asPromise();
await server.useDb("admin").db!.command({ createUser: user, pwd, roles: [{ role: "root", db: "admin" }] });
await server.close();
process.exit(0);
`;

// Drops every database the suite created, the app user and its role, and the
// root user. Runs against the test server, SERVER_URL.
const DROP = `
import mongoose from "mongoose";
const [rootUser, appUser, authDb, ...prefixes] = process.argv.slice(2);
const server = await mongoose.createConnection(process.env.SERVER_URL!).asPromise();
const { databases } = await server.db!.admin().listDatabases();
for (const { name } of databases) {
  if (prefixes.some((p) => name.startsWith(p))) await server.useDb(name).db!.dropDatabase();
}
for (const [db, command] of [
  [authDb, { dropUser: appUser }],
  ["admin", { dropRole: appUser }],
  ["admin", { dropUser: rootUser }],
] as const) {
  await server.useDb(db).db!.command(command).catch(() => undefined);
}
await server.close();
process.exit(0);
`;

let tmp: string;

// The generated project reads its settings from its .env file. Node lets a
// variable already in the environment win over .env.
const CHILD_ENV: NodeJS.ProcessEnv = { ...process.env };
for (const key of ["MONGODB_URI", "MONGODB_ADMIN_URI"]) delete CHILD_ENV[key];

function run(cmd: string, args: string[], cwd: string): string {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8", env: CHILD_ENV });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (${res.status})\n${res.stdout}\n${res.stderr}`);
  }
  return res.stdout;
}

/** The URL of the env file with the test server's host and the given database. */
function serverUrl(envUrl: string, database: string): string {
  const u = new URL(envUrl);
  u.host = new URL(MONGODB_URL!).host;
  u.pathname = `/${database}`;
  return u.toString();
}

function parsed(out: string, tag: string): unknown {
  const line = out.split("\n").find((l) => l.startsWith(`${tag} `));
  expect(line, out).toBeDefined();
  return JSON.parse(line!.slice(tag.length + 1));
}

describe.skipIf(!MONGODB_URL)("generated MongoDB presets", () => {
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-create-mongo-"));
  });

  afterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  isolationSuite("collection");
  isolationSuite("database");
});

function isolationSuite(strategy: "collection" | "database"): void {
  const preset = `mongodb-${strategy}-mongoose-none`;
  const project = `${PREFIX}moiso-${strategy}`.replace(/_/g, "-");
  const dbName = project.replace(/-/g, "_");
  const short = strategy === "database" ? "d" : "c";
  const slugs = [`${PREFIX}mo${short}a`, `${PREFIX}mo${short}b`];

  describe(`generated ${preset} project`, () => {
    let dir: string;
    let rootUser: string;
    const serverEnv = { ...CHILD_ENV, SERVER_URL: MONGODB_URL };

    function drop(): void {
      const appUri = new URL(fs.readFileSync(path.join(dir, ".env"), "utf8").match(/^MONGODB_URI=(.*)$/m)![1]);
      const authDb = appUri.searchParams.get("authSource") ?? dbName;
      fs.writeFileSync(path.join(dir, "drop.ts"), DROP);
      const args = [rootUser, decodeURIComponent(appUri.username), authDb, dbName, ...slugs.map((s) => `stratum_tenant_${s}`)];
      const res = spawnSync("npx", ["tsx", "drop.ts", ...args], { cwd: dir, encoding: "utf8", env: serverEnv });
      if (res.status !== 0) throw new Error(`drop failed\n${res.stdout}\n${res.stderr}`);
    }

    beforeAll(() => {
      dir = scaffoldProject(tmp, project, preset);
      const compose = fs.readFileSync(path.join(dir, "docker-compose.yml"), "utf8");
      const composeValue = (key: string) => compose.match(new RegExp(`${key}: (\\S+)`))![1];
      rootUser = composeValue("MONGO_INITDB_ROOT_USERNAME");
      const rootPassword = composeValue("MONGO_INITDB_ROOT_PASSWORD");

      const env = fs.readFileSync(path.join(dir, ".env.example"), "utf8");
      const read = (key: string) => env.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1];
      const app = read("MONGODB_URI")!;
      // An older project has no admin URL: its app URL is the root user's.
      const admin = read("MONGODB_ADMIN_URI");
      fs.writeFileSync(
        path.join(dir, ".env"),
        env
          .replace(/^MONGODB_URI=.*$/m, `MONGODB_URI=${serverUrl(app, dbName)}`)
          .replace(/^MONGODB_ADMIN_URI=.*$/m, `MONGODB_ADMIN_URI=${serverUrl(admin ?? app, dbName)}`) +
          (admin ? "" : `\nMONGODB_ADMIN_URI=${serverUrl(app, dbName)}\n`),
      );

      // Install the workspace builds of the Stratum packages, so the test
      // checks the code under test even before it is on npm.
      const pkgPath = path.join(dir, "package.json");
      useWorkspaceStratumPackages(dir, tmp);
      run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts"], dir);

      // The server as the generated docker-compose.yml sets it up: its root user.
      drop();
      fs.writeFileSync(path.join(dir, "setup.ts"), SETUP);
      const res = spawnSync("npx", ["tsx", "setup.ts", rootUser, rootPassword], { cwd: dir, encoding: "utf8", env: serverEnv });
      if (res.status !== 0) throw new Error(`setup failed\n${res.stdout}\n${res.stderr}`);

      // The setup the generated README describes.
      const scripts = (JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { scripts: Record<string, string> }).scripts;
      if (scripts["db:init"]) run("npm", ["run", "db:init"], dir);
      if (scripts["tenant:provision"]) {
        run("npm", ["run", "tenant:provision", "--", TENANT_A, slugs[0]], dir);
        run("npm", ["run", "tenant:provision", "--", TENANT_B, slugs[1]], dir);
      }
    }, 900_000);

    afterAll(() => {
      if (dir) drop();
    });

    it("type-checks", () => {
      run("npx", ["tsc", "--noEmit", "-p", "."], dir);
    }, 120_000);

    it("reaches each tenant's data only by its verified tenant ID", () => {
      fs.writeFileSync(path.join(dir, "isolation-check.ts"), CHECK);
      const out = run(
        "npx",
        ["tsx", "--env-file=.env", "isolation-check.ts", strategy, TENANT_A, TENANT_B, slugs[1], TENANT_C],
        dir,
      );
      expect(parsed(out, "RESULT")).toEqual({
        aSees: ["a-note"],
        aUpdated: 0,
        bSees: ["b-secret"],
        slugOfB: "refused",
        cSees: "refused",
      });
    }, 120_000);

    it("refuses to provision a tenant under a slug another tenant has", () => {
      const res = spawnSync("npm", ["run", "tenant:provision", "--", TENANT_C, slugs[0]], {
        cwd: dir,
        encoding: "utf8",
        env: CHILD_ENV,
      });
      expect(res.status, res.stdout + res.stderr).not.toBe(0);
      expect(res.stderr).toMatch(/already provisioned/);
    }, 120_000);

    it("connects as an app user that only reads the routing records and drops nothing", () => {
      const env = fs.readFileSync(path.join(dir, ".env.example"), "utf8");
      const appUser = new URL(env.match(/^MONGODB_URI=(.*)$/m)![1]).username;
      const rootUser = fs.readFileSync(path.join(dir, "docker-compose.yml"), "utf8").match(/MONGO_INITDB_ROOT_USERNAME: (\S+)/)![1];
      expect(appUser).not.toBe(rootUser);

      fs.writeFileSync(path.join(dir, "inspect.ts"), INSPECT);
      const out = parsed(run("npx", ["tsx", "--env-file=.env", "inspect.ts"], dir), "INSPECT") as {
        user: string;
        roles: { role: string; db: string }[];
        privileges: string[];
      };
      const data = "createCollection,createIndex,find,insert,remove,update";
      expect(out.roles).toEqual([{ role: out.user, db: "admin" }]);
      expect(out.privileges).toEqual(
        [
          `${dbName}_routing.tenants: find`,
          ...(strategy === "collection"
            ? [`${dbName}.: ${data}`]
            : slugs.map((s) => `stratum_tenant_${s}.: ${data}`)),
        ].sort(),
      );
    }, 120_000);
  });
}
