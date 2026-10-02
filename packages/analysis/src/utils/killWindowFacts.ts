/**
 * killWindowFacts.ts — GH #31 ① (2026-09-02, user-ruled): the killability
 * gate-facts for kill-window rendering, ONE computation shared by the healer
 * view (healerOffenseAnalysis) and the DPS view (buildMatchContext's
 * <kill_windows> block) so the two can never disagree (CLAUDE.md
 * shared-predicate rule).
 *
 * Semantics settled on the 2026-09-02 value-gate examples: the three checks
 * gate the ACCUSATION side only — an unpunished [VULNERABLE] span is
 * accountable only when a canonical offensive CD was ready AND the target was
 * reachable; [KILL WINDOW] burst lines carry the same fields as FACTS, never
 * as a gate (measured: every killable=no burst in the smoke still killed its
 * target — sustained damage suffices once CDs were spent earlier).
 *
 * Predicate sources (all existing, imported never re-derived):
 *   ready    OFFENSIVE_CD_SPELL_IDS (spellDanger, chg9 canonical) ×
 *            extractMajorCooldowns × cdAvailableAt at span/burst start
 *   reach    getUnitPositionAtTime(LOS_SWEEP_GAP_MS) + canReachTargetAt
 *            (40 yd, LoS, fail OPEN — [ROOT]'s posture: sampling gaps must
 *            not manufacture unreachability)
 *   healer   enemyHealerCcWindows overlap (fact only, never a gate — a free
 *            healer does not make a target unkillable)
 */
import { CombatUnitClass, type ICombatUnit } from "@gladlog/parser-compat";

import { enemyHealerCcWindows } from "../analysis/candidates/cooldownTiming";
import { cdAvailableAt, extractMajorCooldowns, isMeleeSpec } from "./cooldowns";
import { getUnitPositionAtTime } from "./losAnalysis";
import { CLOSE_RANGE_YARDS } from "./positionAnalysis";
import { LOS_SWEEP_GAP_MS } from "./positionSampling";
import { fmtTime } from "./renderGrid";
import { canReachTargetAt } from "./rootReachability";
import { OFFENSIVE_CD_SPELL_IDS } from "./spellDanger";
import { RANGE_HITBOX_SLACK_YD, spellRangeForCaster } from "./spellRange";
import { isDeadAt } from "./unitDeath";

/** Caster reach for "some attacker could reach the target" — the caster end
 * of the melee-12 / caster-40 convention [ROOT] uses. */
export const KW_REACH_YARDS = 40;

/** Evoker damage reach: Living Flame's talent-resolved range (25 yd; +5 with
 * Arcane Reach or the Preservation aura). */
const EVOKER_REACH_SPELL_ID = "361469";

/**
 * Whether friendly `f` at `pos` reaches `target` with damage at `tMs` — the
 * [ROOT] roles (melee `CLOSE_RANGE_YARDS` without a LoS test, casters with
 * one), and an Evoker's own 25/30 yd instead of 40. Until 2026-09-26 every
 * friendly got 40 yd: `reachable === true` is the ACCUSING side of this gate
 * (it makes the window accountable), so the flat 40 called a melee at 38 yd
 * or a Devastation Evoker at 35 yd able to deliver (talent impact audit).
 */
function friendlyReachesAt(
  f: ICombatUnit,
  pos: NonNullable<ReturnType<typeof getUnitPositionAtTime>>,
  target: ICombatUnit,
  tMs: number,
  zoneId: string | undefined,
): boolean | null {
  if (isMeleeSpec(f.spec))
    return canReachTargetAt(pos, target, tMs, zoneId, CLOSE_RANGE_YARDS, false);
  // an Evoker's own range plus the hitbox slack every reach claim adds
  // (RANGE_HITBOX_SLACK_YD, the spellReachToAccuse convention)
  const evokerRange =
    f.class === CombatUnitClass.Evoker
      ? spellRangeForCaster(f, EVOKER_REACH_SPELL_ID)
      : null;
  const yards =
    evokerRange !== null ? evokerRange + RANGE_HITBOX_SLACK_YD : KW_REACH_YARDS;
  return canReachTargetAt(pos, target, tMs, zoneId, yards, true);
}

export interface IKillWindowGateFacts {
  /** Canonical friendly offensive CDs ready at the span/burst start. */
  readyOffCds: string[];
  /** false only when positions WERE recorded and no friendly could reach the
   * target (range+LoS); true when reachable; null when no position data. */
  reachable: boolean | null;
  /** Enemy healer sat in hard CC overlapping the rendered span. */
  healerLocked: boolean;
  /** The accusation gate: ready tool AND not provably unreachable. */
  accountable: boolean;
}

export interface IKillWindowFactsComputer {
  facts(
    target: ICombatUnit,
    fromSeconds: number,
    toSeconds: number,
  ): IKillWindowGateFacts;
}

