import type { AnalysisFallbackReason } from "../../../../shared/analysisFallback";

/**
 * The sentence the analysis panel shows under the key-moment axis when a
 * result has no findings — one per reason, so a 0-finding result says why.
 * Chinese like the rest of the panel's own text (the coach-reply language
 * reaches the model's findings, not the panel).
 *
 * `empty-reply` is a fresh analysis that ran and wrote nothing; before it had
 * its own value it fell to the last branch and read as a stale cache. That
 * branch is unchanged: a result with no reason and nothing dropped is a cache
 * from before the field existed.
 */
export function zeroFindingText(r: {
  dropped: number;
  fallbackReason?: AnalysisFallbackReason;
}): string {
  if (r.dropped > 0)
    return `模型输出了 ${r.dropped} 条,但全部未通过审计(裸数字/编造事件/因果断言)被丢弃 —— 可点「重新分析」再试。`;
  switch (r.fallbackReason) {
    case "no-candidates":
      return "本场无可指摘事件(无人阵亡、资源使用无明显问题)—— 这是好事,不硬编教练意见。";
    case "no-client":
      return "未配置 AI(设置里填 API key 或本地 CLI 后端),仅展示确定性事件。";
    case "bad-json":
      return "模型返回格式异常,已回退为确定性展示 —— 可点「重新分析」再试。";
    case "empty-reply":
      return "分析已完成:模型看过本场的候选事件,没有哪一件值得写成教练意见 —— 时间线与各项统计照常可看。";
    default:
      return "未生成解说(旧版本缓存),点「重新分析」重新生成。";
  }
}
