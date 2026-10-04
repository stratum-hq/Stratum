import { dirname, join } from 'path';
import type { StorybookConfig } from '@storybook/react-vite';

// npm installs @storybook/react-vite under packages/react-ui/node_modules, but
// Storybook resolves a preset by name from the repository root. An absolute
// path lets it load the preset from this package.
function getAbsolutePath(value: string): string {
  return dirname(require.resolve(join(value, 'package.json')));
}

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [getAbsolutePath('@storybook/addon-essentials')],
  framework: getAbsolutePath('@storybook/react-vite'),
};

export default config;
