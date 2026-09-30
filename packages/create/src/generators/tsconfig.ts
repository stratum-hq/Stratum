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
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        outDir: "dist",
        rootDir,
        declaration: true,
        skipLibCheck: true,
        esModuleInterop: true,
        ...(framework === "nestjs"
          ? { experimentalDecorators: true, emitDecoratorMetadata: true }
          : {}),
        ...(framework === "nextjs"
          ? { jsx: "preserve", plugins: [{ name: "next" }] }
          : {}),
      },
      include: ["src", ...extraSources],
      exclude: ["node_modules", "dist"],
    },
    null,
    2,
  );
}
