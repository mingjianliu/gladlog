import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/release/**",
      "**/coverage/**",
      "**/*.d.ts",
      "scratch/**",
      "**/dist-app/**",
      "**/dist-ui/**",
      ".claude/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "simple-import-sort": simpleImportSort,
      "react-hooks": reactHooks,
    },
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
      "simple-import-sort/imports": "warn",
      "simple-import-sort/exports": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Real-bug rules stay `error`; the following match this codebase's
      // deliberate style rather than churn working code (spec: don't
      // mass-rewrite unrelated logic):
      // - `any` is used intentionally at parser/compat boundaries → warn.
      // - `interface X extends Y {}` is a real pattern here (Finding).
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": [
        "error",
        { allowInterfaces: "with-single-extends" },
      ],
    },
  },
  {
    // The parser, the corpus validator, and tests legitimately match control
    // chars (\x00, CRLF) in raw combat-log / corpus bytes; keep no-control-regex
    // on for other source so a stray control char in an ordinary regex is caught.
    files: ["packages/parser/**", "packages/corpus-tools/**", "**/*.test.ts"],
    rules: { "no-control-regex": "off" },
  },
  {
    // Operational logging is legitimate in build scripts, CLI entrypoints, and
    // the Electron main process; keep `no-console` for library/renderer code.
    files: [
      "**/scripts/**",
      "**/*[Cc]li.ts",
      "**/*.bench.ts",
      "packages/desktop/src/main/**",
      "packages/desktop/scripts/**",
    ],
    rules: { "no-console": "off" },
  },
  {
    // `.cjs` files are CommonJS (e.g. electron-builder hooks loaded via require);
    // require() is the correct import form there.
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-console": "off",
    },
  },
  {
    // GH #117: the renderer and preload run in the browser context, so a deep
    // import of a Node-only workspace module there breaks the app — today only
    // the production build catches it. Deep `@gladlog/*/src/...` imports are
    // allowed only for the modules below, each checked to be pure (no Node
    // import). Adding one = checking it, then adding it here. Module level on
    // purpose: a subtree exception would admit future unsafe modules.
    files: [
      "packages/desktop/src/renderer/**",
      "packages/desktop/src/preload/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex:
                "^@gladlog/(?!analysis/src/(?:data/specNames|data/datagen-manifest\\.json|compare/claimChecker|learning/(?:distillRules|matchRules|patternScan|types)|context/matchNarrative|utils/rawStreams)$)[^/]+/src/",
              message:
                "Renderer/preload may deep-import only pure workspace modules listed in eslint.config.js (GH #117). Check the module has no Node import, then add it to the list.",
            },
          ],
        },
      ],
    },
  },
  prettier,
);
