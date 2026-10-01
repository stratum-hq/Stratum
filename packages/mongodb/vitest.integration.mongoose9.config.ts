import { defineConfig } from "vitest/config";
import base from "./vitest.integration.config.js";

// Run the Mongoose integration tests a second time, against Mongoose 9.
// The devDependency "mongoose9" is an npm alias for mongoose@9, and
// "mongoose" stays on 8 for the first run. The plugin does not import
// mongoose, so this alias changes the version for the tests and the plugin.
// mergeConfig() would concatenate the include lists, so this config sets them.
export default defineConfig({
  resolve: {
    alias: [{ find: /^mongoose$/, replacement: "mongoose9" }],
  },
  test: {
    ...base.test,
    include: [
      "src/__tests__/integration/mongoose-plugin.integration.test.ts",
      "src/__tests__/integration/scope-boundaries.integration.test.ts",
      "src/__tests__/integration/test-utils-assertion.integration.test.ts",
      "src/__tests__/integration/watch-deletes.integration.test.ts",
    ],
  },
});
