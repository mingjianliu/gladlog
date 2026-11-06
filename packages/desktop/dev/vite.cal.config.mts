import { resolve } from "node:path";

import { defineConfig } from "vite";

// The first-paint budget's same-run CPU normaliser (GH #145, dev/cpuCal.ts),
// built on its own AFTER the test bed into the same dist-ui (emptyOutDir
// off). A second input in vite.config.mts would make Vite move shared
// runtime (the modulepreload polyfill) out of the app's chunk, changing the
// very scenes the budget measures; a separate build leaves the app's output
// byte-identical.
export default defineConfig({
  root: import.meta.dirname,
  build: {
    outDir: "dist-ui",
    emptyOutDir: false,
    target: "esnext",
    rollupOptions: {
      input: { cpuCal: resolve(import.meta.dirname, "cpu-cal.html") },
    },
  },
});
