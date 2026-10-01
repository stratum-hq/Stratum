import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as crypto from "node:crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import ts from "typescript";
import { createProject, type Template } from "../index.js";
import { createPresetProject } from "../preset-project.js";
import type { Framework } from "../matrix.js";

/**
 * Runs the tenant resolution that create generates, for each framework,
 * against requests a client controls: the Host header and the bearer token.
 *
 * The framework packages are not installed in this repository, so each is
 * replaced with a stand-in that records the handlers the generated code
 * registers and then drives them the way the framework would. jose is
 * replaced with a minimal HS256 verifier that checks the signature, the
 * algorithm allow-list and expiry the way jose's jwtVerify does.
 */

const SECRET = "test-secret-for-generated-tenant-code-0123456789";
const VICTIM_HOST = "victim-tenant.app.example.com";

// ── jose stand-in and token helpers ──────────────────────────────────

const jose = {
  async jwtVerify(token: string, key: Uint8Array, options?: { algorithms?: string[] }) {
    const [h, p, s, ...rest] = token.split(".");
    if (!h || !p || s === undefined || rest.length > 0) throw new Error("JWSInvalid");
    const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    if (options?.algorithms && !options.algorithms.includes(header.alg)) {
      throw new Error("JOSEAlgNotAllowed");
    }
    if (header.alg !== "HS256") throw new Error("JOSENotSupported");
    const expected = crypto.createHmac("sha256", key).update(`${h}.${p}`).digest();
    const actual = Buffer.from(s, "base64url");
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      throw new Error("JWSSignatureVerificationFailed");
    }
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) {
      throw new Error("JWTExpired");
    }
    return { payload, protectedHeader: header };
  },
};

function sign(payload: Record<string, unknown>, secret: string, alg = "HS256"): string {
  const h = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString("base64url");
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const s =
    alg === "none" ? "" : crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}

/** Compiles a generated TypeScript file and runs it with the given module stand-ins. */
function load(source: string, modules: Record<string, unknown>): Record<string, unknown> {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      experimentalDecorators: true,
      jsx: ts.JsxEmit.React,
    },
  });
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  const requireStub = (id: string): unknown => {
    if (id === "jose") return jose;
    if (id in modules) return modules[id];
    throw new Error(`generated code imports an unexpected module: ${id}`);
  };
  new Function("require", "module", "exports", outputText)(requireStub, mod, mod.exports);
  return mod.exports;
}

// ── Framework stand-ins ──────────────────────────────────────────────

/** What a request to GET /tenants ended with. */
interface Outcome {
  status: number;
  tenantId: string | null;
}

interface Request {
  host: string;
  authorization?: string;
}

type Runner = (files: Record<string, string>, req: Request) => Promise<Outcome>;

const runExpress: Runner = async (files, req) => {
  const middlewares: Array<(req: unknown, res: unknown, next: () => void) => unknown> = [];
  const routes: Record<string, (req: unknown, res: unknown) => unknown> = {};
  const express = Object.assign(
    () => ({
      use: (fn: (typeof middlewares)[number]) => middlewares.push(fn),
      get: (p: string, fn: (req: unknown, res: unknown) => unknown) => (routes[p] = fn),
      listen: () => undefined,
    }),
    { json: () => (_req: unknown, _res: unknown, next: () => void) => next() },
  );
  load(files["src/index.ts"], { express });

  const request: Record<string, unknown> = {
    headers: { host: req.host, ...(req.authorization ? { authorization: req.authorization } : {}) },
    hostname: req.host,
  };
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  for (const mw of middlewares) {
    let called = false;
    await mw(request, res, () => (called = true));
    if (!called) return { status: res.statusCode, tenantId: null };
  }
  await routes["/tenants"](request, res);
  return { status: res.statusCode, tenantId: (res.body as { tenantId?: string })?.tenantId ?? null };
};

