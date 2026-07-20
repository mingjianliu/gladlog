import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { VISUAL_PORT } from "./ports";

// 本地 UI 试验台:纯浏览器渲染 report 组件 + 真实/合成 fixture,免 Electron。
// 见 dev/README.md。启动:npm run dev:ui (在 packages/desktop 下)。
// 视觉回归(qa/visual)跑的是 build + preview 而不是 dev server:dev 模式
// 每个新页面都要重新拉取上百个未打包的 ESM 模块,单页 ~24s 且无法摊销
// (服务端缓存热了也没用,成本在浏览器侧的请求瀑布)。打包后同一页 <1s,
// 且截图里没有 HMR/react-refresh 这类只存在于 dev 的东西。
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: { port: VISUAL_PORT, open: false, host: true },
  preview: { port: VISUAL_PORT, strictPort: true },
  // target=esnext:游戏数据模块用了顶层 await,默认 target 会拒绝。试验台只
  // 在现代 Chromium(Playwright 自带 / 本机浏览器)里跑,不需要向下兼容。
  build: { outDir: "dist-ui", emptyOutDir: true, target: "esnext" },
  // 大 JSON 走 JSON.parse 而不是对象字面量:spellNames.json 有 41 万个键,
  // 编译成 JS 对象字面量要 V8 当源码解析(实测阻塞首屏 ~22s),而同样的
  // 数据 JSON.parse 只要 42ms。Vite 5 的默认值是 false,必须显式打开。
  json: { stringify: true },
});
