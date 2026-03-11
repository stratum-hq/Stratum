// @ts-check

const {themes: prismThemes} = require('prism-react-renderer');

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Stratum',
  tagline: 'Universal Tenant Context Engine - hierarchical multi-tenancy for any stack',
  favicon: 'img/stratumlogo.png',

  future: {
    v4: true,
  },

  url: 'https://stratum.dev',
  baseUrl: '/',

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          routeBasePath: 'docs',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/stratumlogo.png',
      colorMode: {
        defaultMode: 'dark',
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'Stratum',
        logo: {
          alt: 'Stratum Logo',
          src: 'img/stratumlogo.png',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'docsSidebar',
            position: 'left',
            label: 'Documentation',
          },
          {
            type: 'docSidebar',
            sidebarId: 'apiSidebar',
            position: 'left',
            label: 'API Reference',
          },
          {
            type: 'docSidebar',
            sidebarId: 'guidesSidebar',
            position: 'left',
            label: 'Guides',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Documentation',
            items: [
              {label: 'Getting Started', to: '/docs/guides/getting-started'},
              {label: 'Architecture', to: '/docs/architecture/overview'},
              {label: 'API Reference', to: '/docs/api/rest-api'},
            ],
          },
          {
            title: 'Packages',
            items: [
              {label: '@stratum/lib', to: '/docs/packages/lib'},
              {label: '@stratum/sdk', to: '/docs/packages/sdk'},
              {label: '@stratum/control-plane', to: '/docs/packages/control-plane'},
              {label: '@stratum/react', to: '/docs/packages/react'},
            ],
          },
          {
            title: 'More',
            items: [
              {label: '@stratum/core', to: '/docs/packages/core'},
              {label: '@stratum/db-adapters', to: '/docs/packages/db-adapters'},
              {label: '@stratum/demo', to: '/docs/packages/demo'},
            ],
          },
        ],
        copyright: 'Copyright ' + new Date().getFullYear() + ' Stratum. Built with Docusaurus.',
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ['bash', 'json', 'sql', 'typescript'],
      },
    }),
};

module.exports = config;
