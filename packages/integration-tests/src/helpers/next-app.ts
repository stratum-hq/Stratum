import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { expect, it } from "vitest";

/** The tenant that the tests put in the tenant_id claim. */
export const TENANT = "11111111-1111-1111-1111-111111111111";

/** Returns an HS256 JWT for the payload, signed with the secret. */
export function hs256(payload: Record<string, unknown>, secret: string): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}`;
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** Returns an unsigned JWT with alg none, which a verifier must refuse. */
export function unsignedToken(payload: Record<string, unknown>): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.`;
}

/** Runs a command and throws with its output when it exits non-zero. */
export function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}): string {
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...env },
  });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (${res.status})\n${res.stdout}\n${res.stderr}`);
  }
  return res.stdout;
}

/**
 * Writes app/api/probe/route.ts under the app root. The route reports the
 * tenant headers that server code receives after the proxy or middleware.
 */
export function writeProbeRoute(appRoot: string): void {
  const probe = path.join(appRoot, "app/api/probe/route.ts");
  fs.mkdirSync(path.dirname(probe), { recursive: true });
  fs.writeFileSync(
    probe,
    `export const dynamic = "force-dynamic";
export function GET(request: Request): Response {
  return Response.json({
    tenantId: request.headers.get("x-tenant-id"),
    slug: request.headers.get("x-tenant-slug"),
  });
}
`,
  );
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

/** A `next start` server and the function that stops it. */
export interface NextServer {
  baseUrl: string;
  stop: () => void;
}

/** Starts `next start` for a built project and waits until /api/probe answers. */
export async function startNext(dir: string, jwtSecret: string): Promise<NextServer> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: dir,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production", JWT_SECRET: jwtSecret },
    stdio: "ignore",
  });
  const stop = () => server.kill("SIGTERM");
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(`${baseUrl}/api/probe`);
      return { baseUrl, stop };
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  stop();
  throw new Error(`next start did not answer at ${baseUrl}`);
}

/**
 * Where `next build` records the tenant check. Next.js 16 records proxy.ts
 * (and a deprecated middleware.ts) in functions-config-manifest.json under
 * "/_middleware", with the runtime and the matchers. Next.js 15 records an
 * edge middleware in middleware-manifest.json under "/".
 */
export function readFunctionsConfig(dir: string): Record<string, { runtime?: string; matchers?: { originalSource?: string }[] }> {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, ".next/server/functions-config-manifest.json"), "utf8"),
  ) as { functions: Record<string, { runtime?: string; matchers?: { originalSource?: string }[] }> };
  return manifest.functions;
}

/**
 * Registers the tests that a running tenant proxy or middleware must pass:
 * every token that does not verify gets 401, a client-sent tenant header is
 * removed, and only a verified tenant_id claim reaches server code.
 *
 * @param baseUrl - Returns the URL of the running server, once it is up.
 * @param jwtSecret - The JWT_SECRET the server runs with.
 */
export function tenantGateTests(baseUrl: () => string, jwtSecret: string): void {
  const probe = (headers: Record<string, string>) => fetch(`${baseUrl()}/api/probe`, { headers });

  it("rejects a bearer token signed with another key", async () => {
    const forged = hs256({ tenant_id: TENANT }, "not-the-secret-not-the-secret-not-the");
    expect((await probe({ authorization: `Bearer ${forged}` })).status).toBe(401);
  });

  it("rejects a bearer token that is not a JWT", async () => {
    expect((await probe({ authorization: "Bearer garbage" })).status).toBe(401);
  });

  it("rejects an unsigned token with alg none", async () => {
    expect((await probe({ authorization: `Bearer ${unsignedToken({ tenant_id: TENANT })}` })).status).toBe(401);
  });

  it("rejects a valid token that has no tenant_id claim", async () => {
    expect((await probe({ authorization: `Bearer ${hs256({ sub: "user-1" }, jwtSecret)}` })).status).toBe(401);
  });

  it("removes the tenant headers a client sent", async () => {
    const res = await probe({ "x-tenant-id": "evil", "x-tenant-slug": "evil" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tenantId: null, slug: null });
  });

  it("forwards the tenant_id claim of a valid token, not the client's header", async () => {
    const token = hs256({ tenant_id: TENANT }, jwtSecret);
    const res = await probe({ authorization: `Bearer ${token}`, "x-tenant-id": "evil" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tenantId: TENANT });
  });
}

/** Returns the keys of the middleware entries in middleware-manifest.json. */
export function readMiddlewareManifest(dir: string): string[] {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, ".next/server/middleware-manifest.json"), "utf8"),
  ) as { middleware: Record<string, unknown> };
  return Object.keys(manifest.middleware);
}
