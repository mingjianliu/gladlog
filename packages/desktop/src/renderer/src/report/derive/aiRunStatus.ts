import { isCliAiBackend } from "../../../../shared/aiModels";
import { type Language, translate } from "../../../../shared/i18n";

/**
 * 「分析中/对比中」状态行的纯函数(2026-08-05 生产反馈:CLI 后端假流式,
 * 一发分钟级、零中途信号,用户分不清「在跑」和「卡死」)。展示层的两个
 * 消费方(StructuredAnalysisPanel / ProComparisonVerified)共用这里,判
 * 「是不是 CLI 后端」走 shared 的 isCliAiBackend 单源谓词。
 */

/** 已耗秒数 → "m:ss"(小时级也只滚分钟——超时上限 300s,不会到小时)。 */
export function fmtElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * CLI 后端的等待说明;API 后端(真流式,有 delta 预览)返回 null 不显示。
 * 文案说的是机制(整段返回、无中途进度),不承诺具体时长上限——那由
 * TIMEOUT_MS 决定,超时会以 error 形态出面。
 */
export function cliWaitHint(
  backend: string | null | undefined,
  lang: Language,
): string | null {
  if (!backend || !isCliAiBackend(backend)) return null;
  return translate(lang, "report.aiRun.cliWaitHint");
}
