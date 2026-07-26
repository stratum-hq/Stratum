import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

/**
 * Landing-only font handling.
 *
 * The shared assets/tokens.css is the single source of truth for both landing/
 * and website/, and it loads the brand fonts with a render-blocking Google Fonts
 * @import. website/ (Epic 18, out of scope here) still depends on that @import,
 * so the shared file is left untouched. For the landing we strip only the remote
 * font @import out of the bundled CSS and load the same families non-blocking
 * from Base.astro's <head>, so first paint is never blocked on a font stylesheet.
 */
const stripRemoteFontImport = () => ({
  postcssPlugin: 'strip-remote-font-import',
  AtRule: {
    import(atRule) {
      if (/fonts\.googleapis\.com/.test(atRule.params)) {
        atRule.remove();
      }
    },
  },
});
stripRemoteFontImport.postcss = true;

export default defineConfig({
  site: 'https://stratum-hq.org',
  integrations: [sitemap()],
  // Real syntax highlighting. The css-variables theme emits token colors as
  // --astro-code-* custom properties, which global.css maps onto the Core Sample
  // --syntax-* tokens, so no hex is hardcoded in the highlighted markup.
  markdown: {
    shikiConfig: { theme: 'css-variables' },
  },
  vite: {
    css: {
      postcss: {
        plugins: [stripRemoteFontImport()],
      },
    },
  },
});
