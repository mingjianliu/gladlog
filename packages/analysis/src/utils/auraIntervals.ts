import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

/**
 * auraIntervals.ts —— 光环区间集(第四阶段④,WoWAnalyzer Auras 模式)。
 *
 * 把某单位身上的 aura 事件流(applied/refresh/removed/broken)配对成区间,
 * 供 uptime 条、时点查询等一切「这个 buff 什么时候在身上」的消费方使用。
 * 谓词单源:配对逻辑只此一处;现有 CC 路径(ccTrinketAnalysis)带 DR 语义
 * 暂不迁移,但**新增**消费方一律吃这里,不许再写第二套配对。
 *
 * 归一化留痕(WoWAnalyzer __fabricated 的对应物):推断出来的边界打标 ——
 *  - inferredStart:开局前就挂着(先见 REMOVED/REFRESH 而无 APPLIED),
 *    区间起点记为 0;
 *  - inferredEnd:到比赛结束仍未见 REMOVED,区间终点记为比赛时长。
 * 渲染方据此可以把推断段画成不同样式,而不是把推断当观测。
 */

export interface IAuraInterval {
  spellId: string;
  /** 英文名优先由消费方经 getEnglishSpellName 解析;这里存日志原文。 */
  spellName: string;
  srcUnitName: string;
  fromS: number;
  toS: number;
  inferredStart: boolean;
  inferredEnd: boolean;
}

const CLOSE_EVENTS = new Set<string>([
  LogEvent.SPELL_AURA_REMOVED,
  LogEvent.SPELL_AURA_BROKEN,
  LogEvent.SPELL_AURA_BROKEN_SPELL,
]);

/**
 * 该单位身上(dest = 本单位)全部 aura 的区间集,按 fromS 升序。
 *
 * 配对规则(每个 spellId 独立):
 *  - APPLIED 开一段;已开着再见 APPLIED(应为 REFRESH 的错报/叠层)不重开;
 *  - REFRESH 视为延续;若此前无开段 → 开局前已挂(inferredStart);
 *  - REMOVED/BROKEN/BROKEN_SPELL 收段;无开段的收段 → 开局前已挂(inferredStart);
 *  - 比赛结束仍开着 → 收在时长处(inferredEnd)。
 */
export function buildAuraIntervals(
  unit: ICombatUnit,
  combat: { startTime: number; endTime: number },
): IAuraInterval[] {
  const durationS = (combat.endTime - combat.startTime) / 1000;
  const rel = (ts: number) =>
    Math.min(durationS, Math.max(0, (ts - combat.startTime) / 1000));

  interface Open {
    fromS: number;
    inferredStart: boolean;
    spellName: string;
    srcUnitName: string;
  }
  const open = new Map<string, Open>();
  const out: IAuraInterval[] = [];

  const events = [...unit.auraEvents]
    .filter((a) => a.destUnitId === unit.id && a.spellId)
    .sort((a, b) => a.timestamp - b.timestamp);

  for (const a of events) {
    const id = a.spellId!;
    const ev = a.logLine.event as string;
    if (ev === LogEvent.SPELL_AURA_APPLIED) {
      if (!open.has(id)) {
        open.set(id, {
          fromS: rel(a.timestamp),
          inferredStart: false,
          spellName: a.spellName ?? "",
          srcUnitName: a.srcUnitName,
        });
      }
    } else if (ev === LogEvent.SPELL_AURA_REFRESH) {
      if (!open.has(id)) {
        open.set(id, {
          fromS: 0,
          inferredStart: true,
          spellName: a.spellName ?? "",
          srcUnitName: a.srcUnitName,
        });
      }
    } else if (CLOSE_EVENTS.has(ev)) {
      const o = open.get(id);
      if (o) {
        open.delete(id);
        out.push({
          spellId: id,
          spellName: o.spellName,
          srcUnitName: o.srcUnitName,
          fromS: o.fromS,
          toS: rel(a.timestamp),
          inferredStart: o.inferredStart,
          inferredEnd: false,
        });
      } else {
        // 开局前已挂,本场只看到它掉落
        out.push({
          spellId: id,
          spellName: a.spellName ?? "",
          srcUnitName: a.srcUnitName,
          fromS: 0,
          toS: rel(a.timestamp),
          inferredStart: true,
          inferredEnd: false,
        });
      }
    }
  }

  for (const [id, o] of open) {
    out.push({
      spellId: id,
      spellName: o.spellName,
      srcUnitName: o.srcUnitName,
      fromS: o.fromS,
      toS: durationS,
      inferredStart: o.inferredStart,
      inferredEnd: true,
    });
  }

  return out.sort(
    (a, b) => a.fromS - b.fromS || a.spellId.localeCompare(b.spellId),
  );
}
