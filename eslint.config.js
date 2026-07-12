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
      // - the parser/tests legitimately match control chars (\x00, \n).
      // - `interface X extends Y {}` is a real pattern here (Finding).
      "@typescript-eslint/no-explicit-any": "warn",
      "no-control-regex": "off",
      "@typescript-eslint/no-empty-object-type": [
        "error",
        { allowInterfaces: "with-single-extends" },
      ],
    },
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
