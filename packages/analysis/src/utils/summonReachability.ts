/**
 * summonReachability.ts — "could anyone on the owner's team have hit that enemy
 * summon?" (GH #100 / BACKLOG #51, user-approved 2026-09-20).
 *
 * The `[ENEMY SUMMON]` fact line says an enemy Psyfiend / Spirit Link Totem was
 * not killed and how much the team hit it. On its own that invites an unfair
 * reading — nobody can hit what they cannot reach, or while they are feared.
 * So the line also carries the feasibility evidence, and the judgement stays
 * with the reader: WHO was in reach of it and free to act, for HOW MANY of its
 * seconds. No separate accusation candidate exists; measured on 695 rounds the
 * strict form of one (reach + free >= 5 s, nothing better to do) would fire in
 * 2 rounds, the loose form (>= 3 s) in 8 and mostly on thin evidence.
 *
 * Every piece is an existing predicate — never a second copy:
 *   window   summon → summon + the SUMMONING spell's official DB2 duration
 *            (never a hand value; an unknown duration means no claim at all)
 *   reach    canReachTargetAt — melee CLOSE_RANGE_YARDS without LoS, otherwise
 *            KW_REACH_YARDS with LoS, on the [ROOT] whole-second render grid
 *   free     buildCannotCastIntervals (cast-blocking CC and school lockouts)
 */
import type { ICombatUnit } from "@gladlog/parser-compat";
import { LogEvent } from "@gladlog/parser-compat";

import { spellEffectData } from "../data/spellEffectData";
import { buildCannotCastIntervals } from "./cannotCastIntervals";
import { isHealerSpec, isMeleeSpec } from "./cooldowns";
import { KW_REACH_YARDS } from "./killWindowFacts";
import { getUnitPositionAtTime } from "./losAnalysis";
import { CLOSE_RANGE_YARDS, isDeadAt } from "./positionAnalysis";
import { LOS_SWEEP_GAP_MS } from "./positionSampling";
import { canReachTargetAt } from "./rootReachability";

/** Below this many seconds in reach and free, nobody is named: a second or two
 * of overlap is not an opportunity. Same 3 s floor as ROOT_UNREACHABLE_MIN_S. */
export const SUMMON_REACH_MIN_S = 3;

export interface ISummonReach {
  /** The summoning spell's official duration, clipped to the round's end. */
  windowSeconds: number;
  /** The teammate with the most seconds both in reach and free to act. */
  best: { unit: ICombatUnit; seconds: number; melee: boolean } | null;
}

/**
 * For an enemy summon: how long it officially stood, and which non-healer
 * teammate had the most seconds in reach of it while free to act. `null` when
 * the log cannot support any statement — no SPELL_SUMMON, no official
 * duration, or no position sample for the summon inside its window.
 */
export function summonReach(
  summon: ICombatUnit,
  combat: { endTime: number; startInfo?: { zoneId?: string } },
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
): ISummonReach | null {
  const summonEvent = summon.actionIn.find(
    (a) => a.logLine.event === LogEvent.SPELL_SUMMON,
  );
  if (!summonEvent) return null;
  const durationS =
    spellEffectData[String(summonEvent.spellId)]?.durationSeconds;
  if (!durationS) return null;
  const fromMs = summonEvent.logLine.timestamp;
  const toMs = Math.min(fromMs + durationS * 1000, combat.endTime);
  const windows: Array<{ secStart: number; secEnd: number; t: number }> = [];
  for (let t = fromMs; t + 1000 <= toMs; t += 1000) {
    windows.push({ secStart: t, secEnd: t + 1000, t: t + 500 });
  }
  if (windows.length === 0) return null;
  if (!windows.some((w) => getUnitPositionAtTime(summon, w.t, LOS_SWEEP_GAP_MS)))
    return null;

  const enemyIds = new Set(enemies.map((e) => e.id));
  const zoneId = combat.startInfo?.zoneId;
  let best: ISummonReach["best"] = null;
  for (const f of friends) {
    if (isHealerSpec(f.spec)) continue;
    const melee = isMeleeSpec(f.spec);
    const blocked = buildCannotCastIntervals(f, enemyIds);
    let ok = 0;
    for (const w of windows) {
      if (isDeadAt(f, w.t)) continue;
      // Interval intersection (W0b): unit was unable to cast at any point during [secStart, secEnd]
      if (blocked.some((b) => b.from < w.secEnd && b.to > w.secStart)) continue;
      const from = getUnitPositionAtTime(f, w.t, LOS_SWEEP_GAP_MS);
      if (!from) continue;
      if (
        canReachTargetAt(
          from,
          summon,
          w.t,
          zoneId,
          melee ? CLOSE_RANGE_YARDS : KW_REACH_YARDS,
          !melee,
        ) === true
      )
        ok++;
    }
    if (ok > (best?.seconds ?? 0)) best = { unit: f, seconds: ok, melee };
  }
  return { windowSeconds: windows.length, best };
}
