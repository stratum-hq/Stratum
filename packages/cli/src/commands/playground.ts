/**
 * stratum playground — Start the control plane + demo app locally.
 *
 * Spawns the control plane (port 3001) and demo app (API 3200, web 3300)
 * sequentially. Waits for the control plane to be healthy before starting
 * the demo.
 *
 * Usage:
 *   stratum playground                        # start with defaults
 *   stratum playground --database-url <url>   # custom database URL
 *   stratum playground --cp-port 4000         # custom control plane port
 *
 * ┌─────────────────────────────────────────────────┐
 * │  1. Check DATABASE_URL is set                    │
 * │  2. Test pg connection via connectDb()           │
 * │  3. Spawn control-plane (port 3001)              │
 * │  4. Poll /api/v1/health until ready (10s max)    │
 * │  5. Spawn demo app (API 3200, web 3300)          │
 * │  6. Print "ready" message                        │
 * │                                                   │
 * │  On SIGINT/SIGTERM → kill both children           │
 * │  On child exit → kill other child, exit 1         │
 * └─────────────────────────────────────────────────┘
 */

import { spawn, type ChildProcess } from "child_process";
import { connectDb, getConnectionString } from "../utils/db.js";
import * as log from "../utils/log.js";

const HEALTH_POLL_INTERVAL_MS = 500;
const HEALTH_POLL_TIMEOUT_MS = 10_000;

export async function playground(
  flags: Record<string, string | boolean>
): Promise<void> {
  log.heading("Stratum Playground");

  // Use npm workspaces from the monorepo root (process.cwd())
  const rootDir = process.cwd();

  const cpPort = typeof flags["cp-port"] === "string"
    ? parseInt(flags["cp-port"], 10)
    : 3001;

  // Step 1: Check DATABASE_URL
  const connectionString = getConnectionString(flags);
  if (
    connectionString === "postgres://stratum:stratum_dev@localhost:5432/stratum" &&
    !process.env.DATABASE_URL &&
    !flags["database-url"] &&
    !flags["d"]
  ) {
    log.warn("Using default DATABASE_URL (postgres://localhost:5432/stratum)");
    log.info(
      'Set DATABASE_URL or use --database-url <url> to connect to your database'
    );
  }

  // Step 2: Test pg connection
  log.info("Testing database connection...");
  let pool;
  try {
    pool = await connectDb(flags);
    log.success("Database connection OK");
    await pool.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.fail(`Database connection failed: ${msg}`);
    log.info(
      "Set DATABASE_URL to connect to PostgreSQL. Example: DATABASE_URL=postgres://localhost:5432/stratum"
    );
    process.exit(1);
  }

  const children: ChildProcess[] = [];
  let shuttingDown = false;

  function killAll(signal: NodeJS.Signals = "SIGTERM"): void {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
    }
  }

  function onChildExit(name: string, code: number | null, signal: string | null): void {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `exit code ${code}`;
    log.fail(`${name} exited unexpectedly (${reason})`);
    killAll();
    process.exit(1);
  }

  // Step 3: Spawn control plane
  log.info("Starting control plane...");
  const cpEnv = {
    ...process.env,
    PORT: String(cpPort),
    DATABASE_URL: connectionString,
  };

  const controlPlane = spawn("npm", ["run", "dev", "--workspace=packages/control-plane"], {
    cwd: rootDir,
    env: cpEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(controlPlane);

  controlPlane.on("exit", (code, signal) =>
    onChildExit("Control plane", code, signal)
  );

  // Capture stderr for error reporting
  let cpStderr = "";
  controlPlane.stderr?.on("data", (data: Buffer) => {
    cpStderr += data.toString();
  });

  // Step 4: Poll health endpoint
  log.info(`Waiting for control plane on port ${cpPort}...`);
  const healthUrl = `http://localhost:${cpPort}/api/v1/health`;
  const healthy = await pollHealth(healthUrl, HEALTH_POLL_TIMEOUT_MS, HEALTH_POLL_INTERVAL_MS);

  if (!healthy) {
    log.fail("Control plane failed to become healthy within 10 seconds");
    if (cpStderr) {
      log.info("Control plane stderr:");
      console.error(cpStderr.slice(-500));
    }
    killAll();
    process.exit(1);
  }
  log.success(`Control plane healthy on port ${cpPort}`);

  // Step 5: Spawn demo app
  log.info("Starting demo app...");
  const demoEnv = {
    ...process.env,
    STRATUM_API_URL: `http://localhost:${cpPort}`,
    DATABASE_URL: connectionString,
  };

  const demo = spawn("npm", ["run", "dev", "--workspace=packages/demo"], {
    cwd: rootDir,
    env: demoEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(demo);

  demo.on("exit", (code, signal) => onChildExit("Demo app", code, signal));

  // Give demo a moment to start
  await sleep(2000);

  // Step 6: Print ready message
  console.log();
  log.heading("Stratum Playground Running");
  log.success(`Control plane: http://localhost:${cpPort}`);
  log.success("Demo API:      http://localhost:3200");
  log.success("Demo web:      http://localhost:3300");
  console.log();
  log.dim("Press Ctrl+C to stop");

  // Handle shutdown signals
  process.on("SIGINT", () => {
    console.log();
    log.info("Shutting down...");
    killAll("SIGTERM");
    setTimeout(() => process.exit(0), 1000);
  });

  process.on("SIGTERM", () => {
    log.info("Shutting down...");
    killAll("SIGTERM");
    setTimeout(() => process.exit(0), 1000);
  });

  // Keep the process alive
  await new Promise(() => {});
}

async function pollHealth(
  url: string,
  timeoutMs: number,
  intervalMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // Connection refused — server not ready yet
    }
    await sleep(intervalMs);
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
