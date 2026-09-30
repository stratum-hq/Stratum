---
"@stratum-hq/lib": patch
"@stratum-hq/react": patch
---

Make the build copy of `src/migrations` (lib) and `src/styles` (react) replace the old copy in `dist`. A rebuild without a clean no longer creates `dist/migrations/migrations` or `dist/styles/styles`, and it no longer keeps stale top-level files. Published tarballs do not change, because the release job builds from a clean checkout.
