export function printHelp(): void {
  console.log(`
  Usage: stratum <command> [options]

  Commands:

    init                          Initialize Stratum in an existing project
    migrate <table>               Add tenant_id + RLS to an existing table
    migrate --scan                Scan database and show RLS status for all tables
    migrate --all                 Migrate all unmigrated tables interactively
    health                        Check database connection, extensions, and RLS setup
    doctor                        Deep diagnostic: RLS, indexes, stale keys, tree depth
    scan                          Scan database for tables needing tenant isolation
    scan --generate               Output migration SQL for unmigrated tables
    generate api-key              Generate a new API key
    scaffold <template>           Generate framework integration boilerplate
    playground                    Start control plane + demo app locally

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
    --name <name>                 Name for generated API key
    --out <dir>                   Output directory for scaffolded files
                                  (default: current directory)
    --force                       Overwrite existing files
    --generate, -g                Output migration SQL (scan command)
    --exclude <tables>            Comma-separated tables to skip (scan command)
    --help, -h                    Show this help message
    --version, -v                 Show version

  Examples:

    $ stratum init
    $ stratum health --database-url postgres://user:pass@host:5432/mydb
    $ stratum migrate orders
    $ stratum migrate --scan
    $ stratum generate api-key --name "my-service"
    $ stratum scaffold express --out src/middleware
    $ stratum scaffold nextjs
    $ stratum scaffold react --out src/providers
    $ stratum scan
    $ stratum scan --generate > migration.sql
    $ stratum scan --exclude users,sessions --generate
`);
}
