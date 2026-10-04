import type { Preview } from '@storybook/react';
import '../src/styles/base.css';
// The Bedrock theme loads as text, so the toolbar can add it and remove it.
import bedrockCss from '../src/styles/theme-bedrock.css?inline';
import fontsCss from '../src/styles/fonts.css?inline';

const BEDROCK_STYLE_ID = 'stratum-storybook-bedrock';

function setBedrock(on: boolean): void {
  const existing = document.getElementById(BEDROCK_STYLE_ID);
  if (on && !existing) {
    const style = document.createElement('style');
    style.id = BEDROCK_STYLE_ID;
    style.textContent = `${fontsCss}\n${bedrockCss}`;
    document.head.appendChild(style);
  } else if (!on && existing) {
    existing.remove();
  }
}

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
  globalTypes: {
    look: {
      description: 'Stylesheet: base only, or base plus the Bedrock theme',
      toolbar: {
        title: 'Look',
        items: [
          { value: 'base', title: 'Base' },
          { value: 'bedrock', title: 'Bedrock theme' },
        ],
        dynamicTitle: true,
      },
    },
    theme: {
      description: 'Color scheme',
      toolbar: {
        title: 'Scheme',
        items: [
          { value: 'system', title: 'System (prefers-color-scheme)' },
          { value: 'dark', title: 'Dark' },
          { value: 'light', title: 'Light' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    look: 'base',
    theme: 'system',
  },
  decorators: [
    (Story, context) => {
      setBedrock(context.globals.look === 'bedrock');
      const root = document.documentElement;
      const chosen = context.globals.theme;
      if (chosen === 'light' || chosen === 'dark') root.setAttribute('data-theme', chosen);
      else root.removeAttribute('data-theme');
      // The page itself is not a stratum element, so it reads the tokens from
      // a wrapper that has the stratum-scope class.
      root.classList.add('stratum-scope');
      document.body.style.background = 'var(--stratum-surface-0)';
      document.body.style.color = 'var(--stratum-text-primary)';
      return Story();
    },
  ],
};

export default preview;
