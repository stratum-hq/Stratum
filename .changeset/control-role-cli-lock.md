---
"@stratum-hq/cli": minor
---

Control role (GHSA-mg93-96h7-h9fq): `stratum db lock` refuses while the application login (the login of `--database-url` when an admin connection is given, or `--app-role`) is a member of the control role. `doctor` and `health` list the members of the control role and warn about members other than the admin login. `stratum scaffold docker` gives the application login its own schema instead of `CREATE` on `public`.
