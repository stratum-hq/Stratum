import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as crypto from "node:crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import ts from "typescript";

// init() is interactive; answer its prompts from a queue.
const selectAnswers: number[] = [];
vi.mock("../../utils/prompt.js", () => ({
  select: vi.fn(async () => selectAnswers.shift() ?? 0),
  confirm: vi.fn(async () => true),
  ask: vi.fn(async () => ""),
}));

import { scaffold } from "../scaffold.js";
import { init } from "../init.js";

/**
 * Runs the Next.js middleware that `stratum init` and `stratum scaffold nextjs`
 * generate, against requests a client controls: the Host header, any
 * x-tenant-id header, and the bearer token.
 *
 * next/server is replaced with a stand-in that records what the middleware
 * returns. jose is replaced with a minimal HS256 verifier that checks the
 * signature, the algorithm allow-list and expiry the way jose's jwtVerify does.
 */

const SECRET = "test-secret-for-generated-middleware-0123456789";

type Outcome =
  | { kind: "next"; headers: Headers }
  | { kind: "json"; status: number; body: unknown };

const nextServer = {
  NextResponse: {
    next: (init?: { request?: { headers?: Headers } }): Outcome => ({
      kind: "next",
      headers: init?.request?.headers ?? new Headers(),
    }),
    json: (body: unknown, init?: { status?: number }): Outcome => ({
      kind: "json",
      status: init?.status ?? 200,
      body,
    }),
  },
};

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
  const s = alg === "none" ? "" : crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}

type Middleware = (request: unknown) => Promise<Outcome> | Outcome;

/** Compiles the generated file and returns its `middleware` or `proxy` export. */
function loadMiddleware(source: string, exportName: "middleware" | "proxy" = "middleware"): Middleware {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  const requireStub = (id: string): unknown => {
    if (id === "next/server") return nextServer;
    if (id === "jose") return jose;
    throw new Error(`generated middleware imports an unexpected module: ${id}`);
  };
  new Function("require", "module", "exports", outputText)(requireStub, mod, mod.exports);
  return mod.exports[exportName] as Middleware;
}

function request(host: string, headers: Record<string, string> = {}, pathname = "/dashboard"): unknown {
  return { headers: new Headers({ host, ...headers }), nextUrl: { pathname } };
}

let tmp: string;
let cwd: string;
let savedSecret: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-cli-nextjs-"));
  cwd = process.cwd();
  savedSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SECRET;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  process.chdir(cwd);
  vi.restoreAllMocks();
  if (savedSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedSecret;
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Creates a project directory whose package.json declares `next` at the given range. */
function nextProject(name: string, nextRange: string): string {
  const project = path.join(tmp, name);
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(
    path.join(project, "package.json"),
    JSON.stringify({ dependencies: { next: nextRange, pg: "^8" } }),
  );
  return project;
}

/** Writes node_modules/next/package.json, as an install of that version does. */
function installNext(project: string, version: string): void {
  const dir = path.join(project, "node_modules", "next");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "next", version }));
}

async function runInit(project: string, integration: "lib" | "sdk" = "lib", flags: Record<string, string | boolean> = {}) {
  process.chdir(project);
  selectAnswers.length = 0;
  selectAnswers.push(integration === "lib" ? 0 : 1);
  await init(flags);
}

async function initNextjs(integration: "lib" | "sdk", nextRange = "^15"): Promise<string> {
  const project = nextProject(`init-next-${integration}`, nextRange);
  await runInit(project, integration);
  const file = nextRange === "^15" ? "middleware.ts" : "proxy.ts";
  return fs.readFileSync(path.join(project, file), "utf8");
}

async function scaffoldNextjs(): Promise<string> {
  const out = path.join(tmp, "scaffold-next");
  await scaffold(["nextjs"], { out });
  return fs.readFileSync(path.join(out, "middleware.ts"), "utf8");
}