const runFastify: Runner = async (files, req) => {
  const hooks: Array<(request: unknown, reply: unknown) => unknown> = [];
  const routes: Record<string, (request: unknown, reply: unknown) => unknown> = {};
  const Fastify = () => ({
    decorateRequest: () => undefined,
    addHook: (_name: string, fn: (typeof hooks)[number]) => hooks.push(fn),
    get: (p: string, fn: (request: unknown, reply: unknown) => unknown) => (routes[p] = fn),
    listen: () => undefined,
    log: { error: () => undefined },
  });
  load(files["src/index.ts"], { fastify: Fastify });

  const request: Record<string, unknown> = {
    headers: { host: req.host, ...(req.authorization ? { authorization: req.authorization } : {}) },
    hostname: req.host,
  };
  const reply = {
    statusCode: 200,
    sent: false,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    code(code: number) {
      this.statusCode = code;
      return this;
    },
    send(body: unknown) {
      this.body = body;
      this.sent = true;
      return this;
    },
  };
  for (const hook of hooks) {
    await hook(request, reply);
    if (reply.sent) return { status: reply.statusCode, tenantId: null };
  }
  const out = await routes["/tenants"](request, reply);
  const body = reply.sent ? reply.body : out;
  return { status: reply.statusCode, tenantId: (body as { tenantId?: string })?.tenantId ?? null };
};

const runHono: Runner = async (files, req) => {
  const middlewares: Array<(c: unknown, next: () => Promise<void>) => unknown> = [];
  const routes: Record<string, (c: unknown) => unknown> = {};
  class Hono {
    use(_p: string, fn: (typeof middlewares)[number]) {
      middlewares.push(fn);
    }
    get(p: string, fn: (c: unknown) => unknown) {
      routes[p] = fn;
    }
    fetch = () => undefined;
  }
  load(files["src/index.ts"], { hono: { Hono }, "@hono/node-server": { serve: () => undefined } });

  const vars: Record<string, unknown> = {};
  const headers: Record<string, string> = {
    host: req.host,
    ...(req.authorization ? { authorization: req.authorization } : {}),
  };
  const c = {
    req: { url: `http://${req.host}/tenants`, header: (name: string) => headers[name.toLowerCase()] },
    set: (k: string, v: unknown) => (vars[k] = v),
    get: (k: string) => vars[k],
    json: (body: unknown, status = 200) => ({ status, body }),
  };
  for (const mw of middlewares) {
    let called = false;
    const res = (await mw(c, async () => {
      called = true;
    })) as { status: number } | undefined;
    if (!called) return { status: res?.status ?? 500, tenantId: null };
  }
  const res = (await routes["/tenants"](c)) as { status: number; body: { tenantId?: string } };
  return { status: res.status, tenantId: res.body?.tenantId ?? null };
};

const runNestjs: Runner = async (files, req) => {
  class UnauthorizedException extends Error {
    status = 401;
  }
  const decorator = () => () => undefined;
  const common = {
    Injectable: decorator,
    Controller: decorator,
    Get: decorator,
    Req: decorator,
    Module: decorator,
    UnauthorizedException,
  };
  const { TenantGuard } = load(files["src/tenant.guard.ts"], { "@nestjs/common": common }) as {
    TenantGuard: new () => { canActivate(ctx: unknown): unknown };
  };
  const { AppController } = load(files["src/app.controller.ts"], { "@nestjs/common": common }) as {
    AppController: new () => { tenants(req: unknown): unknown };
  };

  const request: Record<string, unknown> = {
    headers: { host: req.host, ...(req.authorization ? { authorization: req.authorization } : {}) },
    hostname: req.host,
  };
  const ctx = { switchToHttp: () => ({ getRequest: () => request }) };
  try {
    if (!(await new TenantGuard().canActivate(ctx))) return { status: 403, tenantId: null };
    const body = (await new AppController().tenants(request)) as { tenantId?: string };
    return { status: 200, tenantId: body?.tenantId ?? null };
  } catch (err) {
    return { status: (err as { status?: number }).status ?? 500, tenantId: null };
  }
};

