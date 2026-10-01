# Prisma client fixtures

`src/__tests__/types/prisma-client.ts` compiles the Prisma helpers of this package
against a real generated `PrismaClient`. These fixtures supply that client for
Prisma 5, Prisma 6 and Prisma 7.

The fixtures are in git because `prisma generate` downloads engine binaries on its
first run. Thus a generate step in `npm run typecheck` would need the network.

## Prisma 5 and Prisma 6

Each directory holds a schema and the two declaration files that `prisma generate`
writes for it: `client/index.d.ts` and `client/runtime/library.d.ts`. The two files
import nothing else, so the type test needs no Prisma package and no network.
`.gitignore` keeps only these two files from the generated client.

## Prisma 7

Prisma 7 has two generators, and `prisma-7/schema.prisma` uses both:

- `prisma-client-js` writes declaration files, as in Prisma 5 and 6. The fixture
  keeps `client/index.d.ts` and `client/runtime/client.d.ts`.
- `prisma-client` is the default generator in Prisma 7. It writes TypeScript source.
  The fixture keeps the files in `generated/` that `generated/client.ts` imports. It
  omits `browser.ts` and `internal/prismaNamespaceBrowser.ts`.

The Prisma 7 runtime declarations import the package `@prisma/client-runtime-utils`.
`client-runtime-utils/index.d.ts` is a copy of `dist/index.d.ts` from that package.
The files in `generated/` import `@prisma/client/runtime/client`. The root
`node_modules` holds the Prisma 5 client, which has no such file. Thus
`tsconfig.types.json` maps both package names to the fixture files.

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

For the Prisma 5 fixture, use version 5.22.0 and the `prisma-5` directory.

For the Prisma 7 fixture, use version 7.10.0. Prisma 7 has no `--no-engine` flag,
because its client needs no query engine binary. Copy these files into `prisma-7/`:

```bash
npm install --ignore-scripts prisma@7.10.0 @prisma/client@7.10.0
cp <repo>/packages/db-adapters/test-fixtures/prisma-7/schema.prisma .
npx prisma generate --schema schema.prisma
F=<repo>/packages/db-adapters/test-fixtures/prisma-7
cp client/index.d.ts $F/client/
cp client/runtime/client.d.ts $F/client/runtime/
cp generated/client.ts generated/commonInputTypes.ts generated/enums.ts generated/models.ts $F/generated/
cp generated/internal/class.ts generated/internal/prismaNamespace.ts $F/generated/internal/
cp generated/models/Order.ts $F/generated/models/
cp node_modules/@prisma/client-runtime-utils/dist/index.d.ts $F/client-runtime-utils/
```

Then commit the changed files. To test a newer Prisma release, change the version in
the commands.
