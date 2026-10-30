import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import { readdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

/** Entry point of the packaged output. Resolved relative to this file so cwd
 * cannot affect it. */
export const MAIN_ENTRY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../out/main/index.js",
);

/** Grace period for first-screen readiness: a cold start measures ~2s (after the
 *  2026-07-19 switch of big JSON to JSON.parse; before that it was ~25s). 15s
 *  leaves ample headroom for slow CI runners. */
export const BOOT_TIMEOUT_MS = 15_000;

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

/** Stub the native dialog → click import → wait for the first row to appear. */
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

/** The matchId (directory name) after storage. Needed to seed the analysis cache.
 *
 *  Read from disk directly in the test process — userData is a temp directory the
 *  test created itself. Do not read it through app.evaluate in the main process:
 *  that evaluation context has no dynamic import callback, so `await
 *  import("fs")` throws "A dynamic import callback was not specified". */
export function firstMatchId(userData: string): string {
  const dir = join(userData, "matches");
  const entries = readdirSync(dir).filter((n) => !n.startsWith("."));
  const id = entries[0];
  if (!id) throw new Error(`${dir} 下没有入库的对局`);
  return id;
}

/** Open the AI analysis view of the first match — the entry action shared by two specs. */
export async function openAiView(page: Page): Promise<void> {
  await expect(matchRows(page).first()).toBeVisible({
    timeout: BOOT_TIMEOUT_MS,
  });
  await matchRows(page).first().click();
  await page.getByRole("button", { name: "AI 分析" }).click();
}
