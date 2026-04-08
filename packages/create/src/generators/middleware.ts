import type { StackPreset } from "../matrix.js";

export interface MiddlewareFile {
  filename: string;
  content: string;
}

export function generateMiddleware(projectName: string, preset: StackPreset): MiddlewareFile[] {
  switch (preset.framework) {
    case "express":
      return generateExpressMiddleware(projectName);
    case "fastify":
      return generateFastifyMiddleware(projectName);
    case "nextjs":
      return generateNextjsMiddleware(projectName);
    case "hono":
      return generateHonoMiddleware(projectName);
    case "nestjs":
      return generateNestjsMiddleware(projectName);
    case "none":
      return generateNoFramework(projectName);
  }
}

function generateExpressMiddleware(projectName: string): MiddlewareFile[] {
  return [
    {
      filename: "src/index.ts",
      content: `import express from "express";

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json());

// Tenant extraction middleware
app.use((req, _res, next) => {
  const tenantId =
    req.headers["x-tenant-id"] as string ||
    req.hostname.split(".")[0];
  (req as any).tenantId = tenantId;
  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", project: "${projectName}" });
});

app.get("/tenants", async (req, res) => {
  const tenantId = (req as any).tenantId;
  res.json({ tenantId, message: "Replace with your tenant queries" });
});

app.listen(port, () => {
  console.log(\`${projectName} running on http://localhost:\${port}\`);
});
`,
    },
  ];
}

function generateFastifyMiddleware(projectName: string): MiddlewareFile[] {
  return [
    {
      filename: "src/index.ts",
      content: `import Fastify from "fastify";

const fastify = Fastify({ logger: true });
const port = Number(process.env.PORT) || 3000;

// Tenant extraction plugin
fastify.decorateRequest("tenantId", "");
fastify.addHook("onRequest", async (request) => {
  const tenantId =
    (request.headers["x-tenant-id"] as string) ||
    (request.hostname?.split(".")[0] ?? "");
  (request as any).tenantId = tenantId;
});

fastify.get("/health", async () => {
  return { status: "ok", project: "${projectName}" };
});

fastify.get("/tenants", async (request) => {
  const tenantId = (request as any).tenantId;
  return { tenantId, message: "Replace with your tenant queries" };
});

fastify.listen({ port, host: "0.0.0.0" }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
});
`,
    },
  ];
}

function generateNextjsMiddleware(projectName: string): MiddlewareFile[] {
  return [
    {
      filename: "middleware.ts",
      content: `// Next.js edge middleware for tenant resolution
import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") || "";
  const subdomain = hostname.split(".")[0];
  const headerTenantId = request.headers.get("x-tenant-id");
  const pathTenantId = request.nextUrl.pathname.match(/^\\/tenant\\/([^/]+)/)?.[1];

  const tenantId = headerTenantId || pathTenantId || subdomain;

  const requestHeaders = new Headers(request.headers);
  if (tenantId && tenantId !== "localhost" && tenantId !== "www") {
    requestHeaders.set("x-tenant-id", tenantId);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
`,
    },
    {
      filename: "src/app/page.tsx",
      content: `// app/page.tsx - ${projectName} root page
export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>${projectName}</h1>
      <p>Multi-tenant app powered by Stratum.</p>
      <ul>
        <li>Configure tenants via the Stratum control plane</li>
        <li>Access tenant context via <code>x-tenant-id</code> header</li>
        <li>Use <code>@stratum-hq/lib</code> for tenant resolution</li>
      </ul>
    </main>
  );
}
`,
    },
  ];
}

function generateHonoMiddleware(projectName: string): MiddlewareFile[] {
  return [
    {
      filename: "src/index.ts",
      content: `import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();

// Tenant extraction middleware
app.use("*", async (c, next) => {
  const tenantId =
    c.req.header("x-tenant-id") ||
    new URL(c.req.url).hostname.split(".")[0];
  c.set("tenantId", tenantId);
  await next();
});

app.get("/health", (c) => {
  return c.json({ status: "ok", project: "${projectName}" });
});

app.get("/tenants", (c) => {
  const tenantId = c.get("tenantId");
  return c.json({ tenantId, message: "Replace with your tenant queries" });
});

const port = Number(process.env.PORT) || 3000;
console.log(\`${projectName} running on http://localhost:\${port}\`);
serve({ fetch: app.fetch, port });
`,
    },
  ];
}

function generateNestjsMiddleware(projectName: string): MiddlewareFile[] {
  return [
    {
      filename: "src/main.ts",
      content: `import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  console.log(\`${projectName} running on http://localhost:\${port}\`);
}
bootstrap();
`,
    },
    {
      filename: "src/app.module.ts",
      content: `import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { TenantGuard } from "./tenant.guard.js";
import { APP_GUARD } from "@nestjs/core";

@Module({
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: TenantGuard },
  ],
})
export class AppModule {}
`,
    },
    {
      filename: "src/app.controller.ts",
      content: `import { Controller, Get, Req } from "@nestjs/common";

@Controller()
export class AppController {
  @Get("health")
  health() {
    return { status: "ok", project: "${projectName}" };
  }

  @Get("tenants")
  tenants(@Req() req: any) {
    return { tenantId: req.tenantId, message: "Replace with your tenant queries" };
  }
}
`,
    },
    {
      filename: "src/tenant.guard.ts",
      content: `import { Injectable, CanActivate, ExecutionContext } from "@nestjs/common";

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const tenantId =
      request.headers["x-tenant-id"] ||
      request.hostname?.split(".")[0];
    request.tenantId = tenantId || null;
    return true;
  }
}
`,
    },
  ];
}

function generateNoFramework(projectName: string): MiddlewareFile[] {
  return [
    {
      filename: "src/index.ts",
      content: `// ${projectName} - Stratum multi-tenant setup (no framework)
// Use this as a starting point and integrate with your framework of choice.

console.log("${projectName} initialized");
console.log("Import your database setup from ./stratum-db or equivalent");
console.log("Add tenant resolution logic for your use case");
`,
    },
  ];
}
