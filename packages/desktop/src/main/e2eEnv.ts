import { isAbsolute } from "path";

/**
 * E2E 模式下的 userData 目录。开关只做一件事:把状态目录挪到临时路径,
 * 让端到端测试跑在干净、可丢弃的状态上。
 *
 * 开启却没给合法路径时**抛错而不是回落** —— 静默用真实 userData 会让
 * 测试污染用户数据。
 */
export function e2eUserDataDir(env: NodeJS.ProcessEnv): string | null {
  if (env["GLADLOG_E2E"] !== "1") return null;
  const dir = env["GLADLOG_E2E_USER_DATA"];
  if (!dir || !isAbsolute(dir)) {
    throw new Error(
      "GLADLOG_E2E=1 需要 GLADLOG_E2E_USER_DATA 指向一个绝对路径",
    );
  }
  return dir;
}
