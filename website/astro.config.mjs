import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  integrations: [
    starlight({
      title: "Stratum Docs",
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
          items: [
            { label: "Introduction", link: "/" },
            {
              label: "Installation",
              slug: "getting-started/installation",
            },
            { label: "Quick Start", slug: "getting-started/quick-start" },
            { label: "Concepts", slug: "getting-started/concepts" },
          ],
        },
        {
          label: "Guides",
          items: [
            {
              label: "Tenant Hierarchy",
              slug: "guides/tenant-hierarchy",
            },
            {
              label: "Config Inheritance",
              slug: "guides/config-inheritance",
            },
            {
              label: "Permission Delegation",
              slug: "guides/permission-delegation",
            },
            {
              label: "Isolation Strategies",
              slug: "guides/isolation-strategies",
            },
            { label: "API Keys & Auth", slug: "guides/api-keys" },
            { label: "Webhooks", slug: "guides/webhooks" },
            {
              label: "GDPR Compliance",
              slug: "guides/gdpr-compliance",
            },
            { label: "Multi-Region", slug: "guides/multi-region" },
          ],
        },
        {
          label: "API Reference",
          items: [
            { label: "Tenants", slug: "api/tenants" },
            { label: "Config", slug: "api/config" },
            { label: "Permissions", slug: "api/permissions" },
            { label: "API Keys", slug: "api/api-keys" },
            { label: "Webhooks", slug: "api/webhooks" },
          ],
        },
        {
          label: "Packages",
          items: [
            { label: "@stratum-hq/core", slug: "packages/core" },
            { label: "@stratum-hq/lib", slug: "packages/lib" },
            { label: "@stratum-hq/sdk", slug: "packages/sdk" },
            {
              label: "@stratum-hq/db-adapters",
              slug: "packages/db-adapters",
            },
            { label: "@stratum-hq/cli", slug: "packages/cli" },
            { label: "@stratum-hq/react", slug: "packages/react" },
          ],
        },
      ],
    }),
  ],
});
