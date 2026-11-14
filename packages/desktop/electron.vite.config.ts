import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "path";

// Big JSON goes through JSON.parse instead of an object literal.
// spellNames.json has 410k keys; compiled into a JS object literal V8 has to
// parse it as **source code**, which was measured to block first paint for ~22s,
// while JSON.parse of the same data takes 42ms. Vite 5 defaults this to false,
// so it must be enabled explicitly for all three build targets — both main and
// renderer pull this data in through the analysis package.
const json = { stringify: true } as const;

export default defineConfig({
  main: {
    json,
    // Every @gladlog/* workspace package must be excluded: their package.json
    // main points at src/index.ts (TS source), and externalizeDepsPlugin
    // externalizes declared dependencies into runtime requires by default —
    // requiring a .ts file from the packaged output crashes and the window never
    // opens (E2E wiped out). On 2026-08-01, adding the analysis/parser-compat
    // dependency declarations to desktop missed exactly this spot, so all of
    // them are listed here; do not leave only parser.
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          "@gladlog/parser",
          "@gladlog/parser-compat",
          "@gladlog/analysis",
        ],
      }),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          worker: resolve(__dirname, "src/worker/index.ts"),
          // Self-healing worker (spawned by worker_threads from a file path;
          // with doc bytes passed through directly, main no longer parses the
          // doc — all the slimming of old fat archives happens here)
          slimWorker: resolve(__dirname, "src/main/slimWorker.ts"),
          // perf-1 sidecar builder (worker_threads, spawned from a file path)
          roundsIdxWorker: resolve(__dirname, "src/main/roundsIdxWorker.ts"),
        },
      },
    },
  },
  preload: {
    json,
    // parser, same as main: must be bundled in (preload consumes the slim
    // predicates through shared/slimDoc; externalizing means the packaged output
    // cannot require the workspace package).
    // Every @gladlog/* workspace package must be excluded: their package.json
    // main points at src/index.ts (TS source), and externalizeDepsPlugin
    // externalizes declared dependencies into runtime requires by default —
    // requiring a .ts file from the packaged output crashes and the window never
    // opens (E2E wiped out). On 2026-08-01, adding the analysis/parser-compat
    // dependency declarations to desktop missed exactly this spot, so all of
    // them are listed here; do not leave only parser.
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          "@gladlog/parser",
          "@gladlog/parser-compat",
          "@gladlog/analysis",
        ],
      }),
    ],
    build: {
      rollupOptions: {
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    json,
    plugins: [react()],
    root: "src/renderer",
    // electron-vite defaults renderer to minify:false (designed for debugging
    // main/preload, with renderer swept along) — the production bundle was
    // 3.6MB unminified and the CSS blocked rendering too; meanwhile the
    // firstPaint budget runs against the dev/vite build (esbuild minify by
    // default), so the two must measure the same thing.
    build: { minify: "esbuild" },
    // The report's derive worker (report/derive/offThread) is a module
    // worker: it shares chunks with the page and the game data module uses
    // top-level await, neither of which the default iife worker format allows.
    worker: { format: "es" },
    // Explicitly inject the shell's VITE_FIXTURE_MODE into the renderer
    // (otherwise electron-vite does not expose it and the fixture branch is
    // eliminated as dead code). VITE_FIXTURE_MODE=1 npm run dev gives a preview
    // without real data.
    define: {
      "import.meta.env.VITE_FIXTURE_MODE": JSON.stringify(
        process.env.VITE_FIXTURE_MODE ?? "",
      ),
    },
  },
});
