/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t219.ts — pipeline T219 (round-14 D41, e7a3569f r0 0:39):
 * `[PURGE] … purged Void Shield off 4(WMonk) (1 of 3 purgeable buffs on
 * it)` with two purgeable buffs up. The third was our mage's Frost Nova: its
 * SPELL_AURA_BROKEN_SPELL row (source: the monk who broke it) read "no
 * BUFF / DEBUFF marker" — the marker sits after the breaking spell's triple
 * on that row — and the same-side fallback counted it as the monk's buff.
 *
 *  - `purgeableCountPrinted`: every printed `N purgeable buff[s]` — a
 *    `[PURGE]` entry's `(k of N purgeable buffs on it)` and an
 *    `[ENEMY BUFF]` line's `N purgeable buffs on it then` — against the
 *    producer's own count (`purgeableBuffCountAt` over
 *    `purgeableBuffIntervals`) at the instant of the raw row the line is
 *    about: the SPELL_DISPEL / SPELL_STOLEN of that buff off that unit, or
 *    the buff's SPELL_AURA_APPLIED on it, in the line's second. A violation
 *    when no such row's count is the printed N. (The count is computed by
 *    the scanning tree, the N is the capture's: a capture of a tree that
 *    reads the marker elsewhere differs here.)
 *  - `brokenDebuffRowOwnSide`: counted, never a violation — the raw
 *    SPELL_AURA_BROKEN_SPELL rows marked DEBUFF (parameter
 *    `AURA_MARKER_PARAM_BROKEN_SPELL`) of a purgeable Magic aura whose
 *    source is on the holder's side: the rows the old reading admitted.
 *  - `brokenBuffRowDotAura`: counted, never a violation — the raw
 *    SPELL_AURA_BROKEN_SPELL rows marked BUFF of a DoT aura (`isDotAura`):
 *    the only rows on which the DoT runs' filter (`matchTimelineSections`,
 *    the marker's other positional reader) reads differently.
 */
import { isDotAura } from "@gladlog/analysis/src/context/matchTimelineSections";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import {
  AURA_MARKER_PARAM_BROKEN_SPELL,
  isPurgeableMagicBuff,
  purgeableBuffCountAt,
  purgeableBuffIntervals,
} from "@gladlog/analysis/src/utils/dispelAnalysis";
import {
  parseRawTimestamp,
  splitRawLine,
} from "@gladlog/analysis/src/utils/rawStreams";

import { fmtS, type IRoundCtx, secOf } from "./ctx";

export const CHECKS = [
  "purgeableCountPrinted",
  "brokenDebuffRowOwnSide",
  "brokenBuffRowDotAura",
] as const;

export interface IPrintedCount {
  s: number;
  targetPid: string;
  buff: string;
  n: number;
  /** the raw row the line is about */
  row: "removal" | "applied";
}

const PURGE_RE =
  /^(\d+:\d\d) {2}\[PURGE\] {3}\d+\([^)]*\)(?:'s \w+)? purged (.*) \([^()]+\)$/;
const BUFF_RE =
  /^(\d+:\d\d) {2}\[ENEMY BUFF\] {3}(\d+)\([^)]*\): (.+?) \(purgeable; .*?(\d+) purgeable buffs? on it then\)/;

/** the printed `N purgeable buff[s]` of a timeline line */
export function printedPurgeableCounts(line: string): IPrintedCount[] {
  const out: IPrintedCount[] = [];
  const pm = PURGE_RE.exec(line);
  if (pm) {
    // one entry per removed effect, `<buff> off <pid>(Spec)`, each with or
    // without its own `(k of N purgeable buffs on it)` — a line can mix
    // both (codex 85-tk-KICK-T219-1 #1: 38f35d92 r0 0:39 `Divine Shield off
    // 6(HPaladin), Power Word: Shield off 4(SPriest) (1 of 5 …)` was read
    // as one buff named `Divine Shield off 6(HPaladin), Power Word: Shield`)
    const entry =
      /(.+?) off (\d+)\([^)]*\)(?: \(\d+ of (\d+) purgeable buffs? on it\))?(?:, |$)/y;
    const list = pm[2]!;
    entry.lastIndex = 0;
    let e: RegExpExecArray | null;
    while (entry.lastIndex < list.length && (e = entry.exec(list))) {
      if (e[3] !== undefined)
        out.push({
          s: secOf(pm[1]!),
          targetPid: e[2]!,
          buff: e[1]!,
          n: Number(e[3]),
          row: "removal",
        });
    }
    return out;
  }
  const bm = BUFF_RE.exec(line);
  if (bm)
    out.push({
      s: secOf(bm[1]!),
      targetPid: bm[2]!,
      buff: bm[3]!,
      n: Number(bm[4]),
      row: "applied",
    });
  return out;
}

