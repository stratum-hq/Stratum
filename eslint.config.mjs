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
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      // BASELINE DOWNGRADES. Tracked by issue #164.
      // ESLint arrived after ~300 source files did, so these rules already have
      // violations on the current tree. They are warnings so the gate can go
      // green without a mass rewrite; #164 clears the backlog and promotes them
      // back to error. Counts are as of the baseline run on 2026-07-24. Every
      // other rule sits at its upstream severity and fires zero times today, so
      // new code is gated.
      "@typescript-eslint/no-explicit-any": "warn", // 108 hits
      "@typescript-eslint/ban-ts-comment": "warn", // 1 hit
      "no-useless-escape": "warn", // 1 hit
      "prefer-const": "warn", // 1 hit
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
