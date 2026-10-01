import { describe, it, expect, vi, afterEach } from "vitest";

/** The server's startup output names each step once. */
vi.mock("@stratum-hq/lib", () => ({ migrate: vi.fn(async () => {}) }));
vi.mock("../db/connection.js", () => ({
  getPool: () => ({}),
  getAdminPool: () => undefined,
  closePool: async () => {},
}));
const listen = vi.hoisted(() => vi.fn(async () => "http://0.0.0.0:3001"));
vi.mock("../app.js", () => ({ buildApp: async () => ({ listen, close: async () => {} }) }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("control-plane startup", () => {
  it('prints "Running migrations..." once', async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const before = { SIGTERM: process.listeners("SIGTERM"), SIGINT: process.listeners("SIGINT") };
    try {
      await import("../index.js");
      await vi.waitFor(() => expect(listen).toHaveBeenCalled());
      const lines = log.mock.calls.map((call) => String(call[0]));
      expect(lines.filter((line) => line === "Running migrations...")).toHaveLength(1);
      expect(lines.filter((line) => line === "Migrations complete.")).toHaveLength(1);
    } finally {
      for (const signal of ["SIGTERM", "SIGINT"] as const) {
        for (const listener of process.listeners(signal)) {
          if (!before[signal].includes(listener)) process.removeListener(signal, listener);
        }
      }
    }
  });
});
