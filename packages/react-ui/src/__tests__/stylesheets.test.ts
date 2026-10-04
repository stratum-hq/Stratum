import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// These tests read the shipped stylesheets as text. The package ships them into
// other people's pages, so the contract is about what the files contain.

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const stylesDir = join(pkgDir, "src", "styles");
const componentsDir = join(pkgDir, "src", "components");

function read(file: string): string {
  return readFileSync(join(stylesDir, file), "utf8");
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

interface Rule {
  prelude: string;
  /** At-rule preludes that enclose this rule, outermost first. */
  ancestors: string[];
}

/** Returns every block in the stylesheet with the at-rules that enclose it. */
function blocks(css: string): Rule[] {
  const text = stripComments(css);
  const out: Rule[] = [];
  const stack: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      const prelude = text.slice(start, i).trim();
      out.push({ prelude, ancestors: [...stack] });
      stack.push(prelude);
      start = i + 1;
    } else if (ch === "}") {
      stack.pop();
      start = i + 1;
    } else if (ch === ";") {
      start = i + 1;
    }
  }
  return out;
}

/** Returns the statements at the top level of the stylesheet. */
function topLevelStatements(css: string): string[] {
  const text = stripComments(css);
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      if (depth === 0) out.push(text.slice(start, i).trim());
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) start = i + 1;
    } else if (ch === ";" && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  return out.filter(Boolean);
}

