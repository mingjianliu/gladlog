import {
  type IKickAuditEntry,
  type MissedKickKind,
  missedKickKind,
} from "@gladlog/analysis";

/**
 * The one wording of a `missed` kick for the report UI's per-kick renderings
 * (mistake card, burst-ledger chip, kick dashboard entry — and the count the
 * dashboard and the exported table put beside 落空).
 *
 * User ruling A12 (2026-11-17, pipeline T196): a kick the log refused at a
 * live cast is listed and not called missed — it says what the miss row says
 * (analysis's `missedKickKind`: the target was immune to it, or reflected
 * it). Before, no reader of `kickMiss` / `refusedAtCastSpellName` existed in
 * the renderer and all of them read 落空 / 空放: 107 of the 193 missed kicks
 * with a miss row on the 605 capture (53 on the recorder's side — 43 IMMUNE,
 * 10 REFLECT —, 54 on the other side's dashboard rows). 6 of the 107 have
 * their row on another unit than the one whose bar was running (a Grounding
 * Totem took the kick): those say nothing of the caster and stay 落空.
 * Re-runnable check: `packages/eval/scripts/scan5/t196.ts`.
 */
export const MISSED_KICK_TEXT = "落空";
const REFUSED_KICK_TEXT: Readonly<
  Record<Exclude<MissedKickKind, "missed">, string>
> = {
  immune: "目标免疫打断",
  reflected: "被目标反射",
};
export function missedKickLabel(
  k: Pick<
    IKickAuditEntry,
    "kickMiss" | "refusedAtCastSpellName" | "targetId"
  >,
): string {
  const kind = missedKickKind(k);
  return kind === "missed" ? MISSED_KICK_TEXT : REFUSED_KICK_TEXT[kind];
}
