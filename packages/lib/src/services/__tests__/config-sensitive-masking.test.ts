import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../pool-helpers.js", () => ({
  withClient: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock("../../crypto.js", () => ({
  encrypt: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
  decrypt: vi.fn((encrypted: string) => encrypted.slice("encrypted:".length)),
}));

import * as poolHelpers from "../../pool-helpers.js";
import * as crypto from "../../crypto.js";
import * as configService from "../config-service.js";
import { makeMockPool } from "./test-helpers.js";

/**
 * A sensitive config value set on a parent is inherited by its descendants for
 * trusted server-side use, but a read of a descendant's config returns it
 * masked unless the caller asks to reveal it.
 */

const PARENT = "parent-id";
const CHILD = "child-id";

function sensitiveRow(tenantId: string, key: string, plain: unknown, locked = false) {
  return {
    tenant_id: tenantId,
    key,
    value: `encrypted:${JSON.stringify(plain)}`,
    locked,
    sensitive: true,
    source_tenant_id: tenantId,
  };
}

function plainRow(tenantId: string, key: string, value: unknown) {
  return { tenant_id: tenantId, key, value, locked: false, sensitive: false, source_tenant_id: tenantId };
}

function mockEntries(rows: unknown[]) {
  const query = vi.fn();
  query.mockResolvedValueOnce({ rows: [{ ancestry_path: `/${PARENT}` }] });
  query.mockResolvedValueOnce({ rows });
  vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) =>
    fn({ query } as unknown as import("pg").PoolClient),
  );
}

const ROWS = [
  sensitiveRow(PARENT, "api_secret", "parent-secret"),
  sensitiveRow(PARENT, "locked_secret", "locked-value", true),
  plainRow(PARENT, "max_users", 100),
  sensitiveRow(CHILD, "own_secret", "child-secret"),
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each([
  ["resolveConfig", configService.resolveConfig],
  ["getConfigWithInheritance", configService.getConfigWithInheritance],
] as const)("%s sensitive masking", (_name, resolve) => {
  it("masks a sensitive value inherited from an ancestor by default", async () => {
    mockEntries(ROWS);

    const result = await resolve(makeMockPool(), CHILD);

    expect(result.api_secret).toEqual({
      key: "api_secret",
      value: null,
      source_tenant_id: PARENT,
      inherited: true,
      locked: false,
      sensitive: true,
      masked: true,
    });
    expect(JSON.stringify(result)).not.toContain("parent-secret");
  });

  it("masks a locked sensitive value inherited from an ancestor by default", async () => {
    mockEntries(ROWS);

    const result = await resolve(makeMockPool(), CHILD);

    expect(result.locked_secret.value).toBeNull();
    expect(result.locked_secret.masked).toBe(true);
    expect(result.locked_secret.locked).toBe(true);
    expect(JSON.stringify(result)).not.toContain("locked-value");
  });

  it("does not decrypt a masked value", async () => {
    mockEntries(ROWS);

    await resolve(makeMockPool(), CHILD);

    const decrypted = vi.mocked(crypto.decrypt).mock.calls.map(([v]) => v);
    expect(decrypted).toEqual([`encrypted:${JSON.stringify("child-secret")}`]);
  });

  it("returns the tenant's own sensitive value decrypted and flagged sensitive", async () => {
    mockEntries(ROWS);

    const result = await resolve(makeMockPool(), CHILD);

    expect(result.own_secret.value).toBe("child-secret");
    expect(result.own_secret.sensitive).toBe(true);
    expect(result.own_secret.masked).toBeUndefined();
  });

  it("leaves non-sensitive inherited values unchanged", async () => {
    mockEntries(ROWS);

    const result = await resolve(makeMockPool(), CHILD);

    expect(result.max_users).toEqual({
      key: "max_users",
      value: 100,
      source_tenant_id: PARENT,
      inherited: true,
      locked: false,
    });
  });

  it("reveals inherited sensitive values when revealSensitive is true", async () => {
    mockEntries(ROWS);

    const result = await resolve(makeMockPool(), CHILD, { revealSensitive: true });

    expect(result.api_secret.value).toBe("parent-secret");
    expect(result.api_secret.sensitive).toBe(true);
    expect(result.api_secret.masked).toBeUndefined();
    expect(result.locked_secret.value).toBe("locked-value");
  });

  it("reveals an inherited sensitive value to the tenant that set it", async () => {
    mockEntries(ROWS);

    const result = await resolve(makeMockPool(), CHILD, { viewerTenantId: PARENT });

    expect(result.api_secret.value).toBe("parent-secret");
    expect(result.api_secret.masked).toBeUndefined();
  });

  it("keeps an inherited sensitive value masked for a viewer that did not set it", async () => {
    mockEntries(ROWS);

    const result = await resolve(makeMockPool(), CHILD, { viewerTenantId: CHILD });

    expect(result.api_secret.value).toBeNull();
    expect(result.api_secret.masked).toBe(true);
  });
});
