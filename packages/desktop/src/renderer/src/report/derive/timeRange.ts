/**
 * 时间窗联动(第四阶段①)的共享谓词 —— 全部窗口判定从这里出,别在各 derive
 * 里手搓比较(谓词单源)。窗口语义:
 *  - 瞬时事件(damage/heal/absorb/cast):timestamp ∈ [from, to] 计入;
 *  - 时长事实(CC 段):按与窗口的重叠秒数计入(跨界不整段消失也不整段计入);
 *  - 速率分母:窗口时长,不是全场时长。
 */

export interface TimeRange {
  fromS: number;
  toS: number;
}

export const rangeDurationS = (
  m: { startTime: number; endTime: number },
  range?: TimeRange | null,
): number =>
  range
    ? Math.max(1e-6, range.toS - range.fromS)
    : Math.max(1e-6, (m.endTime - m.startTime) / 1000);

/** 瞬时事件过滤谓词;range 为空时恒真。无 timestamp 的事件计入(parser 事件
 * 均带 timestamp,此分支只防御性兜底 —— 宁可窗口口径略宽也不静默丢整类)。 */
export const eventInRange = (
  m: { startTime: number },
  range?: TimeRange | null,
): ((e: { timestamp?: number }) => boolean) => {
  if (!range) return () => true;
  const fromMs = m.startTime + range.fromS * 1000;
  const toMs = m.startTime + range.toS * 1000;
  return (e) =>
    e.timestamp === undefined || (e.timestamp >= fromMs && e.timestamp <= toMs);
};

/** 相对秒时刻是否在窗口内(事实层过滤用)。 */
export const tInRange = (tS: number, range?: TimeRange | null): boolean =>
  !range || (tS >= range.fromS && tS <= range.toS);

/** 时长事实与窗口的重叠秒数(range 为空 = 全长)。 */
export const overlapSeconds = (
  fromS: number,
  durationS: number,
  range?: TimeRange | null,
): number => {
  if (!range) return durationS;
  const from = Math.max(fromS, range.fromS);
  const to = Math.min(fromS + durationS, range.toS);
  return Math.max(0, to - from);
};
