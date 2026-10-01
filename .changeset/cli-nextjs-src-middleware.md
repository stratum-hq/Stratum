---
"@stratum-hq/cli": minor
---

`stratum init` and `stratum scaffold nextjs` write the Next.js middleware and the `app/api/stratum` proxy route next to the project's app directory: into `src/` when the project keeps its app in `src/app` (or `src/pages`) and has no root `app/` or `pages/`. Previously they were always written to the output root, where Next.js does not run the middleware for a `src/app` project, and a root `app/` directory would take precedence over `src/app`. See GHSA-mg93-96h7-h9fq.
