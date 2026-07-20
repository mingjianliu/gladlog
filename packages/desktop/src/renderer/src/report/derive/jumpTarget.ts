import type { CandidateEvent } from "@gladlog/analysis";

/** 证据链跳转目标:finding 引用的事件里最早的时刻 + 涉及的全部单位。 */
export interface JumpTarget {
  /** 相对开局的秒数 */
  t: number;
  unitNames: string[];
}

/**
 * 把 finding 的 eventIds 解析成回放跳转目标。
 *
 * 命中不到任何候选事件时返回 null —— 调用方据此**不跳转**(而不是跳到 0:00)。
 * 这条查表逻辑原本内联在 StructuredAnalysisPanel 里,没有任何测试覆盖:
 * 播种式的 E2E 用不上它(伪造的 eventIds 撞不上真实候选),所以它只能在
 * 这一层用单测锁住。
 */
export function resolveJumpTarget(
  candidates: readonly CandidateEvent[],
  eventIds: readonly string[],
): JumpTarget | null {
  const hits = candidates.filter((c) => eventIds.includes(c.id));
  if (hits.length === 0) return null;
  const earliest = hits.reduce((a, b) => (a.t <= b.t ? a : b));
  return {
    t: earliest.t,
    unitNames: [...new Set(hits.flatMap((e) => e.unitNames))],
  };
}
