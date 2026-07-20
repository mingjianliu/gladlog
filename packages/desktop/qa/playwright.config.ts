// 基线是 linux 单源,由 CI 生成与判定(.github/workflows/test.yml 的
// frontend-qa job + visual-baseline workflow)。本机只跑
// npm run test:visual:smoke —— 它带 --ignore-snapshots,不比对也不写基线;
// 直跑 test:visual 会在基线缺失时写入 mac 截图,污染单源。

import { defineConfig, devices } from "@playwright/test";

import { isE2EOnlyRun } from "./argv";
import { VISUAL_PORT as PORT } from "../dev/ports";

export default defineConfig({
  testDir: ".",
  // 单条用例的总预算。必须显著大于 qa/visual/scenes.spec.ts 的 BOOT_TIMEOUT_MS ——
  // Playwright 的 per-test 默认预算只有 30s,而报表页首屏本身就要 ~24s
  // (spellNames.json 12MB 顶层 await,详见该文件注释)。默认值下 CI 只要比
  // 本机慢一点,用例就会先被 30s 砍掉,断言级的超时根本轮不到生效。
  timeout: 120_000,
  // 运行产物留在 qa/ 内,与 .gitignore 的两条规则对齐
  outputDir: "test-results",
  // 基线单源:路径里**不含 {platform}** —— linux 一套基线即唯一标准。
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFileName}/{arg}{ext}",
  fullyParallel: false,
  // workers=1:两个性能预算(firstPaint / coldStart)与其它用例抢同一台机器
  // 时,测出来的是争用而不是性能。全套跑完只要几十秒,串行的代价远小于
  // 「预算数字不可信」的代价。
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  reporter: process.env["CI"]
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  expect: {
    // 容差只吸收抗锯齿噪声,不用来放水。
    //
    // 这两个数字是**实测校准**出来的,别凭感觉调:
    //
    // 1) threshold 是每像素的 YIQ 颜色距离容忍。默认 0.2 太松 —— 把主题色
    //    --win 从 #7ac9a3 改成 #22cc55(胜负文字、评分曲线全变色),两色亮度
    //    接近,每个像素的距离都够不到 0.2,于是「零个像素算作不同」,再小的
    //    maxDiffPixels 也拦不住。CI 上实证:0.2 绿灯、0.05 报红。
    // 2) maxDiffPixels 是允许多少像素越过该距离。用绝对数而不是
    //    maxDiffPixelRatio:整页截图动辄 1280×1300,比例 0.01 等于放行 16000+
    //    像素,小面积的真实改动永远达不到。
    //
    // 守不住的门比没有门更坏 —— 它给的是虚假的安全感。改这两个值之前,
    // 先用「故意改一处配色,看 CI 是否报红」验证一遍。
    toHaveScreenshot: { threshold: 0.05, maxDiffPixels: 100 },
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
  // e2e project 驱动的是打包好的 Electron 应用,压根不需要这个测试台服务器 ——
  // 无条件起会白等一次构建,还会在本机已有 preview 时撞端口。
  webServer: isE2EOnlyRun(process.argv)
    ? undefined
    : {
        // 打包后再 preview,不用 dev server:dev 模式每开一个新页面都要重新
        // 拉取上百个未打包 ESM 模块(实测单页 ~24s,服务端缓存热了也没用 ——
        // 成本在浏览器侧的请求瀑布)。打包一次 ~5s,之后每页 <1s,且截图里
        // 没有 HMR/react-refresh 这类只存在于 dev 的东西。
        command: "npm run build:ui && npm run preview:ui",
        cwd: "..",
        url: `http://localhost:${PORT}`,
        reuseExistingServer: false,
        timeout: 180_000,
      },
});
