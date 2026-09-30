import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const readme = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "README.md"),
  "utf8",
);

describe("README", () => {
  it("documents assertIsolation with its real positional signature", () => {
    expect(readme).not.toMatch(/assertIsolation\(\{/);
    expect(readme).toMatch(/assertIsolation\(pool, tenantAId, tenantBId, "orders"\)/);
  });

  it("documents assertConfigInheritance with its real signature", () => {
    expect(readme).not.toMatch(/assertConfigInheritance\(options\)/);
    expect(readme).toContain("assertConfigInheritance(stratum, parentId, childId, key)");
  });
});
