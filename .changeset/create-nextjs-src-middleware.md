---
"@stratum-hq/create": minor
---

The Next.js template and every Next.js preset now write the tenant middleware to `src/middleware.ts`, next to the `src/app` directory, so Next.js runs it. Previously it was written to the project root, where Next.js ignores it when the app lives in `src/app`, so the tenant JWT was not verified and a client-supplied `x-tenant-id` header reached server code. The generated app also gets the root layout (`src/app/layout.tsx`) that `next build` requires, and the Next.js presets get a `tsconfig.json` that `next build` accepts (bundler module resolution, no `rootDir`). If you generated a Next.js project with an earlier version, move `middleware.ts` to `src/middleware.ts`. See GHSA-mg93-96h7-h9fq.
