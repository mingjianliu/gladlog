/**
 * Enemy defensives — the ONE predicate for "which enemy abilities count as a
 * real defensive", shared by the KILL ATTEMPTS attribution
 * (`killAttempts.ts`: `popped X` / `saved by external (X)`) and the timeline's
 * `[ENEMY DEF]` lines (`context/matchTimeline.ts`), so the summary block and
 * the timeline can never disagree about what a wall is (CLAUDE.md
 * Shared-Predicate Rule; GH #97, 2026-09-15). The sets lived as module-private
 * consts in killAttempts.ts before this file.
 */
import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { MITIGATION_TABLE } from "../data/mitigationData";
import { getEnglishSpellName } from "../data/spellEffectData";
import spellIdListsData from "../data/spellIdLists";
import { buildAuraIntervals } from "./auraIntervals";
import { buffFullDurationForCaster } from "./buffDuration";

export const EXTERNAL_DEF_IDS = new Set<string>(
  (spellIdListsData as unknown as { externalDefensiveSpellIds?: string[] })
    .externalDefensiveSpellIds ?? [],
);

/** Immunities in the official table are recorded as pct 100 (spec decision in
 * mitigationData.ts). Baiting one out is a WIN per the user ruling ("冰箱圣盾
 * 不管,交了也算我们赚") — so it is its own attribution, never a reproach. */
export const IMMUNITY_IDS = new Set<string>(
  Object.entries(MITIGATION_TABLE)
    .filter(([, e]) => e.pct === 100)
    .map(([id]) => id),
);

/** Floor for "a real defensive": the same 20 % door as the kill-opportunity
 * gated tier (WALL_IN_HAND_MIT_IDS). Applied twice — to the table value when
 * building MITIGATION_AURA_IDS, and again per aura through `resolveMitigation`
 * so a talent-shared copy on an ally (Obsidian Scales 15 %) does not count as
 * the target having popped a 30 % wall. */
export const MITIGATION_AURA_MIN_PCT = 20;

/** 20–99% self-mitigation aura ids (the non-immune official table slice) —
 * "the target popped a real defensive during the attempt". */
export const MITIGATION_AURA_IDS = new Set<string>(
  Object.entries(MITIGATION_TABLE)
    .filter(([, e]) => e.pct >= MITIGATION_AURA_MIN_PCT && e.pct < 100)
    .map(([id]) => id),
);

/** An observed aura ended this much before its full duration → "removed
 * early" (dispelled, broken by damage/immunity rules, or cancelled). One
 * second of slack absorbs the log's aura-event jitter. */
export const REMOVED_EARLY_SLACK_S = 1;

export interface IEnemyDefensiveEvent {
  atSeconds: number;
  spellId: string;
  spellName: string;
  /** the enemy who pressed it */
  casterName: string;
  /** "self" = a wall on the caster (pct < 100); "immune" = pct 100; "external" = cast on another enemy */
  kind: "self" | "immune" | "external";
  /** official mitigation pct (self / immune); undefined for externals */
  pct?: number;
  /** who received an external */
  recipientName?: string;
  /** observed aura duration in seconds (from the aura interval); undefined when no interval could be paired */
  observedSeconds?: number;
  /** observed duration fell short of the caster's full duration by more than the slack */
  removedEarly: boolean;
}

/**
 * Every defensive an enemy unit pressed this round, in cast order — the
 * events the `[ENEMY DEF]` line renders. Self-mitigation and immunities come
 * from the enemy's OWN aura intervals (source = the enemy itself, so a
 * talent-shared copy applied by an ally is not "the target popped a wall");
 * externals from SPELL_CAST_SUCCESS onto another enemy, paired with the
 * recipient's aura interval when one starts within 1.5 s of the cast.
 */
export function enemyDefensiveEvents(
  enemy: ICombatUnit,
  enemies: ICombatUnit[],
  combat: { startTime: number; endTime: number },
): IEnemyDefensiveEvent[] {
  const out: IEnemyDefensiveEvent[] = [];
  const intervalsByUnit = new Map<
    string,
    ReturnType<typeof buildAuraIntervals>
  >();
  const intervalsOf = (u: ICombatUnit) => {
    let iv = intervalsByUnit.get(u.id);
    if (!iv) {
      iv = buildAuraIntervals(u, combat);
      intervalsByUnit.set(u.id, iv);
    }
    return iv;
  };
  const removedEarly = (spellId: string, observed: number): boolean => {
    const full = buffFullDurationForCaster(spellId, enemy);
    return full !== undefined && observed < full - REMOVED_EARLY_SLACK_S;
  };

  for (const iv of intervalsOf(enemy)) {
    if (iv.srcUnitName !== enemy.name) continue;
    const immune = IMMUNITY_IDS.has(iv.spellId);
    if (!immune && !MITIGATION_AURA_IDS.has(iv.spellId)) continue;
    const observed = iv.toS - iv.fromS;
    out.push({
      atSeconds: iv.fromS,
      spellId: iv.spellId,
      spellName: getEnglishSpellName(iv.spellId, iv.spellName),
      casterName: enemy.name,
      kind: immune ? "immune" : "self",
      pct: MITIGATION_TABLE[iv.spellId]?.pct,
      observedSeconds: observed,
      removedEarly: !iv.inferredEnd && removedEarly(iv.spellId, observed),
    });
  }

  for (const cast of enemy.spellCastEvents ?? []) {
    if (cast.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    if (!cast.spellId || !EXTERNAL_DEF_IDS.has(cast.spellId)) continue;
    const recipient = enemies.find(
      (e) => e.id === cast.destUnitId && e.id !== enemy.id,
    );
    if (!recipient) continue;
    const atSeconds = (cast.logLine.timestamp - combat.startTime) / 1000;
    const paired = intervalsOf(recipient).find(
      (iv) =>
        iv.spellId === cast.spellId && Math.abs(iv.fromS - atSeconds) <= 1.5,
    );
    const observed = paired ? paired.toS - paired.fromS : undefined;
    out.push({
      atSeconds,
      spellId: cast.spellId,
      spellName: getEnglishSpellName(cast.spellId, cast.spellName),
      casterName: enemy.name,
      kind: "external",
      recipientName: recipient.name,
      observedSeconds: observed,
      removedEarly:
        paired !== undefined &&
        !paired.inferredEnd &&
        observed !== undefined &&
        removedEarly(cast.spellId, observed),
    });
  }

  return out.sort((a, b) => a.atSeconds - b.atSeconds);
}
