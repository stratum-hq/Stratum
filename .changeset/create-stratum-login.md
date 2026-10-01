---
"@stratum-hq/create": minor
---

Generated PostgreSQL projects follow the hardened role model (GHSA-mg93-96h7-h9fq): `init.sql` creates the control role and a separate login for Stratum (`STRATUM_ADMIN_DATABASE_URL`, the library's `adminPool`), gives the application role no `CREATE` on `public`, and limits its default privileges to the tables the bootstrap superuser creates. Run the Stratum migrations as the Stratum login.
