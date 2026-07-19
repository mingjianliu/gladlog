import type { StoredMatchMeta } from "../../src/main/matchStore";
import { installFixtureBridge } from "../../src/renderer/src/fixtureBridge";

/** 固定基准时刻(2026-07-19T12:00:00Z)。视觉回归会用 Playwright 的
 *  clock.setFixedTime 把 Date.now() 钉在同一时刻,两边必须一致,
 *  否则「今天/昨天」分组与仪表盘周期会随真实时间漂移 → 截图 flaky。 */
export const FIXED_NOW = Date.UTC(2026, 6, 19, 12, 0, 0);

const HOUR = 3_600_000;
const DAY = 86_400_000;

const BRACKETS = ["3v3", "3v3", "2v2", "Solo Shuffle"] as const;

/** 12 场确定性对局:跨 3 天、含胜负与评分涨跌,足以覆盖列表分组与仪表盘曲线。 */
export const DEMO_METAS: StoredMatchMeta[] = Array.from(
  { length: 12 },
  (_, i) => {
    const startTime = FIXED_NOW - Math.floor(i / 4) * DAY - (i % 4) * HOUR;
    return {
      id: `demo-${i}`,
      kind: "match" as const,
      bracket: BRACKETS[i % BRACKETS.length]!,
      zoneId: "1505",
      startTime,
      endTime: startTime + 180_000,
      result: i % 3 === 0 ? "Loss" : "Win",
      storedAt: startTime + 200_000,
      playerName: "Demo",
      playerRating: 1800 + i * 7,
    } as StoredMatchMeta;
  },
);

/** 装 fixture bridge,并把比赛列表换成确定性数据。 */
export function installAppShellFixture(): void {
  installFixtureBridge();
  const api = window.__gladlogFixture;
  if (!api) throw new Error("installFixtureBridge 未挂载 __gladlogFixture");
  const matches = api.matches as unknown as {
    list: () => Promise<StoredMatchMeta[]>;
    page: (o: { before?: number; limit: number }) => Promise<StoredMatchMeta[]>;
  };
  matches.list = async () => DEMO_METAS;
  matches.page = async (o) =>
    DEMO_METAS.filter((m) => o.before == null || m.startTime < o.before)
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, o.limit);
}