/** Build once per round; `facts()` per rendered span/burst. */
export function createKillWindowFactsComputer(
  combat: { startTime: number; startInfo?: { zoneId?: string } },
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
): IKillWindowFactsComputer {
  const startMs = combat.startTime;
  const teamCds = friends.flatMap((f) => {
    try {
      return extractMajorCooldowns(
        f,
        combat as Parameters<typeof extractMajorCooldowns>[1],
      )
        .filter((cd) => OFFENSIVE_CD_SPELL_IDS.has(String(cd.spellId)))
        .map((cd) => ({ cd, holder: f }));
    } catch {
      return [];
    }
  });
  let healerWindows: Array<{ fromSeconds: number; toSeconds: number }>;
  try {
    // The window derivation only reads units/timestamps off `combat`; the
    // narrow structural type here is what both call sites actually hold.
    healerWindows = enemyHealerCcWindows(
      friends,
      enemies,
      combat as Parameters<typeof enemyHealerCcWindows>[2],
    );
  } catch {
    healerWindows = [];
  }
  return {
    facts(
      target: ICombatUnit,
      fromSeconds: number,
      toSeconds: number,
    ): IKillWindowGateFacts {
      const tMs = startMs + fromSeconds * 1000;
      // F-KW2 (triage sync-burst): a friendly dead at the instant holds no
      // cooldown — 539b6ed0's [VULNERABLE] 1:23 accused the team of holding
      // Incarnation for a Druid who died at 67.0. `isDeadAt` is the one
      // dead-at predicate (missed-sync-window's ready filter and [RES] read
      // the same one).
      const readyOffCds = teamCds
        .filter(
          ({ cd, holder }) =>
            !isDeadAt(holder, tMs) && cdAvailableAt(cd, fromSeconds),
        )
        .map(({ cd }) => cd.spellName);
      // Fail OPEN: reachable stays null until a recorded position pair
      // actually disproves reach for EVERY sampled friendly.
      let reachable: boolean | null = null;
      for (const f of friends) {
        const pos = getUnitPositionAtTime(f, tMs, LOS_SWEEP_GAP_MS);
        if (!pos) continue;
        const r = friendlyReachesAt(
          f,
          pos,
          target,
          tMs,
          combat.startInfo?.zoneId,
        );
        if (r !== false) {
          reachable = true;
          break;
        }
        reachable = false;
      }
      return {
        readyOffCds,
        reachable,
        healerLocked: healerWindows.some(
          (h) => h.fromSeconds <= toSeconds && h.toSeconds >= fromSeconds,
        ),
        accountable: readyOffCds.length > 0 && reachable !== false,
      };
    },
  };
}

/** Render the shared facts suffix — one wording for both views so the gate
 * (and any future re-parse) sees identical text. */
export function killWindowFactsSuffix(f: IKillWindowGateFacts): string {
  const parts: string[] = [];
  parts.push(
    f.readyOffCds.length > 0
      ? `team offensive CDs ready: ${f.readyOffCds.join("、")}`
      : "no team offensive CD ready",
  );
  if (f.reachable === false)
    parts.push("target unreachable (positions recorded)");
  if (f.healerLocked) parts.push("enemy healer hard-CC'd in window");
  return parts.join("; ");
}

/** Why an unpunished span is NOT accountable — rendered instead of the
 * "never punished" accusation when the gate fails. */
export function killWindowAcquittal(f: IKillWindowGateFacts): string {
  const reasons: string[] = [];
  if (f.readyOffCds.length === 0) reasons.push("no offensive CD was ready");
  if (f.reachable === false) reasons.push("target unreachable");
  return reasons.join(" and ");
}

/** The lean DPS-view lines (<kill_windows> block, GH #31 ③): burst-anchored
 * [KILL WINDOW] facts plus gated [VULNERABLE] accusations, same spans and
 * same facts as the healer view, without the healer-only owner fields. */
export function buildDpsKillWindowLines(
  offensiveWindows: Array<{
    targetUnitId: string;
    targetName: string;
    targetSpec: string;
    fromSeconds: number;
    toSeconds: number;
    friendlyDamageInWindow: number;
    bursts: Array<{ fromSeconds: number; toSeconds: number; damage: number }>;
  }>,
  enemies: ICombatUnit[],
  computer: IKillWindowFactsComputer,
): string[] {
  const lines: string[] = [];
  for (const w of offensiveWindows) {
    const target = enemies.find((e) => e.id === w.targetUnitId);
    if (!target) continue;
    if (w.bursts.length > 0) {
      for (const b of w.bursts) {
        const f = computer.facts(target, b.fromSeconds, b.toSeconds);
        lines.push(
          `  [KILL WINDOW] ${fmtTime(b.fromSeconds)}–${fmtTime(b.toSeconds)} on ${w.targetSpec} (${w.targetName}): team burst ${(b.damage / 1000).toFixed(0)}k (defenseless ${fmtTime(w.fromSeconds)}–${fmtTime(w.toSeconds)}); ${killWindowFactsSuffix(f)}.`,
        );
      }
    } else {
      const f = computer.facts(target, w.fromSeconds, w.toSeconds);
      const verdict = f.accountable
        ? "never punished"
        : `not punished — not accountable (${killWindowAcquittal(f)})`;
      lines.push(
        `  [VULNERABLE] ${fmtTime(w.fromSeconds)}–${fmtTime(w.toSeconds)} on ${w.targetSpec} (${w.targetName}): no major defensives, ${verdict} (team damage ${(w.friendlyDamageInWindow / 1000).toFixed(0)}k total); ${killWindowFactsSuffix(f)}.`,
      );
    }
  }
  return lines;
}

