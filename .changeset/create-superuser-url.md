---
"@stratum-hq/create": minor
---

Generated PostgreSQL projects name the bootstrap superuser URL `DATABASE_SUPERUSER_URL` (was `DATABASE_ADMIN_URL`, which the library uses for its admin login), and schema-per-tenant projects keep the schemas the app creates off the search path of the Stratum login and the superuser (GHSA-mg93-96h7-h9fq).
