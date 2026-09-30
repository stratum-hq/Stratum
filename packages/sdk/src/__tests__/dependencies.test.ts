import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = join(__dirname, "..", "..");
const srcRoot = join(packageRoot, "src");

// Only shipped source counts. A test-only import does not justify a runtime dependency.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("package dependencies", () => {
  it("imports every runtime dependency somewhere in src", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    const source = sourceFiles(srcRoot)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    const unused = Object.keys(pkg.dependencies ?? {}).filter(
      (name) => !source.includes(`"${name}"`) && !source.includes(`"${name}/`),
    );

    expect(unused).toEqual([]);
  });
});
