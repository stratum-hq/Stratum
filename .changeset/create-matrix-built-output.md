---
"@stratum-hq/create": patch
---

Point `@stratum-hq/create`'s `exports["./matrix"]` at built output instead of raw source (#219, from the #133 v1.0 surface review).

The `./matrix` subpath previously resolved (and shipped) `./src/matrix.ts` for both the `import` and `types` conditions, blessing a raw-source subpath unlike every other package. The build now emits `dist/matrix.js` and `./matrix` resolves there, matching the package's `.` entry. The stack-combination matrix API is unchanged.
