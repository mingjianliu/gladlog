import { readdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";

/** 打包产物入口。相对本文件解析,免得受 cwd 影响。 */
export const MAIN_ENTRY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../out/main/index.js",
);

/** 首屏就绪的宽限:应用冷启动实测 ~24s(spellNames 12MB 顶层 await)。 */
export const BOOT_TIMEOUT_MS = 60_000;

export async function launchApp(
  userData: string,
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: { ...process.env, GLADLOG_E2E: "1", GLADLOG_E2E_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  return { app, page };
}

export function matchRows(page: Page): Locator {
  return page.locator("[data-testid=match-list] li:not(.mlr-group)");
}

/** 打桩原生对话框 → 点导入 → 等第一行入列。 */
export async function importLog(
  app: ElectronApplication,
  page: Page,
  logPath: string,
): Promise<void> {
  await expect(page.getByTestId("onboard")).toBeVisible({
    timeout: BOOT_TIMEOUT_MS,
  });
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
  }, logPath);
  await page.getByRole("button", { name: "导入历史日志…" }).click();
  await expect(matchRows(page).first()).toBeVisible({
    timeout: BOOT_TIMEOUT_MS,
  });
}

/** 入库后的 matchId(目录名)。播种分析缓存要用它。
 *
 *  直接在测试进程里读盘 —— userData 本来就是测试自己建的临时目录。
 *  别用 app.evaluate 进主进程读:那个求值上下文没有动态 import 回调,
 *  `await import("fs")` 会抛 "A dynamic import callback was not specified"。 */
export function firstMatchId(userData: string): string {
  const dir = join(userData, "matches");
  const entries = readdirSync(dir).filter((n) => !n.startsWith("."));
  const id = entries[0];
  if (!id) throw new Error(`${dir} 下没有入库的对局`);
  return id;
}

/** 打开第一场对局的 AI 分析视图 —— 两个 spec 共用的入口动作。 */
export async function openAiView(page: Page): Promise<void> {
  await expect(matchRows(page).first()).toBeVisible({
    timeout: BOOT_TIMEOUT_MS,
  });
  await matchRows(page).first().click();
  await page.getByRole("button", { name: "AI 分析" }).click();
}
