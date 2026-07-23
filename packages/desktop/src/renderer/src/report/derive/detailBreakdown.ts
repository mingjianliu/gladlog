import { decodeHpTail } from "@gladlog/parser";

import { eventInRange, type TimeRange } from "./timeRange";
import type { ReportSource } from "./types";

export interface BreakdownRow {
  key: string;
  label: string;
  spellId: string;
  total: number;
  sharePct: number;
  hits: number;
  maxHit: number;
  critPct: number | null;
  overhealPct?: number;
  isAbsorb?: boolean;
}

interface HpEventLike {
  timestamp?: number;
  eventName?: string;
  spellId?: number | string;
  spellName?: string;
  srcName?: string;
  amount?: number;
  effectiveAmount?: number;
  params?: string[];
}
interface AbsorbEventLike {
  timestamp?: number;
  spellId?: number | string;
  spellName?: string;
  absorbedAmount?: number;
}
interface UnitLike {
  id: string;
  name: string;
  ownerId?: string;
  damageOut?: HpEventLike[];
  damageIn?: HpEventLike[];
  healOut?: HpEventLike[];
  absorbsOut?: AbsorbEventLike[];
}

interface Acc {
  label: string;
  spellId: string;
  total: number;
  totalRaw: number; // amount 合计(healing 过量%用)
  hits: number;
  maxHit: number;
  crits: number;
  critKnown: number; // params 可解码的事件数
  isAbsorb?: boolean;
}

const acc = (
  map: Map<string, Acc>,
  key: string,
  seed: Pick<Acc, "label" | "spellId"> & Partial<Pick<Acc, "isAbsorb">>,
): Acc => {
  let a = map.get(key);
  if (!a) {
    a = {
      ...seed,
      total: 0,
      totalRaw: 0,
      hits: 0,
      maxHit: 0,
      crits: 0,
      critKnown: 0,
    };
    map.set(key, a);
  }
  return a;
};

function addHp(a: Acc, e: HpEventLike): void {
  const eff = e.effectiveAmount ?? 0;
  a.total += eff;
  a.totalRaw += e.amount ?? eff;
  a.hits += 1;
  a.maxHit = Math.max(a.maxHit, eff);
  // 暴击单源:parser decodeHpTail;params 缺席(旧/裁剪 doc)→ 不计入 critKnown
  const tail = decodeHpTail(e.eventName ?? "", e.params ?? []);
  if (tail) {
    a.critKnown += 1;
    if (tail.critical) a.crits += 1;
  }
}

/**
 * 战报明细 breakdown(backlog #11 / spec 2026-07-18-report-detail-breakdown):
 * 与 derive/summary 同事件源同求和口径 —— 分解合计恒等于 meterValue。
 */
export function deriveDetailBreakdown(
  source: ReportSource,
  unitId: string,
  mode: "damage" | "healing" | "taken",
  /** 时间窗联动①:与 deriveSummary 同谓词过滤,分解合计仍恒等于 meterValue。 */
  range?: TimeRange | null,
): { rows: BreakdownRow[]; critAvailable: boolean } {
  const units = Object.values(source.units) as unknown as UnitLike[];
  const self = units.find((u) => u.id === unitId);
  if (!self) return { rows: [], critAvailable: false };
  const pets = units.filter((u) => u.ownerId === unitId);
  const inR = eventInRange(source, range);
  const map = new Map<string, Acc>();

  if (mode === "taken") {
    // 短名撞车(同名不同服)时回退全名,避免两行同标签无法区分
    const shortCount = new Map<string, number>();
    const fulls = new Set(
      (self.damageIn ?? []).filter(inR).map((e) => e.srcName ?? "?"),
    );
    for (const f of fulls) {
      const short = f.split("-")[0]!;
      shortCount.set(short, (shortCount.get(short) ?? 0) + 1);
    }
    for (const e of (self.damageIn ?? []).filter(inR)) {
      const full = e.srcName ?? "?";
      const short = full.split("-")[0]!;
      const src = (shortCount.get(short) ?? 0) > 1 ? full : short;
      const key = `${full}:${e.spellId}`;
      addHp(
        acc(map, key, {
          label: `${src}:${e.spellName || "近战"}`,
          spellId: String(e.spellId ?? 0),
        }),
        e,
      );
    }
  } else {
    // 宠物名不切分:宠物没有服务器后缀,含连字符是名字本身
    const own = [{ unit: self, prefix: "" }].concat(
      pets.map((p) => ({ unit: p, prefix: `${p.name}:` })),
    );
    for (const { unit, prefix } of own) {
      const events = (
        mode === "damage" ? (unit.damageOut ?? []) : (unit.healOut ?? [])
      ).filter(inR);
      for (const e of events) {
        const key = `${prefix}${e.spellId}`;
        addHp(
          acc(map, key, {
            label: `${prefix}${e.spellName || "近战"}`,
            spellId: String(e.spellId ?? 0),
          }),
          e,
        );
      }
      if (mode === "healing") {
        for (const e of (unit.absorbsOut ?? []).filter(inR)) {
          const key = `ab:${prefix}${e.spellId}`;
          const a = acc(map, key, {
            label: `${prefix}${e.spellName || "吸收"}`,
            spellId: String(e.spellId ?? 0),
            isAbsorb: true,
          });
          const amt = e.absorbedAmount ?? 0;
          a.total += amt;
          a.totalRaw += amt;
          a.hits += 1;
          a.maxHit = Math.max(a.maxHit, amt);
        }
      }
    }
  }

  const grand = [...map.values()].reduce((s, a) => s + a.total, 0) || 1;
  const rows: BreakdownRow[] = [...map.entries()]
    .map(([key, a]) => ({
      key,
      label: a.label,
      spellId: a.spellId,
      total: a.total,
      sharePct: (a.total / grand) * 100,
      hits: a.hits,
      maxHit: a.maxHit,
      critPct:
        a.critKnown > 0 ? Math.round((a.crits / a.critKnown) * 100) : null,
      ...(mode === "healing" && !a.isAbsorb
        ? {
            overhealPct:
              a.totalRaw > 0
                ? Math.round(((a.totalRaw - a.total) / a.totalRaw) * 100)
                : 0,
          }
        : {}),
      ...(a.isAbsorb ? { isAbsorb: true as const } : {}),
    }))
    .sort((a, b) => b.total - a.total);
  return { rows, critAvailable: rows.some((r) => r.critPct !== null) };
}
