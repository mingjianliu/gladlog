import type { StoredMatchMeta } from "../../../main/matchStore";

export type DashPeriod = "today" | "week" | "all";

export interface RatingPoint {
  t: number; // startTime ms
  rating: number;
}
export interface RatingSeries {
  bracket: string;
  points: RatingPoint[];
}
export interface CompRow {
  /** 敌方阵容签名:specId 升序;仅富行(有 teams)。 */
  specIds: number[];
  games: number;
  wins: number;
}
export interface ZoneRow {
  zoneId: string;
  games: number;
  wins: number;
}

export interface Dashboard {
  games: number;
  wins: number;
  /** 时长中位数(秒);无 durationS 的旧行不计。 */
  medianDurationS: number | null;
  ratingSeries: RatingSeries[];
  comps: CompRow[];
  zones: ZoneRow[];
  /** 无 teams 字段的旧行数(comp 表覆盖缺口提示)。 */
  legacyRows: number;
}

const isWin = (m: StoredMatchMeta): boolean => m.result.toLowerCase() === "win";

export function periodStart(period: DashPeriod, now: number): number {
  if (period === "all") return 0;
  if (period === "week") return now - 7 * 24 * 3600_000;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 战绩仪表盘聚合(纯函数;数据源 = 全量 meta 索引,零额外 IO)。
 * shuffle 行的 result 是整局结果,与普通对局同权计入。
 */
export function deriveDashboard(
  metas: StoredMatchMeta[],
  period: DashPeriod,
  now = Date.now(),
): Dashboard {
  const from = periodStart(period, now);
  const rows = metas
    .filter((m) => m.startTime >= from)
    .sort((a, b) => a.startTime - b.startTime);

  const wins = rows.filter(isWin).length;

  const durations = rows
    .map((m) => m.durationS)
    .filter((d): d is number => typeof d === "number")
    .sort((a, b) => a - b);
  const medianDurationS = durations.length
    ? durations[Math.floor(durations.length / 2)]!
    : null;

  const byBracket = new Map<string, RatingPoint[]>();
  for (const m of rows) {
    if (typeof m.avgRating !== "number" || m.avgRating <= 0) continue;
    const list = byBracket.get(m.bracket) ?? [];
    list.push({ t: m.startTime, rating: m.avgRating });
    byBracket.set(m.bracket, list);
  }
  const ratingSeries = [...byBracket.entries()]
    .map(([bracket, points]) => ({ bracket, points }))
    .filter((s) => s.points.length >= 2)
    .sort((a, b) => b.points.length - a.points.length);

  const compMap = new Map<string, CompRow>();
  let legacyRows = 0;
  for (const m of rows) {
    const foe = m.teams?.[1];
    if (!foe || foe.length === 0) {
      legacyRows++;
      continue;
    }
    const specIds = foe.map((p) => p.specId).sort((a, b) => a - b);
    const key = specIds.join("+");
    const row = compMap.get(key) ?? { specIds, games: 0, wins: 0 };
    row.games++;
    if (isWin(m)) row.wins++;
    compMap.set(key, row);
  }
  const comps = [...compMap.values()].sort(
    (a, b) => b.games - a.games || b.wins - a.wins,
  );

  const zoneMap = new Map<string, ZoneRow>();
  for (const m of rows) {
    const row = zoneMap.get(m.zoneId) ?? {
      zoneId: m.zoneId,
      games: 0,
      wins: 0,
    };
    row.games++;
    if (isWin(m)) row.wins++;
    zoneMap.set(m.zoneId, row);
  }
  const zones = [...zoneMap.values()].sort((a, b) => b.games - a.games);

  return {
    games: rows.length,
    wins,
    medianDurationS,
    ratingSeries,
    comps,
    zones,
    legacyRows,
  };
}
