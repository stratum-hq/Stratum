import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// npm installs a bin as a symlink in node_modules/.bin. Node then sees the
// symlink path in process.argv[1], not the real path of the built file.
// Windows uses .cmd shims instead of symlinks, so the test does not apply there.
describe.skipIf(process.platform === "win32")("create-stratum bin", () => {
  let tmpDir: string;
  let linkPath: string;

  beforeAll(() => {
    // Build first, so that the test runs the current source and not a stale dist.
    execSync("npm run build", { cwd: packageDir, stdio: "ignore" });

    const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf-8"));
    const binTarget = path.resolve(packageDir, pkg.bin["create-stratum"]);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-bin-test-"));
    const binDir = path.join(tmpDir, "node_modules", ".bin");
    fs.mkdirSync(binDir, { recursive: true });
    linkPath = path.join(binDir, "create-stratum");
    fs.symlinkSync(binTarget, linkPath);
  }, 60_000);

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("prints usage and exits 1 when run through a symlink without a project name", () => {
    const result = spawnSync(process.execPath, [linkPath], { cwd: tmpDir, encoding: "utf-8" });

    expect(result.stdout).toContain("Usage: create-stratum <project-name> [options]");
    expect(result.status).toBe(1);
  });

  it.each(["not-a-preset", "mongodb-rls-mongoose-express"])(
    "exits 1 on the invalid preset %s without creating the project directory",
    (preset) => {
      const result = spawnSync(process.execPath, [linkPath, "bad-preset-app", "--preset", preset, "--skip-install"], {
        cwd: tmpDir,
        encoding: "utf-8",
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Invalid preset");
      expect(fs.existsSync(path.join(tmpDir, "bad-preset-app"))).toBe(false);
    },
  );

  it("keeps an existing directory when --force comes with an invalid preset", () => {
    const existing = path.join(tmpDir, "existing-app");
    fs.mkdirSync(existing);
    fs.writeFileSync(path.join(existing, "keep.txt"), "keep");

    const result = spawnSync(
      process.execPath,
      [linkPath, "existing-app", "--preset", "not-a-preset", "--force", "--skip-install"],
      { cwd: tmpDir, encoding: "utf-8" },
    );

    expect(result.status).toBe(1);
    expect(fs.readFileSync(path.join(existing, "keep.txt"), "utf8")).toBe("keep");
  });
});
