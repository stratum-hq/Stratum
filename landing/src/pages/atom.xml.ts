import type { APIRoute } from 'astro';
import { getPosts, postPath, type BlogPost } from '../lib/blog';

export const GET: APIRoute = async () => {
  const site = 'https://stratum-hq.org';
  const posts = await getPosts();
  const lastChange = (post: BlogPost) => post.data.updated ?? post.data.pubDate;
  const updated = posts
    .map(lastChange)
    .sort((a, b) => b.getTime() - a.getTime())[0]
    .toISOString();

  const entries = posts
    .map(
      (post) => `  <entry>
    <title>${escapeXml(post.data.title)}</title>
    <link href="${site}${postPath(post)}" rel="alternate" />
    <id>${site}${postPath(post)}</id>
    <published>${post.data.pubDate.toISOString()}</published>
    <updated>${lastChange(post).toISOString()}</updated>
    <summary>${escapeXml(post.data.description)}</summary>
${post.data.tags.map((tag) => `    <category term="${escapeXml(tag)}" />\n`).join('')}  </entry>`
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Stratum Blog</title>
  <subtitle>Updates, guides, and insights about multi-tenancy in Node.js</subtitle>
  <link href="${site}/atom.xml" rel="self" type="application/atom+xml" />
  <link href="${site}/blog" rel="alternate" type="text/html" />
  <id>${site}/blog</id>
  <updated>${updated}</updated>
  <author>
    <name>Stratum HQ</name>
    <uri>${site}</uri>
  </author>
${entries}
</feed>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
    },
  });
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
