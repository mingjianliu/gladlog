import { defineConfig } from "vitest/config";
export default defineConfig({
  // Big JSON through JSON.parse, not an object literal — the tests import
  // @gladlog/analysis, which pulls in spellNames.json (12 MB). See
  // packages/analysis/vitest.config.ts.
  json: { stringify: true },
  test: {
    globals: true,
  },
});
