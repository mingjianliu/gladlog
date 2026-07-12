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
  prettier,
);
