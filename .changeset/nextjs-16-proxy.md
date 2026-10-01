---
"@stratum-hq/create": minor
"@stratum-hq/cli": minor
---

Move the Next.js templates to Next.js 16.

`@stratum-hq/create` now generates Next.js projects with `next` `^16.3.8` and `react` `^19.2.0`. Every Next.js release before 16.3.0 bundles a `postcss` with published advisories. The tenant check is now `src/proxy.ts`, which exports `proxy` and runs on the Node.js runtime. It still verifies the JWT and still removes a client-sent tenant header. Generated Next.js projects need Node.js 20.9 or later. The generated `tsconfig.json` has the options that `next build` on Next.js 16 adds, so the first build does not change it.

`stratum init` and `stratum scaffold nextjs` read the Next.js version of the project, from `node_modules/next` first, else from `package.json`. Next.js 16 and later get `proxy.ts`. Next.js 15 gets `middleware.ts`. When the version is unknown, they write `middleware.ts`, which Next.js 15 and 16 both run, and print the codemod that renames it. They never write one of the two files next to the other, even with `--force`: Next.js 16 refuses a project that has both, and Next.js 15 ignores `proxy.ts`.

Existing projects need no change. Next.js 16 still runs `middleware.ts` and prints a deprecation warning. To move a project to `proxy.ts`, run `npx @next/codemod@canary middleware-to-proxy .`. The file must sit next to the app directory: `src/proxy.ts` for `src/app`, `proxy.ts` for `app`.
