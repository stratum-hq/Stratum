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
      ],
      sidebar: [
        { label: '← stratum-hq.org', link: 'https://stratum-hq.org', attrs: { target: '_blank' } },
        { label: 'Blog', link: 'https://stratum-hq.org/blog', attrs: { target: '_blank' } },
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
