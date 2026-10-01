import { expect } from "vitest";

/** Checks the secrets of a generated .env.stratum against the rules of @stratum-hq/lib. */
export function expectEnvSecrets(content: string): void {
  const env = Object.fromEntries(
    content
      .split("\n")
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  expect(Buffer.byteLength(env.STRATUM_ENCRYPTION_KEY ?? "", "utf8")).toBeGreaterThanOrEqual(32);
  expect(env.STRATUM_HKDF_SALT).toMatch(/^(?:[0-9a-f]{2})+$/);
  expect(Buffer.byteLength(env.STRATUM_API_KEY_HMAC_SECRET ?? "", "utf8")).toBeGreaterThanOrEqual(32);
  expect(env.DATABASE_URL).toContain("stratum_app");
  expect(env.DATABASE_ADMIN_URL).toContain("stratum_admin");
  expect(content).toMatch(/outside development and test/);
}
