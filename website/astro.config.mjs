import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { stratumPlayground } from "./src/playground/vite-plugin.mjs";
import { bedrockCodeTheme } from "./src/styles/bedrock-code-theme.mjs";

// Site-wide structured data. The Organization @id is the same one that
// stratum-hq.org uses, so search engines join the two sites to one publisher.
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://stratum-hq.org/#organization",
      name: "Stratum HQ",
      url: "https://stratum-hq.org/",
      logo: "https://stratum-hq.org/icon-512.png",
      sameAs: [
        "https://github.com/stratum-hq",
        "https://www.npmjs.com/org/stratum-hq",
        "https://docs.stratum-hq.org/",
      ],
    },
    {
      "@type": "WebSite",
      "@id": "https://docs.stratum-hq.org/#website",
      name: "Stratum Docs",
      url: "https://docs.stratum-hq.org/",
      inLanguage: "en",
      publisher: { "@id": "https://stratum-hq.org/#organization" },
    },
  ],
};

// Stratum type families: Big Shoulders Display, Instrument Sans, Martian Mono.
// Loaded non-blocking from
// the document head rather than via a render-blocking @import in the shared
// token file, so fonts never gate first paint.
const fontsHref =
  "https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800;900&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Martian+Mono:wght@400;500;600&display=swap";

export default defineConfig({
  site: "https://docs.stratum-hq.org",
  vite: {
    plugins: [stratumPlayground()],
    resolve: {
      // The PGlite adapter lives in packages/, so its import of PGlite would
      // otherwise resolve from the repository root instead of this site.
      // package.json pins PGlite 0.4.2: later 0.4.x releases read
      // process.exitCode behind a globalThis.process?.env check, and the
      // Vite client build replaces that check with {}, so they fail in a browser.
      dedupe: ["@electric-sql/pglite"],
    },
    // PGlite loads its WebAssembly relative to its own module, which breaks
    // when the dev server pre-bundles it.
    optimizeDeps: { exclude: ["@electric-sql/pglite"] },
    // The Playground imports the library source and migrations from packages/.
    server: { fs: { allow: [".."] } },
  },
  integrations: [
    starlight({
      title: "Stratum",
      logo: {
        light: "./src/assets/stratum-mark-light.svg",
        dark: "./src/assets/stratum-mark-dark.svg",
        alt: "Stratum",
      },
      favicon: "/favicon.svg?v=bedrock",
      description:
        "Drop-in multi-tenancy for Node.js and TypeScript.",
      customCss: ["./src/styles/custom.css"],
      // Bedrock (dark) is the default for every visitor, whatever the OS
      // preference; Daylight only when chosen in the theme select.
      components: {
        ThemeProvider: "./src/components/ThemeProvider.astro",
        ThemeSelect: "./src/components/ThemeSelect.astro",
        // Adds the marketing site links to the header, ahead of GitHub.
        SocialIcons: "./src/components/SocialIcons.astro",
      },
      // The code well stays dark in both themes, so Expressive Code renders one
      // dark theme, built from the Bedrock code tokens, and takes its frame
      // colors from the shared tokens.
      expressiveCode: {
        themes: [bedrockCodeTheme],
        // A shell block renders as a terminal window by default: an empty title
        // bar with window dots. That chrome carries no information, so shell
        // blocks use the plain code frame. A title still shows as a file tab.
        defaultProps: {
          overridesByLang: {
            "bash,sh,shell,shellscript,zsh,console,powershell": { frame: "code" },
          },
        },
        useStarlightUiThemeColors: false,
        styleOverrides: {
          borderRadius: "0",
          borderColor: "var(--seam)",
          codeBackground: "var(--code-bg)",
          codeFontFamily: "var(--font-mono)",
          codeFontSize: "0.78rem",
          uiFontFamily: "var(--font-body)",
          frames: {
            shadowColor: "transparent",
            editorTabBarBackground: "var(--code-bg)",
            editorActiveTabBackground: "var(--code-bg)",
            editorActiveTabIndicatorTopColor: "var(--magma)",
            terminalTitlebarBackground: "var(--code-bg)",
            terminalBackground: "var(--code-bg)",
            terminalTitlebarDotsForeground: "var(--topsoil)",
          },
          // A marked line is the one thing in the well that glows: magma.
          textMarkers: {
            markBackground: "rgba(255, 91, 31, 0.16)",
            markBorderColor: "var(--magma)",
          },
        },
      },
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/stratum-hq/Stratum" },
      ],
      head: [
        {
          tag: "link",
          attrs: {
            rel: "preconnect",
            href: "https://fonts.googleapis.com",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "preconnect",
            href: "https://fonts.gstatic.com",
            crossorigin: true,
          },
        },
        // Non-blocking font load: preload the stylesheet, then apply it via the
        // media swap so it never blocks first paint. <noscript> keeps fonts for
        // the no-JS case.
        { tag: "link", attrs: { rel: "preload", as: "style", href: fontsHref } },
        {
          tag: "link",
          attrs: {
            rel: "stylesheet",
            href: fontsHref,
            media: "print",
            onload: "this.media='all'",
          },
        },
        {
          tag: "noscript",
          content: `<link rel="stylesheet" href="${fontsHref}">`,
        },
        {
          tag: "script",
          attrs: {
            defer: true,
            "data-domain": "docs.stratum-hq.org",
            src: "https://plausible.io/js/script.js",
          },
        },
        { tag: "link", attrs: { rel: "icon", href: "/favicon.ico?v=bedrock", sizes: "32x32" } },
        { tag: "link", attrs: { rel: "apple-touch-icon", href: "/apple-touch-icon.png?v=bedrock" } },
        { tag: "link", attrs: { rel: "manifest", href: "/site.webmanifest" } },
        { tag: "meta", attrs: { property: "og:image", content: "https://docs.stratum-hq.org/og.png" } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "meta", attrs: { name: "twitter:image", content: "https://docs.stratum-hq.org/og.png" } },
        {
          tag: "script",
          attrs: { type: "application/ld+json" },
          content: JSON.stringify(jsonLd),
        },
      ],
      sidebar: [
        { label: 'Start building', link: '/start/' },
        { label: 'Playground', link: '/playground/' },
        {
          label: "Getting started",
          items: [{ autogenerate: { directory: "getting-started" } }],
        },
        {
          label: "Guides",
          items: [{ autogenerate: { directory: "guides" } }],
        },
        {
          label: "API reference",
          items: [{ autogenerate: { directory: "api" } }],
        },
        {
          label: "Packages",
          items: [{ autogenerate: { directory: "packages" } }],
        },
      ],
    }),
  ],
});