async function scaffoldNextjs16(): Promise<string> {
  const out = nextProject("scaffold-next-16", "^16.3.8");
  await scaffold(["nextjs"], { out });
  return fs.readFileSync(path.join(out, "proxy.ts"), "utf8");
}

const generators: Array<[string, () => Promise<string>, "middleware" | "proxy"]> = [
  ["init (Next.js 15, lib)", () => initNextjs("lib"), "middleware"],
  ["init (Next.js 15, sdk)", () => initNextjs("sdk"), "middleware"],
  ["init (Next.js 16, lib)", () => initNextjs("lib", "^16.3.8"), "proxy"],
  ["init (Next.js 16, sdk)", () => initNextjs("sdk", "^16.3.8"), "proxy"],
  ["scaffold nextjs (version unknown)", scaffoldNextjs, "middleware"],
  ["scaffold nextjs (Next.js 16)", scaffoldNextjs16, "proxy"],
];

for (const [name, generateSource, exportName] of generators) {
  const generate = async () => ({ source: await generateSource(), exportName });
  describe(`${name} ${exportName} takes the tenant only from a verified token`, () => {
    it("refuses a bearer token signed with a key other than JWT_SECRET", async () => {
      const { source, exportName: name } = await generate();
      const middleware = loadMiddleware(source, name);
      const forged = sign({ tenant_id: "victim-tenant" }, "attacker-chosen-secret");
      const res = await middleware(
        request("victim-tenant.app.example.com", { authorization: `Bearer ${forged}` }),
      );
      expect(res.kind).toBe("json");
      expect(res.kind === "json" && res.status).toBe(401);
    });

    it("refuses an unsigned token with alg none", async () => {
      const { source, exportName: name } = await generate();
      const middleware = loadMiddleware(source, name);
      const unsigned = sign({ tenant_id: "victim-tenant" }, "", "none");
      const res = await middleware(
        request("app.example.com", { authorization: `Bearer ${unsigned}` }),
      );
      expect(res.kind === "json" && res.status).toBe(401);
    });

    it("refuses a valid token that has no tenant_id claim", async () => {
      const { source, exportName: name } = await generate();
      const middleware = loadMiddleware(source, name);
      const token = sign({ sub: "user-1" }, SECRET);
      const res = await middleware(request("acme.app.example.com", { authorization: `Bearer ${token}` }));
      expect(res.kind === "json" && res.status).toBe(401);
    });

    it("does not set x-tenant-id from the subdomain the client chose", async () => {
      const { source, exportName: name } = await generate();
      const middleware = loadMiddleware(source, name);
      const res = await middleware(request("victim-tenant.app.example.com"));
      expect(res.kind).toBe("next");
      expect(res.kind === "next" && res.headers.get("x-tenant-id")).toBeNull();
    });

    it("drops an x-tenant-id header the client sent", async () => {
      const { source, exportName: name } = await generate();
      const middleware = loadMiddleware(source, name);
      const res = await middleware(
        request("app.example.com", { "x-tenant-id": "victim-tenant" }),
      );
      expect(res.kind === "next" && res.headers.get("x-tenant-id")).toBeNull();
    });

    it("forwards the tenant_id claim of a valid token, whatever the host or headers say", async () => {
      const { source, exportName: name } = await generate();
      const middleware = loadMiddleware(source, name);
      const token = sign({ tenant_id: "tenant-a" }, SECRET);
      const res = await middleware(
        request("victim-tenant.app.example.com", {
          authorization: `Bearer ${token}`,
          "x-tenant-id": "victim-tenant",
        }),
      );
      expect(res.kind).toBe("next");
      expect(res.kind === "next" && res.headers.get("x-tenant-id")).toBe("tenant-a");
    });
  });
}

describe("init (Next.js) install command", () => {
  it("includes jose, which the generated middleware uses to verify tokens", async () => {
    await initNextjs("lib");
    const logs = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      c.map(String).join(" "),
    );
    const install = logs.find((l) => l.includes("npm install"));
    expect(install).toContain("jose");
  });
});

