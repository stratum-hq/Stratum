import { describe, it, expect } from "vitest";
import { generateDbSetup } from "../generators/db-setup.js";
import { generatePresetPackageJson } from "../generators/package-json.js";
import { generatePresetReadme } from "../generators/readme.js";
import { VALID_COMBINATIONS, formatPresetString, ormsFor, type StackPreset } from "../matrix.js";

// The Prisma presets generate Prisma 7 projects. Prisma 7 removed the
// datasource URL from the schema and the `datasources` client option, and
// ignores a `schema` parameter in the connection URL. A schema or database
// preset that makes its tenant clients without a driver adapter therefore
// sends every tenant to the same schema.

const prismaPresets: StackPreset[] = [];
for (const strategy of VALID_COMBINATIONS.postgres.strategies) {
  if (!ormsFor("postgres", strategy).includes("prisma")) continue;
  for (const framework of VALID_COMBINATIONS.postgres.frameworks) {
    prismaPresets.push({ database: "postgres", strategy, orm: "prisma", framework });
  }
}
const isolated = prismaPresets.filter((p) => p.strategy !== "rls");
const names = (presets: StackPreset[]) => presets.map(formatPresetString);
const byName = (name: string) => prismaPresets.find((p) => formatPresetString(p) === name)!;

function files(preset: StackPreset): Map<string, string> {
  return new Map(generateDbSetup(preset).map((f) => [f.filename, f.content]));
}

describe("Prisma presets", () => {
  it("cover the rls, schema and database strategies", () => {
    expect(new Set(prismaPresets.map((p) => p.strategy))).toEqual(new Set(["rls", "schema", "database"]));
  });

  it.each(names(isolated))("%s gives every tenant adapter the PrismaPg driver adapter", (name) => {
    const helper = files(byName(name)).get("src/stratum-prisma.ts")!;
    const calls = helper.match(/new (?:Schema|Database)PrismaAdapter\([^;]*\);/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toContain("{ driverAdapter: PrismaPg }");
    expect(helper).toContain('import { PrismaPg } from "@prisma/adapter-pg";');
  });

  it.each(names(prismaPresets.filter((p) => p.strategy === "rls")))(
    "%s connects its base client through the PrismaPg driver adapter",
    (name) => {
      const helper = files(byName(name)).get("src/stratum-prisma.ts")!;
      expect(helper).toContain("new PrismaClient({ adapter: new PrismaPg(");
      expect(helper).toContain("prismaWithTenant(prisma, getTenantId, pool)");
    },
  );

  it.each(names(prismaPresets))("%s imports the client that prisma generate writes to src/generated/prisma", (name) => {
    const helper = files(byName(name)).get("src/stratum-prisma.ts")!;
    expect(helper).toContain('import { PrismaClient } from "./generated/prisma/client.js";');
    expect(helper).not.toContain("@prisma/client");
  });

  it.each(names(prismaPresets))("%s uses the prisma-client generator and keeps the URL out of the schema", (name) => {
    const schema = files(byName(name)).get("prisma/schema.prisma")!;
    expect(schema).toContain('provider = "prisma-client"');
    expect(schema).toContain('output   = "../src/generated/prisma"');
    expect(schema).not.toMatch(/^\s*url\s*=/m);
    expect(schema).not.toContain("previewFeatures");
  });

  it.each(names(prismaPresets))("%s reads the connection URL from DATABASE_URL in prisma.config.ts", (name) => {
    const config = files(byName(name)).get("prisma.config.ts")!;
    expect(config).toContain('import { defineConfig } from "prisma/config";');
    expect(config).toContain('schema: "prisma/schema.prisma"');
    // prisma generate runs without a database, so an unset variable must not throw.
    expect(config).toContain("url: process.env.DATABASE_URL");
    expect(config).not.toContain('env("DATABASE_URL")');
  });

  it.each(names(prismaPresets))("%s runs prisma db push without the --skip-generate option of Prisma 6", (name) => {
    const preset = byName(name);
    const all = [...files(preset).values(), generatePresetReadme("app", preset)].join("\n");
    expect(all).toMatch(/\["prisma", "db", "push"\]|prisma db push/);
    expect(all).not.toContain("--skip-generate");
  });

  it.each(names(prismaPresets))("%s depends on Prisma 7 and the PrismaPg driver adapter", (name) => {
    const pkg = JSON.parse(generatePresetPackageJson("app", byName(name))) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      engines: { node: string };
      overrides?: Record<string, string>;
    };
    expect(pkg.dependencies["@prisma/client"]).toBe("^7.10.0");
    expect(pkg.dependencies["@prisma/adapter-pg"]).toBe("^7.10.0");
    expect(pkg.devDependencies["prisma"]).toBe("^7.10.0");
    expect(pkg.devDependencies["typescript"]).toBe("^5.4.0");
    expect(pkg.engines.node).toBe("^20.19.0 || ^22.12.0 || >=24.0.0");
    expect(pkg.overrides).toEqual({ mysql2: "^3.23.1", "deepmerge-ts": "^8.0.2" });
  });

  it.each(names(prismaPresets))("%s README names prisma.config.ts as the place of the connection URL", (name) => {
    expect(generatePresetReadme("app", byName(name))).toContain("prisma.config.ts");
  });
});
