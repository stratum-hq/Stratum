import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://docs.stratum-hq.org",
  integrations: [
    starlight({
      title: "Stratum",
      logo: {
        src: "./src/assets/stratumlogonotext.png",
        alt: "Stratum",
      },
      favicon: "/favicon.png",
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
        {
          tag: "script",
          attrs: {
            defer: true,
            "data-domain": "docs.stratum-hq.org",
            src: "https://plausible.io/js/script.js",
          },
        },
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
