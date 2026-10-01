import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * The blog collection. Each file in src/content/blog/ is one post, and its file
 * name is the URL slug: why-we-built-stratum.mdx is served at
 * /blog/why-we-built-stratum/. The blog index, the RSS and Atom feeds, and the
 * per-post metadata all read this collection, so a new post needs only its file.
 */
const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '*.{md,mdx}' }),
  schema: z.object({
    /** The post heading, and the title in the index and the feeds. */
    title: z.string(),
    /** A word or phrase in `title` that the heading shows in the accent color. */
    accent: z.string().optional(),
    /** The HTML <title> text before " | Stratum Blog". Defaults to `title`. */
    seoTitle: z.string().optional(),
    /** The meta description, and the summary in the index and the feeds. */
    description: z.string(),
    /** The italic line under the heading. */
    intro: z.string().optional(),
    pubDate: z.coerce.date(),
    updated: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    /** An absolute URL. Set it only when the post was first published elsewhere. */
    canonical: z.string().url().optional(),
    /** An absolute URL or a site path. Defaults to the site OG image. */
    ogImage: z.string().optional(),
    /** A draft is built by `astro dev` only, never by `astro build`. */
    draft: z.boolean().default(false),
    /** The primary button at the end of the post. Defaults to the docs quick start. */
    cta: z
      .object({ label: z.string(), href: z.string() })
      .default({
        label: 'Read the docs',
        href: 'https://docs.stratum-hq.org/getting-started/quick-start',
      }),
  }),
});

export const collections = { blog };
