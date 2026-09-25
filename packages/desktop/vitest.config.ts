import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // Big JSON through JSON.parse, not an object literal — the same setting
  // electron.vite.config.ts uses for the production bundle; vitest reads this
  // file instead and Vite 5 defaults it to false, so every isolated worker
  // was parsing spellNames.json as source. See packages/analysis/vitest.config.ts.
  json: { stringify: true },
  test: {
    globals: true,
    // Now that the large data tables load in the background, an import no longer
    // guarantees readiness — the setup file waits for them (ensure.ts)
    setupFiles: ["./vitest.setup.ts"],
    // GH #26: paired with asyncUtilTimeout in vitest.setup.ts
    testTimeout: 20_000,
    // qa/ is Playwright's territory: *.spec.ts is run by playwright, vitest must
    // not touch it
    exclude: [...configDefaults.exclude, "qa/**"],
    // include only src/**: out/ (build output), dev/ (the test bed) and scripts/
    // stay out of the denominator, or a 90k-line bundle drags line coverage from
    // ~80% down to 9% (measured in the 2026-07-25 audit).
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      include: ["src/**"],
      exclude: ["src/**/*.d.ts", "src/**/*.test.ts"],
    },
  },
});
