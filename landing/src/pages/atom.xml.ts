import type { APIRoute } from 'astro';
import { blogPosts } from '../data/posts';

export const GET: APIRoute = () => {
  const site = 'https://stratum-hq.org';
  const updated = blogPosts
    .map((p) => p.pubDate)
    .sort((a, b) => b.getTime() - a.getTime())[0]
    .toISOString();

  const entries = blogPosts
    .map(
      (post) => `  <entry>
    <title>${escapeXml(post.title)}</title>
    <link href="${site}${post.link}" rel="alternate" />
    <id>${site}${post.link}</id>
    <updated>${post.pubDate.toISOString()}</updated>
    <summary>${escapeXml(post.description)}</summary>
  </entry>`
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
