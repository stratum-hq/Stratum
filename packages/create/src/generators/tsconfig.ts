import type { Framework } from "../matrix.js";

/**
 * Return the tsconfig.json content for a generated project.
 *
 * @param framework - The framework of the project. It adds the compiler options that the framework needs.
 */
export function generateTsconfig(framework: Framework): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ESNext",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        outDir: "dist",
        rootDir: "src",
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
      include: ["src"],
      exclude: ["node_modules", "dist"],
    },
    null,
    2,
  );
}
