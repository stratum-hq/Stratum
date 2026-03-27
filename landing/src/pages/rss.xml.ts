import rss from '@astrojs/rss';
export function GET() {
  return rss({
    title: 'Stratum Blog',
    description: 'Updates, guides, and insights about multi-tenancy in Node.js',
    site: 'https://stratum-hq.org',
    items: [
      {
        title: 'Why We Built Stratum',
        description: 'Every B2B SaaS team reinvents multi-tenancy from scratch. We built Stratum so they never have to again.',
        link: '/blog/why-we-built-stratum/',
        pubDate: new Date('2026-03-27'),
      },
    ],
  });
}
