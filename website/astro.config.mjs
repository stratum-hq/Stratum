import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
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
      social: {
        github: "https://github.com/stratum-hq/stratum",
      },
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
        { label: 'Start Building', link: '/start/' },
        { label: 'Playground', link: '/playground/' },
        {
          label: "Getting Started",
          autogenerate: { directory: "getting-started" },
        },
        {
          label: "Guides",
          autogenerate: { directory: "guides" },
        },
        {
          label: "API Reference",
          autogenerate: { directory: "api" },
        },
        {
          label: "Packages",
          autogenerate: { directory: "packages" },
        },
      ],
    }),
  ],
});
