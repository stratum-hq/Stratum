// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Architecture',
      collapsed: false,
      items: [
        'architecture/overview',
        'architecture/database',
        'architecture/security',
      ],
    },
    {
      type: 'category',
      label: 'Packages',
      collapsed: false,
      items: [
        'packages/core',
        'packages/lib',
        'packages/control-plane',
        'packages/sdk',
        'packages/db-adapters',
        'packages/react',
        'packages/demo',
      ],
    },
  ],
  apiSidebar: [
    'api/rest-api',
    'api/error-codes',
  ],
  guidesSidebar: [
    'guides/getting-started',
    'guides/direct-library',
    'guides/control-plane-sdk',
    'guides/react-integration',
    'guides/database-rls',
    'guides/config-inheritance',
    'guides/permission-delegation',
    'guides/edge-cases',
  ],
};

module.exports = sidebars;
