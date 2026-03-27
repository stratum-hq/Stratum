import rss from '@astrojs/rss';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  return rss({
    title: 'Stratum Blog',
    description: 'Updates, guides, and insights about multi-tenancy in Node.js',
    site: 'https://stratum-hq.org',
    items: [
      {
        title: 'Why We Built Stratum',
        pubDate: new Date('2025-01-15'),
        description: 'Every B2B SaaS team reinvents multi-tenancy from scratch. We built Stratum so they never have to again. Open-source, MIT licensed.',
        link: '/blog/why-we-built-stratum',
      },
    ],
    customData: `<language>en-us</language>`,
  });
}
