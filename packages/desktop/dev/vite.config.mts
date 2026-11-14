import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { VISUAL_PORT } from "./ports";
import { reviewApiPlugin } from "./review/reviewApi";

// Local UI test bed: renders the report components in a plain browser with
// real/synthetic fixtures, no Electron needed.
// See dev/README.md. Start with: npm run dev:ui (from packages/desktop).
// Visual regression (qa/visual) runs build + preview rather than the dev
// server: in dev mode every new page re-fetches hundreds of unbundled ESM
// modules, ~24s per page and impossible to amortize (a warm server-side cache
// does not help; the cost is the request waterfall on the browser side). The
// same page takes <1s once bundled, and the screenshots contain no
// HMR/react-refresh artifacts that only exist in dev.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), reviewApiPlugin()],
  server: { port: VISUAL_PORT, open: false, host: true },
  preview: { port: VISUAL_PORT, strictPort: true },
  // target=esnext: the game data module uses top-level await, which the
  // default target rejects. The test bed only runs in modern Chromium
  // (Playwright's bundled browser / the local browser), so no backwards
  // compatibility is needed.
  build: { outDir: "dist-ui", emptyOutDir: true, target: "esnext" },
  // Big JSON goes through JSON.parse rather than an object literal:
  // spellNames.json has 410k keys, and compiling it into a JS object literal
  // makes V8 parse it as source code (measured: ~22s blocking first paint),
  // while JSON.parse on the same data takes 42ms. Vite 5 defaults this to
  // false, so it must be turned on explicitly.
  json: { stringify: true },
  // same worker format as the app (electron.vite.config.ts)
  worker: { format: "es" },
});