export function run(ctx: IRoundCtx): void {
  const removals: Array<{ ms: number; dest: string; buff: string }> = [];
  const applied: Array<{ ms: number; dest: string; buff: string }> = [];
  const unitByGuid = new Map<string, any>(
    (ctx.units as any[]).map((u) => [u.id, u]),
  );
  const sideOf = (guid: string): unknown => {
    const u = unitByGuid.get(guid);
    const owner = u?.ownerId ? unitByGuid.get(u.ownerId) : undefined;
    return (owner ?? u)?.reaction;
  };
  for (const l of ctx.rawLines) {
    if (
      !l.includes("SPELL_DISPEL") &&
      !l.includes("SPELL_STOLEN") &&
      !l.includes("SPELL_AURA_APPLIED") &&
      !l.includes("SPELL_AURA_BROKEN_SPELL")
    )
      continue;
    const parts = splitRawLine(l);
    if (!parts) continue;
    const ms = parseRawTimestamp(parts.datePart);
    if (ms === null) continue;
    const p = parts.params;
    const e = parts.eventName;
    if (e === "SPELL_DISPEL" || e === "SPELL_STOLEN")
      removals.push({
        ms,
        dest: p[4] ?? "",
        buff: getEnglishSpellName(p[11] ?? "", p[12] ?? ""),
      });
    else if (e === "SPELL_AURA_APPLIED")
      applied.push({
        ms,
        dest: p[4] ?? "",
        buff: getEnglishSpellName(p[8] ?? "", p[9] ?? ""),
      });
    else if (
      e === "SPELL_AURA_BROKEN_SPELL" &&
      ctx.firstOwnerOfRound &&
      ms >= ctx.start &&
      ms <= ctx.roundEndAt &&
      p[AURA_MARKER_PARAM_BROKEN_SPELL] === "BUFF" &&
      isDotAura(p[8] ?? "")
    )
      ctx.bump("brokenBuffRowDotAura");
    else if (
      e === "SPELL_AURA_BROKEN_SPELL" &&
      ctx.firstOwnerOfRound &&
      ms >= ctx.start &&
      ms <= ctx.roundEndAt &&
      p[AURA_MARKER_PARAM_BROKEN_SPELL] === "DEBUFF" &&
      isPurgeableMagicBuff(p[8] ?? "") &&
      sideOf(p[0] ?? "") !== undefined &&
      sideOf(p[0] ?? "") === sideOf(p[4] ?? "")
    )
      ctx.bump("brokenDebuffRowOwnSide");
  }
  const span = { startTime: ctx.start, endTime: ctx.end };
  const ivsOf = new Map<string, ReturnType<typeof purgeableBuffIntervals>>();
  const countOn = (target: any, atMs: number): number => {
    let ivs = ivsOf.get(target.id);
    if (!ivs) {
      const side = new Set<string>(
        (ctx.units as any[])
          .filter((u) => sideOf(u.id) === sideOf(target.id))
          .map((u) => u.id as string),
      );
      ivs = purgeableBuffIntervals(target, side, span);
      ivsOf.set(target.id, ivs);
    }
    return purgeableBuffCountAt(ivs, (atMs - ctx.start) / 1000);
  };
  for (const line of ctx.lines) {
    for (const c of printedPurgeableCounts(line)) {
      const target = ctx.unitOfPid(c.targetPid);
      if (!target) continue;
      const rows = (c.row === "removal" ? removals : applied).filter(
        (r) =>
          r.dest === target.id &&
          r.buff === c.buff &&
          Math.floor((r.ms - ctx.start) / 1000) === c.s,
      );
      if (rows.length === 0) continue;
      ctx.bump("purgeableCountPrinted");
      const counts = [...new Set(rows.map((r) => countOn(target, r.ms)))];
      if (!counts.includes(c.n))
        ctx.violate(
          "purgeableCountPrinted",
          c.row,
          rows[0]!.ms,
          `${target.id}:${c.buff}:${rows[0]!.ms}`,
          `${fmtS(c.s)} ${c.buff} on ${target.name}: printed ${c.n} purgeable, the producer counts ${counts.join(" / ")}`,
          line.trim().slice(0, 240),
        );
    }
  }
}
