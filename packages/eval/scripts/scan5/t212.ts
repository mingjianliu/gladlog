/* eslint-disable @typescript-eslint/no-explicit-any -- the legacy parse objects are untyped */
/**
 * scan5/t212.ts — ticket T212 (round-14 D33): a pressed Havoc Metamorphosis
 * whose end the log does not show inside the round is ended at the press's
 * nominal length, though the unit goes on casting what only demon form
 * allows (7669df4d: form up from 2:26, window and `Ns left` end at 2:50,
 * Death Sweep at 2:56 and Annihilation at 2:58 / 2:59, the REMOVED logged
 * after the round's end).
 *
 *  - `pressedMetaEndsBeforeFormCast`: an occurrence the producer
 *    (`auraOffensiveOccurrences`) files as a pressed Metamorphosis (191427,
 *    `press-inferred`) with no observed end, and a cast of
 *    `METAMORPHOSIS_FORM_CAST_IDS` by the same unit later than its `endMs`
 *    and before the next application of the form aura (or the round's end).
 *    Kind = how far the last such cast is past the end, in 5 s steps.
 *    Counted: every pressed Metamorphosis occurrence with no observed end
 *    (once per round and unit).
 */
import {
  auraOffensiveOccurrences,
  METAMORPHOSIS_FORM_CAST_IDS,
} from "@gladlog/analysis/src/utils/offensiveAuraOccurrences";
import { LogEvent } from "@gladlog/parser-compat";

import { type IRoundCtx, tsOf } from "./ctx";

export const CHECKS = ["pressedMetaEndsBeforeFormCast"] as const;

const FORM_AURA = "162264";

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const C = "pressedMetaEndsBeforeFormCast";
  const bounds = {
    startTime: ctx.legacy.startTime,
    endTime: ctx.legacy.endTime,
  };
  for (const unit of ctx.players) {
    const occ = auraOffensiveOccurrences(unit, bounds).occurrences.filter(
      (o) =>
        o.spellId === "191427" &&
        o.provenance === "press-inferred" &&
        !o.endObserved,
    );
    for (const o of occ) {
      ctx.bump(C);
      const nextApplied =
        ((unit.auraEvents ?? []) as any[])
          .filter(
            (a) =>
              a.spellId === FORM_AURA &&
              a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
              tsOf(a) > o.startMs + 1000,
          )
          .map(tsOf)
          .sort((x: number, y: number) => x - y)[0] ?? Infinity;
      const late = ((unit.spellCastEvents ?? []) as any[])
        .filter(
          (c) =>
            c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
            METAMORPHOSIS_FORM_CAST_IDS.has(String(c.spellId)) &&
            tsOf(c) > o.endMs &&
            tsOf(c) < nextApplied &&
            tsOf(c) <= bounds.endTime,
        )
        .map(tsOf)
        .sort((x: number, y: number) => x - y);
      if (late.length === 0) continue;
      const last = late[late.length - 1]!;
      const over = (last - o.endMs) / 1000;
      const step = Math.floor(over / 5) * 5;
      ctx.violate(
        C,
        `last form cast ${step}–${step + 5} s past the end`,
        o.startMs,
        `${ctx.roundKey}|${unit.id}|${o.startMs}`,
        `spec ${unit.spec}: form from ${((o.startMs - ctx.start) / 1000).toFixed(1)}s, ended at ${((o.endMs - ctx.start) / 1000).toFixed(1)}s; ${late.length} form cast(s) after it, last at ${((last - ctx.start) / 1000).toFixed(1)}s (round ends ${((bounds.endTime - ctx.start) / 1000).toFixed(1)}s)`,
      );
    }
  }
}
