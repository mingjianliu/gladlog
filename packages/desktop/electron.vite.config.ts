import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@gladlog/parser"] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          worker: resolve(__dirname, "src/worker/index.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    plugins: [react()],
    root: "src/renderer",
    // 把 shell 的 VITE_FIXTURE_MODE 显式注入 renderer(否则 electron-vite 不暴露它,
    // fixture 分支会被当死代码消掉)。VITE_FIXTURE_MODE=1 npm run dev 即免真数据预览。
    define: {
      "import.meta.env.VITE_FIXTURE_MODE": JSON.stringify(
        process.env.VITE_FIXTURE_MODE ?? "",
      ),
    },
  },
});
