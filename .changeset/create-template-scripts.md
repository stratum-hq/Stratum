---
"@stratum-hq/create": patch
---

Generated projects now run with the scripts they ship. The express and fastify templates now write a `tsconfig.json`, so `npm run build` compiles `src/` to `dist/` and `npm start` runs `dist/index.js`. The `dev` script of the templates and of every non-Next.js preset is now `tsx watch --env-file=.env src/<entry>.ts`, because Node 20 cannot run a `.ts` file. Before this fix, `dev` pointed at `src/index.js`, which the scaffold never wrote. Knex presets now compile from the project root, because `src/stratum-knex.ts` imports `knexfile.ts` from there. Their `start` script runs `dist/src/<entry>.js`. The generated README and the success message now tell you to run `npm run dev`.