/** Splits a selector list on the commas that are not inside parentheses. */
function splitSelectors(prelude: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < prelude.length; i++) {
    const ch = prelude[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(prelude.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(prelude.slice(start).trim());
  return out;
}

function styleRules(css: string): Rule[] {
  return blocks(css).filter(
    (b) => !b.prelude.startsWith("@") && !/^(\d+%|from|to)(\s*,\s*(\d+%|from|to))*$/.test(b.prelude),
  );
}

function customPropertiesDeclared(css: string): string[] {
  return Array.from(stripComments(css).matchAll(/(?:^|[;{\s])(--[A-Za-z0-9_-]+)\s*:/g), (m) => m[1]);
}

const scopedSheets = ["base.css", "theme-bedrock.css"];

describe.each(scopedSheets)("%s", (file) => {
  const css = read(file);

  it("puts every rule inside the stratum cascade layer", () => {
    for (const statement of topLevelStatements(css)) {
      expect(statement).toMatch(/^@layer stratum(\.[a-z]+)?(\s*,\s*stratum(\.[a-z]+)?)*$/);
    }
  });

  it("declares only custom properties with the --stratum- prefix", () => {
    const declared = customPropertiesDeclared(css);
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((name) => !name.startsWith("--stratum-"))).toEqual([]);
  });

  it("reads only custom properties with the --stratum- prefix", () => {
    const used = Array.from(stripComments(css).matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g), (m) => m[1]);
    expect(used.filter((name) => !name.startsWith("--stratum-"))).toEqual([]);
  });

  it("scopes every selector to a stratum element", () => {
    const unscoped: string[] = [];
    for (const rule of styleRules(css)) {
      for (const selector of splitSelectors(rule.prelude)) {
        if (!selector.includes("stratum-") || /:root|(^|[\s>+~(])(html|body)\b|^\*/.test(selector)) {
          unscoped.push(selector);
        }
      }
    }
    expect(unscoped).toEqual([]);
  });

  it("makes no third-party request", () => {
    expect(stripComments(css)).not.toMatch(/@import/);
    expect(stripComments(css)).not.toMatch(/url\(\s*["']?(https?:)?\/\//);
  });
});

describe("base.css", () => {
  const css = read("base.css");

  // A table that no rule names renders with the browser's centered headers.
  it.each([".stratum-webhook-editor__table", ".stratum-audit-viewer__table"])(
    "styles %s, its headers and its cells like the other editor tables",
    (table) => {
      const selectors = blocks(css).flatMap((b) => b.prelude.split(",").map((s) => s.trim()));
      for (const part of ["", " th", " td"]) expect(selectors).toContain(table + part);
    },
  );

  it("follows prefers-color-scheme when no data-theme is set", () => {
    const text = stripComments(css);
    const at = text.search(/@media \(prefers-color-scheme:\s*dark\)/);
    expect(at).toBeGreaterThan(-1);
    let depth = 0;
    let end = at;
    for (let i = text.indexOf("{", at); i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    const body = text.slice(at, end);
    expect(body).toMatch(/--stratum-surface-0\s*:/);
    // The dark scheme must skip any element under an explicit light theme.
    expect(body).toMatch(/:not\([^{]*\[data-theme="light"\]/);
  });

  it("gives an explicit data-theme of light or dark its own token block", () => {
    const themed = styleRules(css).filter((r) => r.ancestors.every((a) => !a.startsWith("@media")));
    expect(themed.some((r) => r.prelude.includes('[data-theme="light"]'))).toBe(true);
    expect(themed.some((r) => r.prelude.includes('[data-theme="dark"]'))).toBe(true);
  });

  it("limits the reduced-motion rule to stratum elements", () => {
    const reduced = styleRules(css).filter((r) => r.ancestors.some((a) => a.includes("prefers-reduced-motion")));
    expect(reduced.length).toBeGreaterThan(0);
    for (const rule of reduced) {
      for (const selector of splitSelectors(rule.prelude)) expect(selector).toContain("stratum-");
    }
  });

  it("does not name a Bedrock font", () => {
    expect(css).not.toMatch(/Big Shoulders|Instrument Sans|Martian Mono/);
  });
});

describe("theme-bedrock.css", () => {
  // Bedrock spends magma on the primary action and on LOCKED only. A selected
  // row is the current location, so it takes vein.
  it.each([".stratum-tree__node--selected", ".stratum-tenant-switcher__item--active"])(
    "marks %s without magma",
    (selector) => {
      const text = stripComments(read("theme-bedrock.css"));
      const bodies = [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter((m) => m[1].split(",").some((s) => s.trim().startsWith(selector)))
        .map((m) => m[2]);
      expect(bodies.length).toBeGreaterThan(0);
      for (const body of bodies) expect(body).not.toMatch(/--stratum-accent/);
    },
  );

  // State rides a tint, a raised face, or the selected tree row's vein bar, never an inset shadow.
  it("draws no start-edge stripe with an inset box-shadow", () => {
    const text = stripComments(read("theme-bedrock.css"));
    expect(text).not.toMatch(/inset\s+[1-9]\d*px\s+0\s+0/);
  });

  it("sorts after the base layer whatever the import order", () => {
    const first = topLevelStatements(read("theme-bedrock.css"))[0];
    expect(first).toBe("@layer stratum.base, stratum.theme");
    expect(topLevelStatements(read("base.css"))[0]).toBe("@layer stratum.base, stratum.theme");
  });
});

describe("fonts.css", () => {
  it("holds the only font request of the package", () => {
    const css = stripComments(read("fonts.css"));
    expect(css).toMatch(/Big\+Shoulders\+Display/);
    for (const file of readdirSync(stylesDir).filter((f) => f !== "fonts.css")) {
      expect(stripComments(read(file))).not.toMatch(/fonts\.googleapis|@font-face/);
    }
  });
});

describe("package exports", () => {
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as {
    exports: Record<string, unknown>;
    scripts: Record<string, string>;
  };

  it("maps every style subpath to a stylesheet that the build copies into dist", () => {
    expect(pkg.scripts.postbuild).toContain("src/styles dist/styles");
    const styleTargets = Object.entries(pkg.exports).filter(([key]) => key.startsWith("./styles"));
    expect(Object.fromEntries(styleTargets)).toEqual({
      "./styles": "./dist/styles/base.css",
      "./styles/base.css": "./dist/styles/base.css",
      "./styles/theme-bedrock.css": "./dist/styles/theme-bedrock.css",
      "./styles/fonts.css": "./dist/styles/fonts.css",
    });
    for (const [, target] of styleTargets) {
      const source = (target as string).replace("./dist/styles/", "");
      expect(existsSync(join(stylesDir, source))).toBe(true);
    }
  });
});

describe("component sources", () => {
  const sources = readdirSync(componentsDir, { recursive: true })
    .map(String)
    .filter((f) => /\.tsx?$/.test(f));

  it("read only --stratum- custom properties", () => {
    const offenders: string[] = [];
    for (const file of sources) {
      const text = readFileSync(join(componentsDir, file), "utf8");
      for (const m of text.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
        if (!m[1].startsWith("--stratum-")) offenders.push(`${file}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
