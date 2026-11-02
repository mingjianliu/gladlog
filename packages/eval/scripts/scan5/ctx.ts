/* eslint-disable @typescript-eslint/no-explicit-any -- the checks walk the untyped legacy parse objects (match.units, damageIn, absorbsIn) by the hundred */
/**
 * scan5/ctx.ts — what `corpusFactScan5.ts` hands each class module per
 * captured owner context (one round as one owner saw it), and the small
 * shared readers every module uses. A module exports `CHECKS` (its check
 * names) and `run(ctx)`; it derives truth from the log rows directly, never
 * through the analysis predicate it audits (lookups — names, DB2 tables,
 * category maps — are fine).
 */
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { LogEvent } from "@gladlog/parser-compat";

import type { MergeRule } from "../verify/merge";
import type { IContext } from "../verify/rounds";

/** where a violation was seen, kept for one that is judged after the walk */
export interface IViolationRef {
  where: string;
  archive: string;
  round: number;
  roundKey: string;
  start: number;
}
export type RecordViolation = (
  ref: IViolationRef,
  check: string,
  kind: string,
  atMs: number,
  factId: string,
  detail: string,
  line?: string,
) => void;

export interface IRoundCtx extends IContext {
  ref: IViolationRef;
  violate: (
    check: string,
    kind: string,
    atMs: number,
    factId: string,
    detail: string,
    line?: string,
  ) => void;
  bump: (check: string, n?: number) => void;
  /** first-seen-per-round guard for once-per-round work (inventories) */
  firstOwnerOfRound: boolean;
}

export const nameOf = (
  id: string | number | undefined,
  fallback = "",
): string =>
  id === undefined || id === ""
    ? fallback
    : getEnglishSpellName(String(id), fallback);
export const fmtS = (sec: number): string => {
  const t = Math.max(0, Math.floor(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
export const secOf = (mss: string): number => {
  const [m, s] = mss.split(":");
  return Number(m) * 60 + Number(s);
};
export const ev = (a: any): string => a.logLine?.event;
export const tsOf = (a: any): number => a.logLine?.timestamp ?? a.timestamp;
export const APPLIED = LogEvent.SPELL_AURA_APPLIED as string;
export const REMOVED = LogEvent.SPELL_AURA_REMOVED as string;
export const REFRESH = LogEvent.SPELL_AURA_REFRESH as string;
export const SUCCESS = LogEvent.SPELL_CAST_SUCCESS as string;
export const ABSORBED = LogEvent.SPELL_ABSORBED as string;
export const successesOf = (u: any): any[] =>
  ((u.spellCastEvents ?? []) as any[]).filter((c) => ev(c) === SUCCESS);
export const deathMs = (u: any): number =>
  Math.min(
    Infinity,
    ...((u.deathRecords ?? []) as any[]).map((d) => d.timestamp),
  );
/** "0.87M" / "110k" / "950" → its value and half its last printed digit */
export function amountOf(s: string): { v: number; half: number } | undefined {
  const m = /^([\d.]+)([kM]?)$/.exec(s);
  if (!m) return undefined;
  const mul = m[2] === "M" ? 1e6 : m[2] === "k" ? 1e3 : 1;
  const dec = m[1]!.includes(".") ? m[1]!.split(".")[1]!.length : 0;
  return { v: Number(m[1]) * mul, half: (mul / 10 ** dec) * 0.5 };
}

export interface IScanModule {
  CHECKS: readonly string[];
  /** kinds counted but kept out of a check's total, as `${check}|${kind}` */
  OUT_OF_TOTAL?: ReadonlySet<string>;
  run: (ctx: IRoundCtx) => void;
  /** optional lines printed after the checks (inventories) */
  report?: () => string[];
  /** the accumulators `report` and `finalize` read, across processes */
  state?: () => object;
  load?: (s: never) => void;
  merge?: Record<string, MergeRule>;
  /** violations that need the whole run: judged once, on the merged state */
  finalize?: (record: RecordViolation) => void;
}
