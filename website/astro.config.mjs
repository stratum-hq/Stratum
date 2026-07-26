import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Core Sample type families (documented in DESIGN.md). Loaded non-blocking from
// the document head rather than via a render-blocking @import in the shared
// token file, so fonts never gate first paint.
const fontsHref =
  "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@125,600;125,700;125,800&family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap";

export default defineConfig({
  site: "https://docs.stratum-hq.org",
  integrations: [
    starlight({
      title: "Stratum",
      logo: {
        light: "./src/assets/stratum-mark-light.svg",
        dark: "./src/assets/stratum-mark-dark.svg",
        alt: "Stratum",
      },
      favicon: "/favicon.svg",
      description:
        "Drop-in multi-tenancy for Node.js and TypeScript.",
      customCss: ["./src/styles/custom.css"],
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
        { tag: "link", attrs: { rel: "icon", href: "/favicon.ico", sizes: "32x32" } },
        { tag: "link", attrs: { rel: "apple-touch-icon", href: "/apple-touch-icon.png" } },
        { tag: "link", attrs: { rel: "manifest", href: "/site.webmanifest" } },
        { tag: "meta", attrs: { property: "og:image", content: "https://docs.stratum-hq.org/og.png" } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "meta", attrs: { name: "twitter:image", content: "https://docs.stratum-hq.org/og.png" } },
      ],
      sidebar: [
        { label: 'stratum-hq.org', link: 'https://stratum-hq.org', attrs: { target: '_blank' } },
        { label: 'Start Building', link: '/start/' },
        { label: 'Playground', link: '/playground/' },
        {
          label: "Getting Started",
          items: [{ autogenerate: { directory: "getting-started" } }],
        },
        {
          label: "Guides",
          items: [{ autogenerate: { directory: "guides" } }],
        },
        {
          label: "API Reference",
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