/** All console.log output so far, one string per call. */
function logged(): string {
  return (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .map((c) => c.map(String).join(" "))
    .join("\n");
}

describe("the Next.js tenant file follows the Next.js version of the project", () => {
  it("init writes proxy.ts with a proxy export when the installed next is 16, whatever package.json declares", async () => {
    const project = nextProject("installed-16", "^15.5.16");
    installNext(project, "16.3.8");
    await runInit(project);
    expect(fs.readFileSync(path.join(project, "proxy.ts"), "utf8")).toContain("export async function proxy(");
    expect(fs.existsSync(path.join(project, "middleware.ts"))).toBe(false);
  });

  it("init writes middleware.ts when the installed next is 15, whatever package.json declares", async () => {
    const project = nextProject("installed-15", "^16.3.8");
    installNext(project, "15.5.16");
    await runInit(project);
    expect(fs.readFileSync(path.join(project, "middleware.ts"), "utf8")).toContain("export async function middleware(");
    expect(fs.existsSync(path.join(project, "proxy.ts"))).toBe(false);
  });

  it("init reads the declared range when next is not installed", async () => {
    const project16 = nextProject("declared-16", "^16.3.8");
    await runInit(project16);
    expect(fs.existsSync(path.join(project16, "proxy.ts"))).toBe(true);
    expect(fs.existsSync(path.join(project16, "middleware.ts"))).toBe(false);

    const project15 = nextProject("declared-15", "~15.5.16");
    await runInit(project15);
    expect(fs.existsSync(path.join(project15, "middleware.ts"))).toBe(true);
    expect(fs.existsSync(path.join(project15, "proxy.ts"))).toBe(false);
  });

  it("init writes middleware.ts and prints the codemod hint when the version is unknown", async () => {
    const project = nextProject("unknown", "latest");
    await runInit(project);
    expect(fs.existsSync(path.join(project, "middleware.ts"))).toBe(true);
    expect(fs.existsSync(path.join(project, "proxy.ts"))).toBe(false);
    expect(logged()).toContain("npx @next/codemod@canary middleware-to-proxy .");
  });

  it("scaffold nextjs writes src/proxy.ts next to src/app on Next.js 16", async () => {
    const out = nextProject("scaffold-src-16", "^16.3.8");
    fs.mkdirSync(path.join(out, "src", "app"), { recursive: true });
    await scaffold(["nextjs"], { out });
    expect(fs.existsSync(path.join(out, "src", "proxy.ts"))).toBe(true);
    expect(fs.existsSync(path.join(out, "proxy.ts"))).toBe(false);
    expect(fs.existsSync(path.join(out, "src", "middleware.ts"))).toBe(false);
  });

  it("does not write proxy.ts next to an existing middleware.ts, even with --force", async () => {
    const project = nextProject("existing-middleware", "^16.3.8");
    fs.writeFileSync(path.join(project, "middleware.ts"), "// the project's own middleware\n");
    await runInit(project, "lib", { force: true });
    await scaffold(["nextjs"], { out: project, force: true });
    expect(fs.existsSync(path.join(project, "proxy.ts"))).toBe(false);
    expect(fs.readFileSync(path.join(project, "middleware.ts"), "utf8")).toBe("// the project's own middleware\n");
    expect(logged()).toContain("Skipped proxy.ts");
  });

  it("does not write middleware.ts next to an existing proxy.ts, even with --force", async () => {
    const project = nextProject("existing-proxy", "^15.5.16");
    fs.mkdirSync(path.join(project, "src", "app"), { recursive: true });
    fs.writeFileSync(path.join(project, "src", "proxy.ts"), "// the project's own proxy\n");
    await runInit(project, "lib", { force: true });
    expect(fs.existsSync(path.join(project, "src", "middleware.ts"))).toBe(false);
    expect(fs.readFileSync(path.join(project, "src", "proxy.ts"), "utf8")).toBe("// the project's own proxy\n");
    expect(logged()).toContain("Skipped middleware.ts");
  });
});
