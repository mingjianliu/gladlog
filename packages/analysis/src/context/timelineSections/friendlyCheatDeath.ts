/**
 * WO3 #17 (r1008-140, dfcccbf2 2:46): a friendly cheat-death proc — Cauterize
 * / Cheat Death refusing a killing blow on the owner or a teammate — gets a
 * `[YOU] [PROC]` / `[TEAM] [PROC]` line, as the same proc on an enemy gets
 * `[ENEMY DEF] … (cheat-death proc)`. Nothing was pressed; the line prints no
 * HP (the proc sets it).
 *
 * The ids are the `kind: "cheatDeath"` aura markers of `CRISIS_PROC_ANSWERS`
 * (crisisDecisionPoints.ts: Cauterize 87023 aura 251/251 self, Cheat Death
 * 45182 25/25) — the same reading the crisis layer credits, applied on the
 * unit by the unit itself.
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { CRISIS_PROC_ANSWERS } from "../../analysis/crisisDecisionPoints";
import { specToString } from "../../utils/cooldowns";
import { fmtTime } from "../../utils/renderGrid";

/** The words the line closes on — `[ENEMY DEF]`'s label for the same proc. */
export const CHEAT_DEATH_PROC_LABEL = "(cheat-death proc)";

export function emitFriendlyCheatDeathEntries(ctx: {
  owner: ICombatUnit;
  friends: readonly ICombatUnit[];
  matchStartMs: number;
  matchEndSeconds: number;
  roundEndAtMs?: number;
  pid: (name: string) => string;
  addEntry: (atSeconds: number, line: string) => void;
}): boolean {
  const { owner, friends, matchStartMs, matchEndSeconds, pid, addEntry } = ctx;
  const endMs = Math.min(
    ctx.roundEndAtMs ?? Infinity,
    matchStartMs + matchEndSeconds * 1000,
  );
  let emitted = false;
  const units = [owner, ...friends.filter((f) => f.id !== owner.id)];
  for (const u of units) {
    for (const a of u.auraEvents ?? []) {
      if (a.logLine.event !== LogEvent.SPELL_AURA_APPLIED) continue;
      if (a.srcUnitId !== u.id || a.destUnitId !== u.id) continue;
      const def = CRISIS_PROC_ANSWERS.get(a.spellId ?? "");
      if (def?.kind !== "cheatDeath") continue;
      if (a.logLine.timestamp < matchStartMs || a.logLine.timestamp > endMs)
        continue;
      const t = (a.logLine.timestamp - matchStartMs) / 1000;
      // the talent's name, as [ENEMY DEF] prints it (45182's aura is
      // "Cheating Death")
      const name = def.name;
      addEntry(
        t,
        u.id === owner.id
          ? `${fmtTime(t)}  [YOU] [PROC]   ${name} ${CHEAT_DEATH_PROC_LABEL}`
          : `${fmtTime(t)}  [TEAM] [PROC]   ${pid(u.name)} (${specToString(u.spec)}): ${name} ${CHEAT_DEATH_PROC_LABEL}`,
      );
      emitted = true;
    }
  }
  return emitted;
}
