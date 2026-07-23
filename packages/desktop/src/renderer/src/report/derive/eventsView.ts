import { getEnglishSpellName } from "@gladlog/analysis";

import { tInRange, type TimeRange } from "./timeRange";
import type { ReportSource } from "./types";

/**
 * events 视图(第四阶段②,WCL Events 的结构化过滤版 —— 不做表达式 DSL):
 * 把各单位事件数组摊平成统一行,供 类型/来源/目标/技能/时间窗 五维过滤。
 * 兼作 B2 溯源的落地容器:每行都是「源日志事件」粒度,▶ 可跳回放。
 */

export type EventKind =
  "damage" | "heal" | "cast" | "aura" | "dispel" | "interrupt" | "death";

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  damage: "伤害",
  heal: "治疗",
  cast: "施放",
  aura: "光环",
  dispel: "驱散",
  interrupt: "打断",
  death: "死亡",
};

export interface EventRow {
  tS: number;
  kind: EventKind;
  srcName: string;
  destName: string;
  spellId: string;
  spellName: string;
  /** 数额(伤害/治疗)或补充说明(打断了什么/驱掉了什么/光环增减)。 */
  detail: string;
}

export interface EventsFilter {
  kinds: EventKind[]; // 空 = 全部
  unitName: string | null; // 来源或目标匹配(短名)
  spellQuery: string; // 技能名子串(不区分大小写)
  range: TimeRange | null; // 时间窗(与全局时间窗联动共用类型)
}

export const EMPTY_EVENTS_FILTER: EventsFilter = {
  kinds: [],
  unitName: null,
  spellQuery: "",
  range: null,
};

interface RawEvent {
  timestamp: number;
  eventName?: string;
  spellId?: number | string;
  spellName?: string;
  srcName?: string;
  destName?: string;
  amount?: number;
  effectiveAmount?: number;
  extraSpellName?: string;
  params?: string[];
  unconscious?: boolean;
}

interface UnitLike {
  id: string;
  name: string;
  kind?: string;
  info?: unknown;
  ownerId?: string;
  damageOut?: RawEvent[];
  healOut?: RawEvent[];
  casts?: RawEvent[];
  auraEvents?: RawEvent[];
  actionsOut?: RawEvent[];
  deaths?: RawEvent[];
}

const fmtAmt = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));

const spellNameOf = (e: RawEvent): string =>
  getEnglishSpellName(String(e.spellId ?? ""), e.spellName ?? "") ||
  e.spellName ||
  "";

/** 摊平 + 排序(一次,昂贵);过滤在 filterEventRows 里做(便宜,可高频)。 */
export function deriveEventRows(source: ReportSource): EventRow[] {
  try {
    const startMs = source.startTime;
    const rel = (ts: number) => Math.round(((ts - startMs) / 1000) * 10) / 10;
    const rows: EventRow[] = [];
    const push = (
      e: RawEvent,
      kind: EventKind,
      detail: string,
      destOverride?: string,
    ) =>
      rows.push({
        tS: rel(e.timestamp),
        kind,
        srcName: (e.srcName ?? "").split("-")[0]!,
        destName: (destOverride ?? e.destName ?? "").split("-")[0]!,
        spellId: String(e.spellId ?? ""),
        spellName: spellNameOf(e),
        detail,
      });

    for (const u of Object.values(source.units) as unknown as UnitLike[]) {
      // 玩家 + 宠物都进(宠物事件本就带自己的 src 名)
      for (const e of u.damageOut ?? [])
        push(e, "damage", fmtAmt(e.effectiveAmount ?? e.amount ?? 0));
      for (const e of u.healOut ?? [])
        push(e, "heal", fmtAmt(e.effectiveAmount ?? e.amount ?? 0));
      for (const e of u.casts ?? []) {
        if (e.eventName === "SPELL_CAST_SUCCESS") push(e, "cast", "");
      }
      for (const e of u.auraEvents ?? []) {
        const ev = e.eventName ?? "";
        if (ev === "SPELL_AURA_APPLIED") push(e, "aura", "+获得");
        else if (ev === "SPELL_AURA_REMOVED") push(e, "aura", "−失去");
      }
      for (const e of u.actionsOut ?? []) {
        const ev = e.eventName ?? "";
        const extra = e.extraSpellName ?? e.params?.[12] ?? "";
        if (ev === "SPELL_DISPEL" || ev === "SPELL_STOLEN")
          push(e, "dispel", `驱掉 ${extra}`);
        else if (ev === "SPELL_INTERRUPT")
          push(e, "interrupt", `打断 ${extra}`);
      }
      for (const e of u.deaths ?? []) {
        if (!e.unconscious)
          push(e, "death", "死亡", (u.name ?? "").split("-")[0]);
      }
    }
    return rows.sort((a, b) => a.tS - b.tS);
  } catch {
    return [];
  }
}

export function filterEventRows(rows: EventRow[], f: EventsFilter): EventRow[] {
  const q = f.spellQuery.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.kinds.length > 0 && !f.kinds.includes(r.kind)) return false;
    if (f.unitName && r.srcName !== f.unitName && r.destName !== f.unitName)
      return false;
    if (q && !r.spellName.toLowerCase().includes(q)) return false;
    if (!tInRange(r.tS, f.range)) return false;
    return true;
  });
}
