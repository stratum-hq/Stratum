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
        "Universal Tenant Context Engine — hierarchical multi-tenancy for any stack.",
      customCss: ["./src/styles/custom.css"],
      social: {
        github: "https://github.com/stratum-hq/stratum",
      },
      head: [
        {
          tag: "link",
          attrs: {
            rel: "preconnect",
            href: "https://api.fontshare.com",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "stylesheet",
            href: "https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap",
          },
        },
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
          tag: "link",
          attrs: {
            rel: "stylesheet",
            href: "https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,700;1,9..40,400&family=JetBrains+Mono:wght@400;500;700&display=swap",
          },
        },
      ],
      sidebar: [
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
