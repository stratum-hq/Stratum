# landing

The marketing site at https://stratum-hq.org. It is an Astro project with its own
`package.json` and lockfile. It is not an npm workspace package.

```bash
cd landing
npm ci
npm run dev       # local server with live reload
npm run build     # static site in dist/
npm run preview   # serve dist/
```

## Add a blog post

Add one file to `src/content/blog/`. You do not change any other file.

1. Name the file for the URL. `my-post.mdx` is served at `/blog/my-post/`.
2. Start the file with frontmatter:

   ```yaml
   ---
   title: My Post Title
   description: One or two sentences. The index, the feeds, and search results show this text.
   pubDate: 2026-10-01
   ---
   ```

3. Write the body in Markdown below the frontmatter. Use `##` for section headings.
   The layout supplies the page heading, the date, and the button row at the end.

The build adds the post to the blog index, `/rss.xml`, `/atom.xml`, and the sitemap.
It also writes the post metadata (`og:type` article and `BlogPosting` JSON-LD).

`src/content.config.ts` has the full schema. These frontmatter fields are optional:

| Field | Use |
| --- | --- |
| `accent` | A word in `title` that the heading shows in the accent color. |
| `seoTitle` | The browser tab and search title, if it must differ from `title`. |
| `intro` | An italic line under the heading. |
| `updated` | The date of the last real change to the post. |
| `tags` | A list of topics, for example `[postgres, rls]`. |
| `canonical` | An absolute URL, only when the post was first published on another site. |
| `ogImage` | A social image, as a site path or an absolute URL. The default is `/og.png`. |
| `draft` | `true` keeps the post out of `npm run build`. `npm run dev` still shows it. |
| `cta` | The primary button, as `{ label, href }`. The default is the docs quick start. |

A `.mdx` file can import components. For a code sample with the site code frame, use
`CodeBlock` and put a fenced code block inside it, with a blank line on each side:

````mdx
import CodeBlock from '../../components/CodeBlock.astro';

<CodeBlock filename="example.ts">

```ts
const stratum = new Stratum({ pool });
```

</CodeBlock>
````

To make a table scroll on narrow screens, put it in `<div class="table-wrapper">`, with
a blank line on each side of the table.
