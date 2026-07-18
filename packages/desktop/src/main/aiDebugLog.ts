/**
 * AI 调用调试环形日志(开发者页用):最近 10 次 analysis/compare 的
 * prompt 与原始返回文本。只存内存,不落盘(prompt 含对局细节)。
 */
export interface AiDebugEntry {
  kind: "analysis" | "compare";
  matchId: string;
  at: number;
  model: string;
  prompt: string;
  raw: string;
}

const MAX = 10;
const entries: AiDebugEntry[] = [];

export function recordAiDebug(e: AiDebugEntry): void {
  entries.unshift(e);
  if (entries.length > MAX) entries.pop();
}

export function listAiDebug(): AiDebugEntry[] {
  return [...entries];
}
