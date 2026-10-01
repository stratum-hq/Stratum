// The link check reads built HTML. These tests build two small sites on disk
// and check that it finds broken links, slashless links, and cross-site links.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkSites } from "../check-site-links.mjs";

let work;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "check-site-links-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function page(site, path, body) {
  const file = join(work, site, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `<html><head></head><body>${body}</body></html>`);
}

const sites = () => [
  { dir: join(work, "a"), origin: "https://a.example" },
  { dir: join(work, "b"), origin: "https://b.example" },
];

describe("checkSites", () => {
  it("accepts links that a built page or file answers", () => {
    page("a", "index.html", '<a href="/blog/">Blog</a><img src="/logo.png">');
    page("a", "blog/index.html", '<a href="../">Home</a>');
    writeFileSync(join(work, "a", "logo.png"), "");
    page("b", "index.html", "");

    expect(checkSites(sites())).toEqual({ checked: 3, problems: [] });
  });

  it("reports a slashless link to a directory page as a redirect", () => {
    page("a", "index.html", '<a href="/blog">Blog</a>');
    page("a", "blog/index.html", "");
    page("b", "index.html", "");

    expect(checkSites(sites()).problems).toEqual([
      { kind: "redirect", page: "https://a.example/", href: "/blog" },
    ]);
  });

  it("checks a link to the other site against that site's build", () => {
    page("a", "index.html", '<a href="https://b.example/guide/">Guide</a>');
    page("b", "index.html", "");

    expect(checkSites(sites()).problems).toEqual([
      { kind: "broken", page: "https://a.example/", href: "https://b.example/guide/" },
    ]);
  });

  it("ignores external links, fragments, and mail links", () => {
    page("a", "index.html", '<a href="https://c.example/x">x</a><a href="#top">top</a><a href="mailto:a@a.example">m</a>');
    page("b", "index.html", "");

    expect(checkSites(sites())).toEqual({ checked: 0, problems: [] });
  });

  it("ignores the canonical link of a 404 page only", () => {
    page("a", "404.html", '<link rel="canonical" href="https://a.example/404/">');
    page("a", "index.html", '<link rel="canonical" href="https://a.example/gone/">');
    page("b", "index.html", "");

    expect(checkSites(sites()).problems).toEqual([
      { kind: "broken", page: "https://a.example/", href: "https://a.example/gone/" },
    ]);
  });
});
