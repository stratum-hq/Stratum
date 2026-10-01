import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig.json excludes the tests, so the transform cannot read the decorator
  // settings from it. Nest needs legacy decorators and their metadata.
  oxc: {
    decorator: { legacy: true, emitDecoratorMetadata: true },
  },
  test: {
    include: ["src/__tests__/**/*.test.ts"],
  },
});
