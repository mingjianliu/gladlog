/**
 * scan5/t196.ts — pipeline T196 (user ruling A12, 2026-11-17): the desktop
 * report calls a kick the log refused at a live cast "missed".
 *
 * The desktop's three per-kick renderings (mistake card, burst-ledger chip,
 * kick dashboard entry) ask the audit exactly as this does — every player
 * against the opposing players, no raw streams — and print one wording for a
 * `missed` kick (`missedKickLabel`, the desktop's own function, imported).
 * Once per round, every `missed` kick that carries a miss row:
 *
 *  - `refusedKickCalledMissed`: the audit says the kick was refused at a
 *    running bar (`refusedAtCastSpellName`, the fact scan5/t52 checks against
 *    the log's rows) by an IMMUNE or REFLECT row. Violation: the desktop's
 *    wording for it is the plain missed one. Kind = the miss type and where
 *    it shows: `card` for the recorder's side (mistake card, ledger chip and
 *    dashboard), `dashboard` for the other side (dashboard only).
 */
import { analyzeKickAudit } from "@gladlog/analysis/src/utils/kickAudit";
import {
  type AtomicArenaCombat,
  CombatUnitReaction,
  type ICombatUnit,
} from "@gladlog/parser-compat";

import {
  MISSED_KICK_TEXT,
  missedKickLabel,
} from "../../../desktop/src/renderer/src/report/derive/kickText";
import { fmtS, type IRoundCtx } from "./ctx";

export const CHECKS = ["refusedKickCalledMissed"] as const;

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const combat = ctx.legacy as AtomicArenaCombat;
  const players = ctx.players as ICombatUnit[];
  for (const p of players) {
    const friendly = p.reaction === CombatUnitReaction.Friendly;
    const opponents = players.filter((o) => o.reaction !== p.reaction);
    if (opponents.length === 0) continue;
    for (const k of analyzeKickAudit(p, opponents, combat)) {
      if (k.result !== "missed" || !k.kickMiss) continue;
      ctx.bump("refusedKickCalledMissed");
      const type = k.kickMiss.missType;
      if (!k.refusedAtCastSpellName) continue;
      if (type !== "IMMUNE" && type !== "REFLECT") continue;
      if (missedKickLabel(k) !== MISSED_KICK_TEXT) continue;
      ctx.violate(
        "refusedKickCalledMissed",
        `${friendly ? "card" : "dashboard"} ${type}`,
        ctx.start + k.atSeconds * 1000,
        `${p.id}#${Math.floor(k.atSeconds * 10)}`,
        `${k.kickSpellName} at ${fmtS(k.atSeconds)} (${k.atSeconds.toFixed(2)}) logged ${type} while ${k.refusedAtCastSpellName} was running — the desktop says "${missedKickLabel(k)}"`,
      );
    }
  }
}
