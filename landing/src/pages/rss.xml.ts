import rss from '@astrojs/rss';
import { blogPosts } from '../data/posts';

export function GET() {
  return rss({
    title: 'Stratum Blog',
    description: 'Updates, guides, and insights about multi-tenancy in Node.js',
    site: 'https://stratum-hq.org',
    items: blogPosts.map((post) => ({
      title: post.title,
      description: post.description,
      link: post.link,
      pubDate: post.pubDate,
    })),
  });
}
