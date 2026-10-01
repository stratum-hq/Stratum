---
"@stratum-hq/cli": minor
---

CLI exit codes, `scan --generate` output, `.env.stratum` contents and prompt behavior (#474).

- `stratum health` now exits with code 1 when a check fails (a missing extension, a login with `BYPASSRLS`, PostgreSQL older than 14), as `stratum doctor` does. Warnings keep exit code 0. Scripts that ran `health` and ignored failures will now see a non-zero exit.
- `stratum scan --generate` writes only SQL to stdout and the report to stderr, so `stratum scan --generate > migration.sql` produces a file that runs. The SQL adds the foreign key to `tenants(id)` only when that table exists.
- `.env.stratum` from `stratum init` and `stratum scaffold env` now includes `DATABASE_ADMIN_URL` and random development values for `STRATUM_ENCRYPTION_KEY`, `STRATUM_HKDF_SALT` and `STRATUM_API_KEY_HMAC_SECRET`, with the rules that apply outside development.
- `stratum scaffold docker` sets up the role model: a NOLOGIN `stratum_control` role, a non-superuser `stratum_admin` login that runs the migrations, and a `stratum_app` login without privileges on the Stratum tables, matching `docker/init-db.sql`. The compose file passes `DATABASE_ADMIN_URL` to the control plane.
- `stratum migrate` exits with code 1 when stdin closes at a prompt instead of exiting 0 silently. Piped answers are read in full. `stratum init` offers a default for every question, which Enter accepts.
- `stratum migrate --scan` suggests `stratum migrate <table>` only for tables that command accepts. `stratum migrate` now rejects table names that are not lowercase, which it could not migrate before either.
- `NO_COLOR` turns off colors.
- A long flag no longer takes a following short flag as its value (`scan --generate -d <url>`), and an error without a message prints its code.
