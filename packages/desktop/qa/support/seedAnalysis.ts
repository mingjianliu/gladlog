import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";

import {
  analysisCacheDoc,
  analysisCachePath,
} from "../../src/shared/analysisCache";

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
 * findings 可点。路径与信封都取自 src/shared/analysisCache —— 与主进程
 * 同源,避免「文件名/字段改了但播种侧没跟上」导致的静默未命中。
 */
export function seedAnalysis(
  userData: string,
  matchId: string,
  findings: SeedFinding[],
): void {
  const fp = analysisCachePath(join(userData, "matches"), matchId, "zh");
  mkdirSync(dirname(fp), { recursive: true });
  writeFileSync(
    fp,
    JSON.stringify(
      analysisCacheDoc("zh", {
        findings,
        dropped: 0,
        hadNarration: true,
        deepened: true,
      }),
    ),
    "utf-8",
  );
}
