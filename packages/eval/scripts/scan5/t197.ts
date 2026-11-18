/**
 * scan5/t197.ts — pipeline T197 (GH #221 group 1): the desktop death card's
 * 更省替代 names a shorter-cooldown save the dying unit could not press.
 *
 * The card puts, beside each immunity a unit died with (`[DEATH]`'s unused
 * immunity, `buildDeathOutcomeSummary`), the cheaper saves of its own ledger
 * (`cheaperDefensivesAtDeath`, the card's own function, called here with what
 * the card hands it: the round, both sides, each side's summary). Once per
 * round, every such immunity with a ledger row:
 *
 *  - `deathCheaperUnpressable`: an alternative the card names had no free
 *    stretch to be pressed in the lethal window — the death block's own
 *    reading of a missed option (`deathOptionLock`: controls, silences, a
 *    kick lockout on its school, a stun the game does not let it through).
 *    Violation per named alternative. Kind = the dying unit's side, and
 *    `immunity locked too` when the card says 当时被控 of the immunity itself.
 */
import { enemySourceIds } from "@gladlog/analysis/src/utils/cannotCastIntervals";
import { analyzePlayerCCAndTrinket } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import {
  extractMajorCooldowns,
  unitCooldownEntry,
} from "@gladlog/analysis/src/utils/cooldowns";
import {
  buildDeathOutcomeSummary,
  cheaperDefensivesAtDeath,
  deathOptionLock,
} from "@gladlog/analysis/src/utils/deathOutcomeAnalysis";
import {
  type AtomicArenaCombat,
  CombatUnitReaction,
  type ICombatUnit,
} from "@gladlog/parser-compat";

import { fmtS, type IRoundCtx } from "./ctx";

export const CHECKS = ["deathCheaperUnpressable"] as const;

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const legacy = ctx.legacy as AtomicArenaCombat;
  const players = ctx.players as ICombatUnit[];
  if (!players.some((p) => (p.deathRecords ?? []).length > 0)) return;
  const allUnits = ctx.units as ICombatUnit[];
  // the card's inputs (desktop `derive/deathRecap.ts`)
  const ccSummaries = players.map((p) => {
    const opponents = players.filter((o) => o.reaction !== p.reaction);
    const oppIds = new Set(opponents.map((o) => o.id));
    return analyzePlayerCCAndTrinket(
      p,
      opponents,
      legacy,
      allUnits.filter((u) => u.ownerId && oppIds.has(u.ownerId)),
    );
  });
  const cdsByUnit = new Map(
    players.map((p) => [p.id, extractMajorCooldowns(p, legacy)]),
  );
  const resolved = (unit: { id: string }, spellId: string) =>
    cdsByUnit.get(unit.id)?.find((c) => c.spellId === spellId) ??
    unitCooldownEntry(unit as ICombatUnit, legacy, spellId);
  const outcomeCombat = {
    startTime: legacy.startTime,
    endTime: legacy.endTime,
    zoneId: legacy.startInfo.zoneId,
  };
  const sides = [
    CombatUnitReaction.Friendly,
    CombatUnitReaction.Hostile,
  ] as const;
  for (const side of sides) {
    const own = players.filter((p) => p.reaction === side);
    const other = players.filter((p) => p.reaction !== side);
    if (own.length === 0) continue;
    const cannotCastSourceIds = enemySourceIds(other, allUnits);
    const { events } = buildDeathOutcomeSummary(
      outcomeCombat,
      own,
      ccSummaries,
      resolved,
      cannotCastSourceIds,
      allUnits,
    );
    for (const ev of events) {
      const unit = own.find((p) => p.name === ev.deadPlayer);
      if (!unit) continue;
      const victimCds = cdsByUnit.get(unit.id) ?? [];
      for (const imm of ev.availableImmunities) {
        const cd = victimCds.find((c) => c.spellId === imm.spellId);
        if (!cd) continue;
        ctx.bump("deathCheaperUnpressable");
        const at = {
          unit,
          atSeconds: ev.atSeconds,
          cannotCastSourceIds,
          combat: outcomeCombat,
          roundUnits: allUnits,
        };
        const offered = cheaperDefensivesAtDeath({
          ...at,
          unpressed: cd,
          victimCds,
        });
        for (const name of offered) {
          const alt = victimCds.find(
            (c) => c.spellName === name && c.spellId !== cd.spellId,
          );
          if (!alt) continue;
          const lock = deathOptionLock({
            ...at,
            optionSpellId: alt.spellId,
            optionOnSelf: true,
          });
          if (!lock.locked) continue;
          ctx.violate(
            "deathCheaperUnpressable",
            `${side === CombatUnitReaction.Friendly ? "friendly" : "enemy"}${imm.wasInCC ? " immunity locked too" : ""}`,
            ctx.start + ev.atSeconds * 1000,
            `${unit.id}#${Math.floor(ev.atSeconds)}#${alt.spellId}`,
            `died ${fmtS(ev.atSeconds)} with ${imm.spellName} unused — the card offers ${name} (${alt.spellId}), which had ${lock.freedom?.longestFreeS.toFixed(1) ?? "?"}s free in the lethal window`,
          );
        }
      }
    }
  }
}
