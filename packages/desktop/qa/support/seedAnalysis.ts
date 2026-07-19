import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

import { PROMPT_VERSION } from "../../src/shared/promptVersion";

export type SeedFinding = {
  eventIds: string[];
  severity: "high" | "med" | "low";
  category: string;
  title: string;
  explanation: string;
  /** 深挖块。chips 带**显式时刻**,点击走 onJumpT 直接 seek ——
   *  不像「回放此刻」按钮那样要拿 eventIds 去候选事件里查(查不到就静默
   *  no-op,见 StructuredAnalysisPanel.handleJump)。播种的 finding 没有
   *  真实候选事件可对应,所以证据链跳转只能测 chip 这条路。 */
  deepDive?: {
    text: string;
    chips: Array<{ t: number; label: string; unitNames: string[] }>;
  };
};

/**
 * 把 canned 分析结果写进主进程读的那个缓存文件,让 E2E 不打真 API 也有
 * findings 可点。写入格式与 src/main/analysis.ts 的 finish() 完全一致 ——
 * 包括 promptVersion(不一致会被 getCached 丢弃,面板停在空闲态)。
 */
export function seedAnalysis(
  userData: string,
  matchId: string,
  findings: SeedFinding[],
): void {
  const dir = join(userData, "matches", matchId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "analysis-v2.zh.json"),
    JSON.stringify({
      schemaVersion: 1,
      promptVersion: PROMPT_VERSION,
      language: "zh",
      createdAt: Date.now(),
      result: { findings, dropped: 0, hadNarration: true, deepened: true },
    }),
    "utf-8",
  );
}
