import type { Preview } from '@storybook/react';
import '../src/styles/default.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    layout: 'padded',
  },
  // Bedrock (dark) is the default theme; Daylight is opt in from the toolbar.
  globalTypes: {
    theme: {
      description: 'Stratum theme',
      toolbar: {
        title: 'Theme',
        items: [
          { value: 'dark', title: 'Bedrock (dark)' },
          { value: 'light', title: 'Daylight (light)' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      // An explicit toolbar choice wins; otherwise keep any data-theme already
      // on the page and fall back to dark.
      const chosen = context.globals.theme;
      const root = document.documentElement;
      if (chosen === 'light' || chosen === 'dark') root.setAttribute('data-theme', chosen);
      else if (!root.hasAttribute('data-theme')) root.setAttribute('data-theme', 'dark');
      document.body.style.background = 'var(--surface-0)';
      document.body.style.color = 'var(--text-primary)';
      return Story();
    },
  ],
};

export default preview;