const runNextjs: Runner = async (files, req) => {
  const NextResponse = {
    next: (init?: { request?: { headers?: Headers } }) => ({
      status: 200,
      headers: init?.request?.headers ?? new Headers(),
    }),
    json: (_body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      headers: new Headers(),
    }),
  };
  const { proxy } = load(files["src/proxy.ts"], { "next/server": { NextResponse } }) as {
    proxy: (request: unknown) => Promise<{ status: number; headers: Headers }>;
  };
  const res = await proxy({
    headers: new Headers({
      host: req.host,
      ...(req.authorization ? { authorization: req.authorization } : {}),
    }),
    nextUrl: { pathname: "/tenants" },
  });
  return { status: res.status, tenantId: res.headers.get("x-tenant-id") };
};

// ── Generated projects ───────────────────────────────────────────────

let tmp: string;
let savedSecret: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-create-jwt-"));
  savedSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SECRET;
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedSecret;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function readAll(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return out;
}

function presetFiles(framework: Framework): Record<string, string> {
  const dir = path.join(tmp, `preset-${framework}`);
  fs.mkdirSync(dir, { recursive: true });
  createPresetProject("jwt-app", { database: "postgres", strategy: "rls", orm: "pg", framework }, dir, true);
  return readAll(dir);
}

function templateFiles(template: Template): Record<string, string> {
  const dir = path.join(tmp, `template-${template}`);
  fs.mkdirSync(dir, { recursive: true });
  createProject("jwt-app", template, dir, true);
  return readAll(dir);
}

const cases: Array<[string, () => Record<string, string>, Runner]> = [
  ["express preset", () => presetFiles("express"), runExpress],
  ["fastify preset", () => presetFiles("fastify"), runFastify],
  ["hono preset", () => presetFiles("hono"), runHono],
  ["nestjs preset", () => presetFiles("nestjs"), runNestjs],
  ["nextjs preset", () => presetFiles("nextjs"), runNextjs],
  ["express template", () => templateFiles("express"), runExpress],
  ["fastify template", () => templateFiles("fastify"), runFastify],
  ["nextjs template", () => templateFiles("nextjs"), runNextjs],
];

for (const [name, generate, run] of cases) {
  describe(`${name} takes the tenant only from a verified JWT`, () => {
    it("refuses a bearer token signed with a key other than JWT_SECRET", async () => {
      const forged = sign({ tenant_id: "victim-tenant" }, "attacker-chosen-secret");
      const out = await run(generate(), { host: VICTIM_HOST, authorization: `Bearer ${forged}` });
      expect(out.status).toBe(401);
      expect(out.tenantId).toBeNull();
    });

    it("refuses an unsigned token with alg none", async () => {
      const unsigned = sign({ tenant_id: "victim-tenant" }, "", "none");
      const out = await run(generate(), { host: VICTIM_HOST, authorization: `Bearer ${unsigned}` });
      expect(out.status).toBe(401);
      expect(out.tenantId).toBeNull();
    });

    it("refuses a valid token that has no tenant_id claim", async () => {
      const token = sign({ sub: "user-1" }, SECRET);
      const out = await run(generate(), { host: VICTIM_HOST, authorization: `Bearer ${token}` });
      expect(out.status).toBe(401);
      expect(out.tenantId).toBeNull();
    });

    it("does not take the tenant from the hostname the client chose", async () => {
      const out = await run(generate(), { host: VICTIM_HOST });
      expect(out.tenantId).toBeNull();
    });

    it("uses the tenant_id claim of a valid token, whatever the hostname says", async () => {
      const token = sign({ tenant_id: "tenant-a" }, SECRET);
      const out = await run(generate(), { host: VICTIM_HOST, authorization: `Bearer ${token}` });
      expect(out.status).toBe(200);
      expect(out.tenantId).toBe("tenant-a");
    });

    it("lists jose as a dependency of the generated project", () => {
      const pkg = JSON.parse(generate()["package.json"]);
      expect(pkg.dependencies).toHaveProperty("jose");
    });
  });
}
