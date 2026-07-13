import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 本地 UI 试验台:纯浏览器渲染 report 组件 + 真实/合成 fixture,免 Electron。
// 见 dev/README.md。启动:npm run dev:ui (在 packages/desktop 下)。
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: { port: 5199, open: false, host: true },
});
