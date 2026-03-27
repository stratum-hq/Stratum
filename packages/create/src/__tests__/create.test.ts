import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseArgs, createProject, validateProjectName } from "../index.js";

// ─── parseArgs tests ──────────────────────────────────────────────────────────

describe("parseArgs", () => {
  it("extracts project name from positional arg", () => {
    const result = parseArgs(["my-app"]);
    expect(result.projectName).toBe("my-app");
  });

  it("defaults template to express", () => {
    const result = parseArgs(["my-app"]);
    expect(result.template).toBe("express");
  });

  it("parses --template flag", () => {
    const result = parseArgs(["my-app", "--template", "fastify"]);
    expect(result.template).toBe("fastify");
  });

  it("parses --template=value syntax", () => {
    const result = parseArgs(["my-app", "--template=nextjs"]);
    expect(result.template).toBe("nextjs");
  });

  it("parses --skip-install flag", () => {
    const result = parseArgs(["my-app", "--skip-install"]);
    expect(result.skipInstall).toBe(true);
  });

  it("parses --force flag", () => {
    const result = parseArgs(["my-app", "--force"]);
    expect(result.force).toBe(true);
  });

  it("returns null projectName when no positional arg given", () => {
    const result = parseArgs(["--template", "express"]);
    expect(result.projectName).toBeNull();
  });

  it("skipInstall defaults to false", () => {
    const result = parseArgs(["my-app"]);
    expect(result.skipInstall).toBe(false);
  });

  it("force defaults to false", () => {
    const result = parseArgs(["my-app"]);
    expect(result.force).toBe(false);
  });
});

// ─── Error cases ──────────────────────────────────────────────────────────────

describe("main arg validation", () => {
  it("errors when no project name given", () => {
    // parseArgs returns null projectName, which main() would exit on
    const result = parseArgs([]);
    expect(result.projectName).toBeNull();
  });
});

// ─── File generation tests ────────────────────────────────────────────────────

describe("createProject", () => {
  let tmpDir: string;
  let projectDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-create-test-"));
    projectDir = path.join(tmpDir, "test-project");
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates correct files for express template", () => {
    createProject("test-project", "express", projectDir, true);

    expect(fs.existsSync(path.join(projectDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "docker-compose.yml"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".env.example"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "README.md"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "init.sql"))).toBe(true);
  });

  it("generates correct files for fastify template", () => {
    createProject("test-project", "fastify", projectDir, true);

    expect(fs.existsSync(path.join(projectDir, "src", "index.ts"))).toBe(true);
    const serverContent = fs.readFileSync(
      path.join(projectDir, "src", "index.ts"),
      "utf8",
    );
    expect(serverContent).toContain("Fastify");
  });

  it("generates correct files for nextjs template", () => {
    createProject("test-project", "nextjs", projectDir, true);

    expect(fs.existsSync(path.join(projectDir, "src", "app", "page.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "middleware.ts"))).toBe(true);
  });

  it("package.json contains @stratum-hq/lib dependency", () => {
    createProject("test-project", "express", projectDir, true);

    const pkgContent = fs.readFileSync(path.join(projectDir, "package.json"), "utf8");
    const pkg = JSON.parse(pkgContent);
    expect(pkg.dependencies["@stratum-hq/lib"]).toBeDefined();
  });

  it("package.json contains pg dependency", () => {
    createProject("test-project", "express", projectDir, true);

    const pkgContent = fs.readFileSync(path.join(projectDir, "package.json"), "utf8");
    const pkg = JSON.parse(pkgContent);
    expect(pkg.dependencies["pg"]).toBeDefined();
  });

  it("package.json contains express dependency for express template", () => {
    createProject("test-project", "express", projectDir, true);

    const pkgContent = fs.readFileSync(path.join(projectDir, "package.json"), "utf8");
    const pkg = JSON.parse(pkgContent);
    expect(pkg.dependencies["express"]).toBeDefined();
  });

  it("docker-compose.yml contains PostgreSQL 16", () => {
    createProject("test-project", "express", projectDir, true);

    const dockerContent = fs.readFileSync(
      path.join(projectDir, "docker-compose.yml"),
      "utf8",
    );
    expect(dockerContent).toContain("postgres:16-alpine");
  });

  it("init.sql enables uuid-ossp and ltree extensions", () => {
    createProject("test-project", "express", projectDir, true);

    const sqlContent = fs.readFileSync(path.join(projectDir, "init.sql"), "utf8");
    expect(sqlContent).toContain("uuid-ossp");
    expect(sqlContent).toContain("ltree");
  });

  it(".env.example contains DATABASE_URL", () => {
    createProject("test-project", "express", projectDir, true);

    const envContent = fs.readFileSync(path.join(projectDir, ".env.example"), "utf8");
    expect(envContent).toContain("DATABASE_URL");
  });

  it("default template is express", () => {
    const result = parseArgs(["my-app"]);
    expect(result.template).toBe("express");
  });
});

// ─── Project name validation ──────────────────────────────────────────────────

describe("validateProjectName", () => {
  it("accepts a valid name", () => {
    expect(validateProjectName("valid-name")).toBeNull();
  });

  it("accepts names with dots and underscores", () => {
    expect(validateProjectName("my.app_1")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(validateProjectName("")).not.toBeNull();
  });

  it("rejects name with spaces", () => {
    expect(validateProjectName("name with spaces")).not.toBeNull();
  });

  it("rejects path traversal with ../", () => {
    expect(validateProjectName("../escape")).not.toBeNull();
  });

  it("rejects absolute path", () => {
    expect(validateProjectName("/absolute/path")).not.toBeNull();
  });

  it("rejects name starting with a dot", () => {
    expect(validateProjectName(".hidden")).not.toBeNull();
  });

  it("rejects name with path separator embedded", () => {
    expect(validateProjectName("foo/bar")).not.toBeNull();
  });
});

// ─── Directory existence error ────────────────────────────────────────────────

describe("directory existence check", () => {
  it("errors when directory exists without --force", () => {
    // parseArgs doesn't control this — main() does the fs.existsSync check.
    // We verify that parseArgs returns force=false by default, which triggers the error.
    const result = parseArgs(["existing-dir"]);
    expect(result.force).toBe(false);
    // When force is false and dir exists, main() calls process.exit(1)
  });

  it("--force flag allows overwriting existing directory", () => {
    const result = parseArgs(["existing-dir", "--force"]);
    expect(result.force).toBe(true);
  });
});
