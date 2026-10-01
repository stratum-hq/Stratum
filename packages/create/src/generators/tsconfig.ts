import type { Framework, StackPreset } from "../matrix.js";

/**
 * Return the source files that a preset writes at the project root and that code in `src/` imports.
 *
 * @param preset - The stack preset of the generated project.
 */
export function rootSources(preset: StackPreset): string[] {
  // The knex CLI reads knexfile.ts from the project root, and src/stratum-knex.ts imports it.
  return preset.orm === "knex" ? ["knexfile.ts"] : [];
}

/**
 * Return the tsconfig.json content for a generated project.
 *
 * @param framework - The framework of the project. It adds the compiler options that the framework needs.
 * @param extraSources - Source files at the project root that code in `src/` imports.
 *   When there are any, tsc compiles from the project root, so the output of `src/` goes to `dist/src/`.
 */
export function generateTsconfig(framework: Framework, extraSources: string[] = []): string {
  // tsc rejects an imported file outside rootDir with TS6059.
  const rootDir = extraSources.length > 0 ? "." : "src";
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ESNext",
        // Next.js resolves imports like a bundler: "next/server" has no file
        // extension, which NodeNext refuses in an ES module package.
        ...(framework === "nextjs"
          ? { module: "ESNext", moduleResolution: "Bundler" }
          : { module: "NodeNext", moduleResolution: "NodeNext" }),
        strict: true,
        // next build compiles a Next.js app itself and type-checks the files it
        // generates under .next/types, which a rootDir of src would reject.
        ...(framework === "nextjs" ? { noEmit: true } : { outDir: "dist", rootDir, declaration: true }),
        skipLibCheck: true,
        esModuleInterop: true,
        ...(framework === "nestjs"
          ? { experimentalDecorators: true, emitDecoratorMetadata: true }
          : {}),
        ...(framework === "nextjs"
          ? { jsx: "preserve", plugins: [{ name: "next" }] }
          : {}),
      },
      include:
        framework === "nextjs"
          ? ["next-env.d.ts", "src", ...extraSources, ".next/types/**/*.ts"]
          : ["src", ...extraSources],
      exclude: ["node_modules", "dist"],
    },
    null,
    2,
  );
}
