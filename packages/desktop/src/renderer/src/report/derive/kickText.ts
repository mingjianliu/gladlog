import {
  type IKickAuditEntry,
  type MissedKickKind,
  missedKickKind,
} from "@gladlog/analysis";

import {
  type Language,
  type MessageKey,
  translate,
} from "../../../../shared/i18n";

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
 *
 * The wording lives in the dictionary (`report.kick.*`). `MISSED_KICK_TEXT`
 * stays the zh value on purpose (spec §6.5b): t196 keeps checking the Chinese
 * wording, and `missedKickLabel(k) !== MISSED_KICK_TEXT` (default zh) is how
 * callers ask "was this kick refused".
 */
export const MISSED_KICK_TEXT = translate("zh", "report.kick.missed");
const KICK_TEXT_KEY: Readonly<Record<MissedKickKind, MessageKey>> = {
  missed: "report.kick.missed",
  immune: "report.kick.immune",
  reflected: "report.kick.reflected",
};
/** The wording of a kick outcome kind in `lang` — what `missedKickLabel`
 * prints, for a caller that kept the kind rather than the kick. */
export function kickKindLabel(kind: MissedKickKind, lang: Language): string {
  return translate(lang, KICK_TEXT_KEY[kind]);
}
export function missedKickLabel(
  k: Pick<IKickAuditEntry, "kickMiss" | "refusedAtCastSpellName" | "targetId">,
  lang: Language = "zh",
): string {
  return kickKindLabel(missedKickKind(k), lang);
}
