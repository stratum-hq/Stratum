import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Flat config for the whole monorepo. Each package runs `eslint .` from its own
// directory and ESLint walks up to find this file, so there is exactly one
// ruleset for all 16 packages plus examples/, landing/ and website/.
//
// Deliberately NOT type-aware (no projectService, no *-type-checked configs).
// Type errors are `npm run typecheck`'s job; keeping lint parse-only means
// `turbo lint` does not have to build the dependency graph first.
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/.astro/**",
      "scripts/generated/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Codify the `_` prefix the codebase already uses for deliberately unused
      // bindings (_reply, _tenantSlug, _preset, _msg).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      // Promoted back to error by issue #164 once the baseline backlog was
      // cleared. `prefer-const` is not enabled by the recommended presets, so it
      // is set here explicitly; the others restate their upstream error severity
      // so the intent is visible at the rule site.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "no-useless-escape": "error",
      "prefer-const": "error",
    },
  },
  {
    // Astro generates `/// <reference path="../.astro/types.d.ts" />` into
    // env.d.ts and there is no import-style equivalent. Triple-slash references
    // are the idiomatic form in declaration files.
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },
);
