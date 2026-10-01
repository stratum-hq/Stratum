# Prisma client fixtures

`src/__tests__/types/prisma-client.ts` compiles the Prisma helpers of this package
against a real generated `PrismaClient`. These fixtures supply that client for
Prisma 5 and Prisma 6.

Each directory holds a schema and the two declaration files that `prisma generate`
writes for it: `client/index.d.ts` and `client/runtime/library.d.ts`. The two files
import nothing else, so the type test needs no Prisma package and no network.
`.gitignore` keeps only these two files from the generated client.

The fixtures are in git because `prisma generate` downloads engine binaries on its
first run. Thus a generate step in `npm run typecheck` would need the network.

## Regenerate

`prisma generate` copies the runtime from the `@prisma/client` package nearest to
the output directory. In this repository, that package is the Prisma 5 client in the
root `node_modules`. Thus generate each fixture in a temporary project that installs
the same Prisma version as the fixture:

```bash
mkdir /tmp/prisma-fixture && cd /tmp/prisma-fixture
npm init -y
npm install --ignore-scripts prisma@6.19.3 @prisma/client@6.19.3
cp <repo>/packages/db-adapters/test-fixtures/prisma-6/schema.prisma .
npx prisma generate --no-engine --schema schema.prisma
cp client/index.d.ts <repo>/packages/db-adapters/test-fixtures/prisma-6/client/
cp client/runtime/library.d.ts <repo>/packages/db-adapters/test-fixtures/prisma-6/client/runtime/
```

For the Prisma 5 fixture, use version 5.22.0 and the `prisma-5` directory. Then
commit the changed declaration files. To test a newer Prisma release, change the
version in the commands.
