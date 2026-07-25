---
"@stratum-hq/control-plane": patch
"@stratum-hq/core": patch
"@stratum-hq/create": patch
"@stratum-hq/db-adapters": patch
"@stratum-hq/lib": patch
"@stratum-hq/nestjs": patch
"@stratum-hq/react": patch
"@stratum-hq/sdk": patch
"@stratum-hq/test-utils": patch
---

Stop shipping test files in published tarballs. tsc-built packages now exclude __tests__ directories and .test/.spec files from compilation, so dist and the tarball contain only real package output. The create package, which ships source for its ./matrix export, excludes tests via .npmignore instead. The vitest runner is unaffected and still runs tests from src.
