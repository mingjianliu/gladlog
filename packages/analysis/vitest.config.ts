import { defineConfig } from "vitest/config";
export default defineConfig({
  // Same reason as desktop's electron.vite.config.ts: spellNames.json (12 MB,
  // 410k keys) as a JS object literal is parsed as source code; as a
  // JSON.parse string it is ~500× faster. Vite 5 defaults this to false, and
  // every isolated test worker re-evaluates the module (measured 2026-09-25,
  // 8 isolated files: setup 70–76 s → see commit for the after number).
  json: { stringify: true },
  test: {
    globals: true,
    // Once the big data tables load in the background, an import no longer
    // guarantees readiness — the setup file waits for them (ensure.ts)
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      include: ["src/**"],
      exclude: ["src/**/*.d.ts", "src/**/*.test.ts"],
    },
  },
});
