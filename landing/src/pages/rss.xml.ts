import rss from '@astrojs/rss';
import { getPosts, postPath } from '../lib/blog';

export async function GET() {
  const posts = await getPosts();
  return rss({
    title: 'Stratum Blog',
    description: 'Updates, guides, and insights about multi-tenancy in Node.js',
    site: 'https://stratum-hq.org',
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      link: postPath(post),
      pubDate: post.data.pubDate,
      categories: post.data.tags,
    })),
  });
}
