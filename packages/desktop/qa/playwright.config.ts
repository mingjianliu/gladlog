// 基线是 linux 单源,由 CI 生成与判定(.github/workflows/test.yml 的
// frontend-qa job + visual-baseline workflow)。本机只跑
// npm run test:visual:smoke —— 它带 --ignore-snapshots,不比对也不写基线;
// 直跑 test:visual 会在基线缺失时写入 mac 截图,污染单源。

import { defineConfig, devices } from "@playwright/test";

import { VISUAL_PORT as PORT } from "./ports";

export default defineConfig({
  testDir: ".",
  // 运行产物留在 qa/ 内,与 .gitignore 的两条规则对齐
  outputDir: "test-results",
  // 基线单源:路径里**不含 {platform}** —— linux 一套基线即唯一标准。
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFileName}/{arg}{ext}",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  reporter: process.env["CI"]
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  expect: {
    // 容差只吸收抗锯齿噪声,不用来放水
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },
  use: { trace: "retain-on-failure" },
  projects: [
    {
      name: "visual",
      testMatch: /visual\/.*\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        baseURL: `http://localhost:${PORT}`,
      },
    },
    {
      name: "e2e",
      testMatch: /e2e\/.*\.spec\.ts$/,
    },
  ],
  // 打包后再 preview,不用 dev server:dev 模式每开一个新页面都要重新拉取
  // 上百个未打包 ESM 模块(实测单页 ~24s,服务端缓存热了也没用 —— 成本在
  // 浏览器侧的请求瀑布)。打包一次 ~5s,之后每页 <1s,且截图里没有
  // HMR/react-refresh 这类只存在于 dev 的东西。
  webServer: {
    command: "npm run build:ui && npm run preview:ui",
    cwd: "..",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
