export function printHelp(): void {
  console.log(`
  Usage: stratum <command> [options]

  Commands:

    init                          Initialize Stratum in an existing project
    migrate <table>               Add tenant_id + RLS to an existing table
    migrate --scan                Scan database and show RLS status for all tables
    migrate --all                 Migrate all unmigrated tables interactively
    health                        Check database connection, extensions, and RLS setup
                                  (exits 1 when a check fails)
    doctor                        Deep diagnostic: RLS, indexes, stale keys, tree depth
                                  (exits 1 when a check fails)
    scan                          Scan database for tables needing tenant isolation
    scan --generate               Write migration SQL for unmigrated tables to stdout
                                  (the report goes to stderr)
    generate api-key              Generate a new API key
    db roles                      Print the SQL that sets up the admin, app and control roles
    db roles --apply              Run that SQL (as a superuser, via --database-url)
    db lock                       Turn the legacy app.bypass_rls path off
    db unlock                     Turn the legacy app.bypass_rls path back on
    scaffold <template>           Generate framework integration boilerplate
    playground                    Start control plane + demo app locally
                                  (from a clone of the Stratum repository)

  Scaffold Templates:

    scaffold express              Express.js middleware + tenant-aware routes
    scaffold fastify              Fastify plugin + tenant-aware routes
    scaffold nextjs               Next.js middleware + API routes + layouts
    scaffold react                React provider + hooks + tenant guard
    scaffold prisma               Prisma client with tenant-scoped queries
    scaffold docker               Docker Compose for Stratum + PostgreSQL
    scaffold env                  Generate .env with all Stratum variables

  Options:

    --database-url, -d <url>      PostgreSQL connection string
                                  (default: DATABASE_URL env or localhost)
    --admin-database-url <url>    Connection of the admin login, a member of the control
                                  role (default: DATABASE_ADMIN_URL env). doctor, generate,
                                  migrate --tenant and db lock use it for Stratum's tables;
                                  without it they fall back to the legacy app.bypass_rls path
    --control-role <role>         Control role of migration 032 (default: the
                                  stratum.control_role setting, else stratum_control)
    --admin-role <role>           Admin login for db roles
    --app-role <role>             Application login for db roles
    --schema <schema>             Schema of the Stratum tables for db commands (default: public)
    --apply                       Run the db roles SQL instead of printing it
    --tenant <uuid>               Tenant for the existing rows of a migrated table
                                  (migrate command; required when the table has rows)
    --name <name>                 Name for generated API key
    --out <dir>                   Output directory for scaffolded files
                                  (default: current directory)
    --force                       Overwrite existing files
    --generate, -g                Output migration SQL (scan command)
    --exclude <tables>            Comma-separated tables to skip (scan command)
    --depth-warning <n>           Tree depth above which doctor warns (doctor command;
                                  default: STRATUM_DOCTOR_DEPTH_WARNING env or 20)
    --cp-port <port>              Control plane port (playground command; default: 3001)
    --help, -h                    Show this help message
    --version, -v                 Show version

  Environment:

    DATABASE_URL                  Default for --database-url
    DATABASE_ADMIN_URL            Default for --admin-database-url
    NO_COLOR                      Set to any non-empty value to turn off colors

  Prompts take the default shown in brackets on Enter. A command exits 1 when
  stdin closes before a prompt is answered.

  Examples:

    $ stratum init
    $ stratum health --database-url postgres://user:pass@host:5432/mydb
    $ stratum migrate orders
    $ stratum migrate orders --tenant 7c9e6679-7425-40de-944b-e07fc1f90ae7
    $ stratum migrate --scan
    $ stratum generate api-key --name "my-service"
    $ stratum db roles --admin-role stratum_admin --app-role stratum_app
    $ stratum db roles --apply --admin-role stratum_admin --app-role stratum_app -d <superuser url>
    $ stratum db lock --admin-database-url postgres://stratum_admin:...@host/db
    $ stratum scaffold express --out src/middleware
    $ stratum scaffold nextjs
    $ stratum scaffold react --out src/providers
    $ stratum scan
    $ stratum scan --generate > migration.sql
    $ stratum scan --exclude users,sessions --generate
`);
}
