import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // qa/ 是 Playwright 的地盘:*.spec.ts 由 playwright 跑,vitest 不许碰
    exclude: [...configDefaults.exclude, "qa/**"],
  },
});

