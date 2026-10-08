import type { Preview } from '@storybook/react';
import '../src/styles/base.css';
// The themes load as text, so the toolbar can add one and remove it.
import bedrockCss from '../src/styles/theme-bedrock.css?inline';
import fontsCss from '../src/styles/fonts.css?inline';
import ansiStrataCss from '../src/styles/theme-ansi-strata.css?inline';
import ansiStrataFontsCss from '../src/styles/fonts-ansi-strata.css?inline';

const THEME_STYLE_ID = 'stratum-storybook-theme';
const THEMES: Record<string, string> = {
  bedrock: `${fontsCss}\n${bedrockCss}`,
  'ansi-strata': `${ansiStrataFontsCss}\n${ansiStrataCss}`,
};

function setTheme(look: string): void {
  const existing = document.getElementById(THEME_STYLE_ID);
  if (existing?.dataset.look === look) return;
  existing?.remove();
  const css = THEMES[look];
  if (!css) return;
  const style = document.createElement('style');
  style.id = THEME_STYLE_ID;
  style.dataset.look = look;
  style.textContent = css;
  document.head.appendChild(style);
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
      description: 'Stylesheet: base only, or base plus a theme',
      toolbar: {
        title: 'Look',
        items: [
          { value: 'base', title: 'Base' },
          { value: 'bedrock', title: 'Bedrock theme' },
          { value: 'ansi-strata', title: 'ANSI Strata theme' },
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
      setTheme(context.globals.look);
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
