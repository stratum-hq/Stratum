import { getCollection, type CollectionEntry } from 'astro:content';

export type BlogPost = CollectionEntry<'blog'>;

/** Returns the posts that the site shows, newest first. */
export async function getPosts(): Promise<BlogPost[]> {
  // Drafts stay visible in `astro dev` so an author can preview them.
  const posts = await getCollection('blog', ({ data }) => import.meta.env.DEV || !data.draft);
  // Same-day posts keep a stable order, so the index and the feeds do not reshuffle.
  return posts.sort(
    (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime() || a.id.localeCompare(b.id)
  );
}

/** Returns the site path of a post, with the trailing slash the built pages use. */
export function postPath(post: BlogPost): string {
  return `/blog/${post.id}/`;
}
