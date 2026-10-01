import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createCliEntry, scaffoldProject } from "./helpers/create-cli.js";

/**
 * Projects that `@stratum-hq/create` generates must install and build as
 * generated. The express template is installed, built with tsc and started,
 * to prove its tenant middleware answers 401 without a verified token and
 * takes the tenant from a valid HS256 token. The drizzle preset is installed
 * and built, and drizzle-kit generates a migration from the schema file its
 * config points at. Installs run one at a time and need network access to
 * the npm registry.
 */

const DRIZZLE_PRESET = "postgres-rls-drizzle-none";
const JWT_SECRET = crypto.randomBytes(32).toString("base64url");
const TENANT = "11111111-1111-1111-1111-111111111111";

let tmp: string;

function hs256(payload: Record<string, unknown>, secret: string): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}`;
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function run(cmd: string, args: string[], cwd: string): string {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (${res.status})\n${res.stdout}\n${res.stderr}`);
  }
  return res.stdout;
}

function install(dir: string): void {
  run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts"], dir);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function waitForServer(url: string): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`the generated server did not answer at ${url}`);
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-create-build-"));
});

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe("@stratum-hq/create express template, installed, built and started", () => {
  let dir: string;
  let server: ChildProcess | undefined;
  let baseUrl: string;

  beforeAll(async () => {
    const res = spawnSync(process.execPath, [createCliEntry(), "express-app", "--template", "express", "--skip-install"], {
      cwd: tmp,
      encoding: "utf8",
    });
    if (res.status !== 0) throw new Error(`create --template express failed\n${res.stdout}\n${res.stderr}`);
    dir = path.join(tmp, "express-app");

    install(dir);
    run("npm", ["run", "build"], dir);

    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ["dist/index.js"], {
      cwd: dir,
      env: { ...process.env, JWT_SECRET, PORT: String(port) },
      stdio: "ignore",
    });
    await waitForServer(`${baseUrl}/health`);
  }, 600_000);

  afterAll(() => {
    server?.kill("SIGTERM");
  });

  it("answers 401 on /tenants without a token", async () => {
    const res = await fetch(`${baseUrl}/tenants`);
    expect(res.status).toBe(401);
  });

  it("answers 401 to a token signed with another key", async () => {
    const forged = hs256({ tenant_id: TENANT }, "not-the-secret-not-the-secret-not-the");
    const res = await fetch(`${baseUrl}/tenants`, { headers: { authorization: `Bearer ${forged}` } });
    expect(res.status).toBe(401);
  });

  it("ignores a client x-tenant-id header", async () => {
    const res = await fetch(`${baseUrl}/tenants`, { headers: { "x-tenant-id": TENANT } });
    expect(res.status).toBe(401);
  });

  it("answers 200 with the tenant of a valid HS256 token", async () => {
    const token = hs256({ tenant_id: TENANT }, JWT_SECRET);
    const res = await fetch(`${baseUrl}/tenants`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tenantId: TENANT });
  });
});

describe(`@stratum-hq/create ${DRIZZLE_PRESET}, installed and built`, () => {
  let dir: string;

  beforeAll(() => {
    dir = scaffoldProject(tmp, "drizzle-app", DRIZZLE_PRESET);
    install(dir);
  }, 600_000);

  it("builds with tsc", () => {
    run("npm", ["run", "build"], dir);
    expect(fs.existsSync(path.join(dir, "dist/index.js"))).toBe(true);
  }, 120_000);

  it("generates a migration from the schema drizzle.config.ts points at", () => {
    run("npx", ["drizzle-kit", "generate"], dir);
    const sql = fs
      .readdirSync(path.join(dir, "drizzle"))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => fs.readFileSync(path.join(dir, "drizzle", f), "utf8"))
      .join("\n");
    expect(sql).toContain(`CREATE TABLE "notes"`);
  }, 120_000);

  it("installs no drizzle-orm, drizzle-kit or esbuild version with a published advisory", () => {
    // npm audit exits non-zero when it finds anything, so read its JSON report.
    const res = spawnSync("npm", ["audit", "--json"], { cwd: dir, encoding: "utf8" });
    const report = JSON.parse(res.stdout) as { vulnerabilities?: Record<string, unknown> };
    expect(report.vulnerabilities).toBeDefined();
    const names = Object.keys(report.vulnerabilities ?? {});
    expect(names).not.toContain("drizzle-orm");
    expect(names).not.toContain("drizzle-kit");
    expect(names).not.toContain("esbuild");
  }, 120_000);
});
