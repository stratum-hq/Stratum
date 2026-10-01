/**
 * Server-side proxy templates for React front ends.
 *
 * StratumProvider runs in the browser, and anything it is given there is
 * readable by whoever loads the page. So the generated front ends point it at
 * a same-origin proxy route instead of the control plane, and only the proxy,
 * on the server, holds STRATUM_API_KEY. The proxy denies every request until
 * the developer wires authorize() to their own authentication.
 */

/** Next.js App Router route: app/api/stratum/[...path]/route.ts */
export function nextjsProxyRoute(): string {
  return `// app/api/stratum/[...path]/route.ts
// Stratum API route: the server-side link between the browser and the Stratum
// control plane. It is not proxy.ts (middleware.ts before Next.js 16), which
// resolves the tenant.
//
// The control-plane API key stays on the server. Never put it in a
// NEXT_PUBLIC_ variable: those are bundled into the JavaScript every visitor
// downloads. <StratumProvider controlPlaneUrl="/api/stratum"> sends its
// requests here, without a key, and this route adds it.

import { NextRequest, NextResponse } from "next/server";

const CONTROL_PLANE_URL = process.env.STRATUM_URL || "http://localhost:3001";

/**
 * Decide whether the signed-in user may make this control-plane call.
 * Denies everything until you connect it to your authentication and check
 * that the user administers the tenant named in the path.
 */
async function authorize(_request: NextRequest, _path: string[]): Promise<boolean> {
  return false;
}

async function forward(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await params;
  if (path[0] !== "api" || path[1] !== "v1" || path.some((s) => s === "." || s === "..")) {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }
  if (!(await authorize(request, path))) {
    return NextResponse.json({ error: { message: "Forbidden" } }, { status: 403 });
  }
  const apiKey = process.env.STRATUM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: { message: "STRATUM_API_KEY is not set" } }, { status: 500 });
  }

  const target = \`\${CONTROL_PLANE_URL}/\${path.map(encodeURIComponent).join("/")}\${request.nextUrl.search}\`;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(target, {
    method: request.method,
    headers: {
      "X-API-Key": apiKey,
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    },
    body: hasBody ? await request.text() : undefined,
  });

  return new NextResponse(upstream.status === 204 ? null : await upstream.text(), {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
`;
}

/** Express router for a React front end served by (or next to) an Express app. */
export function expressProxy(): string {
  return `// stratum-proxy.ts
// Server-side proxy between the browser and the Stratum control plane.
//
// The control-plane API key stays on the server. Never put it in a
// REACT_APP_, VITE_ or NEXT_PUBLIC_ variable: those are bundled into the
// JavaScript every visitor downloads. Mount this router on your backend and
// point <StratumProvider controlPlaneUrl="/api/stratum"> at it:
//
//   app.use("/api/stratum", stratumProxy);

import express, { type Request, type Response } from "express";

const CONTROL_PLANE_URL = process.env.STRATUM_URL || "http://localhost:3001";

/**
 * Decide whether the signed-in user may make this control-plane call.
 * Denies everything until you connect it to your authentication and check
 * that the user administers the tenant named in the path.
 */
function authorize(_req: Request, _segments: string[]): boolean {
  return false;
}

export const stratumProxy = express.Router();

stratumProxy.use(express.text({ type: "*/*" }));

stratumProxy.use(async (req: Request, res: Response) => {
  let segments: string[];
  try {
    segments = req.path.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
  } catch {
    res.status(400).json({ error: { message: "Bad path" } });
    return;
  }
  if (segments[0] !== "api" || segments[1] !== "v1" || segments.some((s) => s === "." || s === "..")) {
    res.status(404).json({ error: { message: "Not found" } });
    return;
  }
  if (!authorize(req, segments)) {
    res.status(403).json({ error: { message: "Forbidden" } });
    return;
  }
  const apiKey = process.env.STRATUM_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: { message: "STRATUM_API_KEY is not set" } });
    return;
  }

  const queryStart = req.originalUrl.indexOf("?");
  const query = queryStart >= 0 ? req.originalUrl.slice(queryStart) : "";
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const upstream = await fetch(\`\${CONTROL_PLANE_URL}/\${segments.map(encodeURIComponent).join("/")}\${query}\`, {
    method: req.method,
    headers: {
      "X-API-Key": apiKey,
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    },
    body: hasBody && typeof req.body === "string" ? req.body : undefined,
  });

  res
    .status(upstream.status)
    .type(upstream.headers.get("content-type") ?? "application/json")
    .send(upstream.status === 204 ? undefined : await upstream.text());
});
`;
}
