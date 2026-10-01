import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createCliEntry, scaffoldProject } from "./helpers/create-cli.js";

/**
 * The Next.js projects that `@stratum-hq/create` generates must run their
 * tenant middleware. Next.js runs middleware only from the directory that
 * holds the app directory, so with the app in src/app the middleware must be
 * src/middleware.ts, and `next build` needs a root layout.
 *
 * The template and the preset write the same Next.js files, which the first
 * tests check. One generated project (the preset) is then installed, built
 * with `next build` and started, to prove that Next.js registers the
 * middleware and that it rejects a forged token and strips a client
 * x-tenant-id. Installing needs network access to the npm registry.
 */

const PRESET = "postgres-rls-pg-nextjs";
const JWT_SECRET = crypto.randomBytes(32).toString("base64url");
const TENANT = "11111111-1111-1111-1111-111111111111";

let tmp: string;
let templateDir: string;
let presetDir: string;
let server: ChildProcess | undefined;
let baseUrl: string;

function hs256(payload: Record<string, unknown>, secret: string): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}`;
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}): void {
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...env },
  });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (${res.status})\n${res.stdout}\n${res.stderr}`);
  }
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
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`next start did not answer at ${url}`);
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-create-next-"));
  const res = spawnSync(process.execPath, [createCliEntry(), "next-template-app", "--template", "nextjs", "--skip-install"], {
    cwd: tmp,
    encoding: "utf8",
  });
  if (res.status !== 0) throw new Error(`create --template nextjs failed\n${res.stdout}\n${res.stderr}`);
  templateDir = path.join(tmp, "next-template-app");
  presetDir = scaffoldProject(tmp, "next-preset-app", PRESET);
});

afterAll(() => {
  server?.kill("SIGTERM");
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe("@stratum-hq/create Next.js file layout", () => {
  for (const [name, dir] of [
    ["template", () => templateDir],
    ["preset", () => presetDir],
  ] as const) {
    it(`${name}: writes the middleware next to the app directory and a root layout`, () => {
      expect(fs.existsSync(path.join(dir(), "src/app/page.tsx"))).toBe(true);
      expect(fs.existsSync(path.join(dir(), "src/app/layout.tsx"))).toBe(true);
      expect(fs.existsSync(path.join(dir(), "src/middleware.ts"))).toBe(true);
      expect(fs.existsSync(path.join(dir(), "middleware.ts"))).toBe(false);
    });
  }

  it("template and preset write the same middleware and layout", () => {
    for (const file of ["src/middleware.ts", "src/app/layout.tsx"]) {
      const read = (dir: string, name: string) =>
        fs.readFileSync(path.join(dir, file), "utf8").replaceAll(name, "<project>");
      expect(read(templateDir, "next-template-app")).toBe(read(presetDir, "next-preset-app"));
    }
  });
});

describe(`@stratum-hq/create ${PRESET} built with next build`, () => {
  beforeAll(async () => {
    // A probe route that reports the tenant header server code receives.
    const probe = path.join(presetDir, "src/app/api/probe/route.ts");
    fs.mkdirSync(path.dirname(probe), { recursive: true });
    fs.writeFileSync(
      probe,
      `export const dynamic = "force-dynamic";
export function GET(request: Request): Response {
  return Response.json({ tenantId: request.headers.get("x-tenant-id") });
}
`,
    );
    run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts"], presetDir);
    run("npx", ["next", "build"], presetDir, { NODE_ENV: "production" });

    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], {
      cwd: presetDir,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production", JWT_SECRET },
      stdio: "ignore",
    });
    await waitForServer(`${baseUrl}/api/probe`);
  }, 600_000);

  it("registers the middleware in the build manifest", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(presetDir, ".next/server/middleware-manifest.json"), "utf8"),
    ) as { middleware: Record<string, unknown> };
    expect(Object.keys(manifest.middleware)).toContain("/");
  });

  it("rejects a bearer token that does not verify", async () => {
    const forged = hs256({ tenant_id: TENANT }, "not-the-secret-not-the-secret-not-the");
    const res = await fetch(`${baseUrl}/api/probe`, { headers: { authorization: `Bearer ${forged}` } });
    expect(res.status).toBe(401);
    const garbage = await fetch(`${baseUrl}/api/probe`, { headers: { authorization: "Bearer garbage" } });
    expect(garbage.status).toBe(401);
  });

  it("strips a client x-tenant-id and forwards only the verified tenant", async () => {
    const spoofed = await fetch(`${baseUrl}/api/probe`, { headers: { "x-tenant-id": "evil" } });
    expect(await spoofed.json()).toEqual({ tenantId: null });

    const token = hs256({ tenant_id: TENANT }, JWT_SECRET);
    const verified = await fetch(`${baseUrl}/api/probe`, {
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": "evil" },
    });
    expect(await verified.json()).toEqual({ tenantId: TENANT });
  });
});
