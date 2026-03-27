import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://stratum-hq.org',
  integrations: [sitemap()],
});
