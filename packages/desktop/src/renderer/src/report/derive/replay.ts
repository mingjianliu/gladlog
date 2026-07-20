import type { ReportSource } from "./types";

export interface ReplaySample {
  t: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

export interface ReplayTrack {
  unitId: string;
  name: string;
  classId: number;
  specId: number;
  reaction: string;
  /** 升序样本;至少 1 条。 */
  samples: ReplaySample[];
  /** 首个非昏迷死亡时刻(绝对 ms);null=未阵亡。 */
  deathT: number | null;
}

export interface ReplayBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ReplayData {
  startTime: number;
  endTime: number;
  bounds: ReplayBounds;
  tracks: ReplayTrack[];
}

const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;

/**
 * 从 advancedSamples 提取每个玩家的位置轨迹(2D 回放数据)。
 * 只含有坐标样本的玩家单位;bounds 为所有样本坐标的包围盒。
 */
export function deriveReplay(m: ReportSource): ReplayData {
  const tracks: ReplayTrack[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const u of Object.values(m.units)) {
    if (u.kind !== "Player") continue;
    const samples: ReplaySample[] = [...u.advancedSamples]
      .filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y))
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((s) => ({
        t: s.timestamp,
        x: s.x,
        y: s.y,
        hp: s.hp,
        maxHp: s.maxHp,
      }));
    if (samples.length === 0) continue;
    for (const s of samples) {
      if (s.x < minX) minX = s.x;
      if (s.x > maxX) maxX = s.x;
      if (s.y < minY) minY = s.y;
      if (s.y > maxY) maxY = s.y;
    }
    const death = u.deaths.find((d) => !d.unconscious);
    tracks.push({
      unitId: u.id,
      name: u.name,
      classId: u.classId,
      specId: u.specId,
      reaction: u.reaction,
      samples,
      deathT: death ? death.timestamp : null,
    });
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 1;
    minY = 0;
    maxY = 1;
  }

  return {
    startTime: m.startTime,
    endTime: m.endTime,
    bounds: { minX, maxX, minY, maxY },
    tracks,
  };
}

/**
 * 某时刻(绝对 ms)单位的插值位置/血量。
 * null = 此刻不显示(已阵亡)。首/尾样本外按端点钳制。
 */
export function sampleAt(
  track: ReplayTrack,
  t: number,
): { x: number; y: number; hp: number; maxHp: number } | null {
  const s = track.samples;
  if (s.length === 0) return null;
  if (track.deathT != null && t >= track.deathT) return null;
  const first = s[0]!;
  if (t <= first.t)
    return { x: first.x, y: first.y, hp: first.hp, maxHp: first.maxHp };
  const last = s[s.length - 1]!;
  if (t >= last.t)
    return { x: last.x, y: last.y, hp: last.hp, maxHp: last.maxHp };
  let hi = 1;
  while (hi < s.length && s[hi]!.t < t) hi++;
  const a = s[hi - 1]!;
  const b = s[hi]!;
  const f = (t - a.t) / (b.t - a.t || 1);
  return {
    x: lerp(a.x, b.x, f),
    y: lerp(a.y, b.y, f),
    hp: lerp(a.hp, b.hp, f),
    maxHp: lerp(a.maxHp, b.maxHp, f),
  };
}

/**
 * 截至时刻 t 的走位轨迹点(最近 windowMs 窗口内),用于画移动尾迹。
 * 阵亡则冻结在死亡时刻。空轨迹返回 []。
 */
export function pathUpTo(
  track: ReplayTrack,
  t: number,
  windowMs = 6000,
): Array<{ x: number; y: number }> {
  const s = track.samples;
  if (s.length === 0) return [];
  const cut = track.deathT != null ? Math.min(t, track.deathT) : t;
  const from = cut - windowMs;
  const pts: Array<{ x: number; y: number }> = [];
  for (const p of s) {
    if (p.t < from) continue;
    if (p.t > cut) break;
    pts.push({ x: p.x, y: p.y });
  }
  const cur = sampleAt(track, cut);
  if (cur) pts.push({ x: cur.x, y: cur.y });
  return pts;
}

/** 单位的死亡位置(死亡时刻前最后一个样本);未阵亡或无样本返回 null。 */
export function deathPosition(
  track: ReplayTrack,
): { x: number; y: number } | null {
  if (track.deathT == null || track.samples.length === 0) return null;
  let p = track.samples[0]!;
  for (const s of track.samples) {
    if (s.t <= track.deathT) p = s;
    else break;
  }
  return { x: p.x, y: p.y };
}

/**
 * t 时刻该单位的位置是否**有据可依**。
 *
 * 坐标只搭在特定几类战斗记录上(`*_DAMAGE` 记承伤方、`*_HEAL` 记被治疗者、
 * `SPELL_CAST_SUCCESS` 记施法者),而**跑动不产生任何战斗日志记录**。所以
 * 开局一个人只是在跑、没施法也没被打没被治,日志里关于他一条记录都没有 ——
 * 实测真实局里首样本最晚到 +14.2s,某个 shuffle 轮里六个人全部晚于 +4.4s。
 *
 * 这段空窗里 `sampleAt` 会把位置钉在**首样本**上(它是唯一有的坐标),于是
 * 画面把人画在「他第一次卷进战斗的地方」——通常离起跑点隔了大半个场地。
 * 渲染层必须用本谓词把那段时间标成「位置未知」,而不是当作确定位置画。
 *
 * 谓词单源:渲染与测试共用本函数,别在组件里重写 `t >= samples[0].t`。
 */
export function positionKnownAt(track: ReplayTrack, t: number): boolean {
  const first = track.samples[0];
  if (!first) return false;
  if (track.deathT != null && t >= track.deathT) return false;
  return t >= first.t;
}
