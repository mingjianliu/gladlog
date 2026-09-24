import { decodeHpTail } from "@gladlog/parser";

import { petsOf } from "./flowSeries";
import { shortUnitName } from "./teamSide";
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
  crit?: boolean;
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
  totalRaw: number; // sum of amount (used for healing's overheal %)
  hits: number;
  maxHit: number;
  crits: number;
  critKnown: number; // number of events whose params could be decoded
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
  // Single source for crits: prefer the materialized crit field (after the
  // params slimming the tail is no longer persisted); fall back to decodeHpTail
  // for old fat documents; when both are missing (trimmed fixtures) the event
  // does not count toward critKnown
  if (e.crit !== undefined) {
    a.critKnown += 1;
    if (e.crit) a.crits += 1;
  } else {
    const tail = decodeHpTail(e.eventName ?? "", e.params ?? []);
    if (tail) {
      a.critKnown += 1;
      if (tail.critical) a.crits += 1;
    }
  }
}

/**
 * Report detail breakdown (backlog #11 / spec
 * 2026-07-18-report-detail-breakdown): same event source and same summation
 * accounting as derive/summary — the breakdown total is identically equal to
 * meterValue.
 */
export function deriveDetailBreakdown(
  source: ReportSource,
  unitId: string,
  mode: "damage" | "healing" | "taken",
  /** Time-window linkage ①: filtered by the same predicate as deriveSummary, so
   * the breakdown total still equals meterValue exactly. */
  range?: TimeRange | null,
): { rows: BreakdownRow[]; critAvailable: boolean } {
  const units = Object.values(source.units) as unknown as UnitLike[];
  const self = units.find((u) => u.id === unitId);
  if (!self) return { rows: [], critAvailable: false };
  const pets = petsOf(units, unitId);
  const inR = eventInRange(source, range);
  const map = new Map<string, Acc>();

  if (mode === "taken") {
    // On a short-name collision (same name, different realm) fall back to the
    // full name so two rows never carry an indistinguishable label
    const shortCount = new Map<string, number>();
    const fulls = new Set(
      (self.damageIn ?? []).filter(inR).map((e) => e.srcName ?? "?"),
    );
    for (const f of fulls) {
      const short = shortUnitName(f);
      shortCount.set(short, (shortCount.get(short) ?? 0) + 1);
    }
    for (const e of (self.damageIn ?? []).filter(inR)) {
      const full = e.srcName ?? "?";
      const short = shortUnitName(full);
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
    // Pet names are not split: pets have no realm suffix, so a hyphen is part of
    // the name itself
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
