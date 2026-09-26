/**
 * What was going on on BOTH sides while a kick had the owner locked out —
 * the kick-eaten context facts (GH #113, user rulings 2026-09-25).
 *
 * Rulings, in order:
 *  - "被锁了肯定要做别的事 因果倒置了": what the player did after the kick is
 *    forced by the kick, so it can never show the kick was harmless. Judge by
 *    the window, not the reaction.
 *  - "要看双方的压力 因为打断可以用来进攻也可以防守": an enemy kick serves
 *    their offense (lock our healer while they kill) or their defense (stop
 *    our CC / damage while we kill) — both sides are read.
 *  - "大招也要算": an offensive cooldown running counts as pressure, not only
 *    HP and deaths.
 *  - "平静期无所谓 但是如果大招好了 被踢也许等于减慢节奏": a kick with both
 *    sides calm does not matter — unless our burst was ready.
 *  - Lost damage output from the lockout: not modelled ("不着急做").
 *
 * Measured on the new-season archive every 30th file (605 files, 6,117 landed
 * kicks; eval-private reports/gh113-kick-harm-2026-09-25): both sides 42 %,
 * ours only 25 %, theirs only 20 %, calm with a burst ready 5 %, calm with
 * nothing ready 9 % — the last group is the one kick-eaten stops listing.
 *
 * Window: the lockout on the render grid, whole seconds
 * [floor(kick), ceil(kick + lockout)]; deaths up to KICK_OUTCOME_S after the
 * lockout ends. HP is `gridHpMinInWindow` — the [STATE] tick sampler — with
 * CRISIS_HP_PCT_RENDERED as the low line, so a rendered "13%" is the same
 * reading a [STATE] tick at that second prints.
 */
import type { AtomicArenaCombat, ICombatUnit } from "@gladlog/parser-compat";

import { getEnglishSpellName } from "../data/spellEffectData";
import { burstCastSpan } from "../utils/burstLedger";
import {
  gridHpMinInWindow,
  kitSpellReadyAt,
  playerTalentIdSets,
} from "../utils/cooldowns";
import { reconstructEnemyCDTimeline } from "../utils/enemyCDs";
import { OFFENSIVE_CD_SPELL_IDS } from "../utils/spellDanger";
import { CRISIS_HP_PCT_RENDERED } from "./crisisDecisionPoints";

/** Deaths this long after the lockout ends still count as its outcome. */
export const KICK_OUTCOME_S = 5;

export interface KickSidePressure {
  /** The side's lowest unit at or below CRISIS_HP_PCT_RENDERED in the window. */
  low?: { unit: string; pct: number; atSec: number };
  /** The side's first death from the kick to KICK_OUTCOME_S after the lockout. */
  death?: { unit: string; atSec: number };
  /** The OTHER side's offensive cooldowns running during the lockout. */
  burstAgainst: string[];
}

export interface KickPressure {
  ours: KickSidePressure;
  theirs: KickSidePressure;
  /** Only when neither side was under pressure: the owner's team's offensive
   * cooldowns ready at the kick's second ("name" for the owner's own,
   * "unit: name" for a teammate's). */
  burstReady: string[];
}

export function sideUnderPressure(p: KickSidePressure): boolean {
  return p.low !== undefined || p.death !== undefined || p.burstAgainst.length > 0;
}

/** Both sides calm and no burst of ours ready — the kick is not listed. */
export function kickIsHarmless(p: KickPressure): boolean {
  return (
    !sideUnderPressure(p.ours) &&
    !sideUnderPressure(p.theirs) &&
    p.burstReady.length === 0
  );
}

export function kickPressureFor(params: {
  combat: AtomicArenaCombat;
  owner: ICombatUnit;
  friends: ICombatUnit[];
  enemies: ICombatUnit[];
}): (k: { atSeconds: number; lockoutDurationSeconds: number }) => KickPressure {
  const { combat, owner, friends, enemies } = params;
  const start = combat.startTime;
  const spans = (side: ICombatUnit[]) =>
    reconstructEnemyCDTimeline(side, combat).players.flatMap((pl) =>
      pl.offensiveCDs.map((cd) => ({ ...burstCastSpan(cd), spell: cd.spellName })),
    );
  const ourSpans = spans(friends);
  const enemySpans = spans(enemies);
  const deathS = (u: ICombatUnit) =>
    u.deathRecords?.[0] ? (u.deathRecords[0].timestamp - start) / 1000 : null;
  const talents = new Map(friends.map((u) => [u.id, playerTalentIdSets(u)]));

  const side = (
    units: ICombatUnit[],
    against: Array<{ from: number; to: number; spell: string }>,
    t0: number,
    t1: number,
  ): KickSidePressure => {
    const s0 = Math.floor(t0);
    const s1 = Math.ceil(t1);
    let low: KickSidePressure["low"];
    for (const u of units) {
      const m = gridHpMinInWindow(u, start, s0, s1);
      if (m && m.pct <= CRISIS_HP_PCT_RENDERED && (!low || m.pct < low.pct))
        low = { unit: u.name, pct: Math.round(m.pct), atSec: m.atSec };
    }
    let death: KickSidePressure["death"];
    for (const u of units) {
      const d = deathS(u);
      if (d !== null && d >= t0 && d <= t1 + KICK_OUTCOME_S && (!death || d < death.atSec))
        death = { unit: u.name, atSec: d };
    }
    const burstAgainst = [
      ...new Set(against.filter((b) => b.from < t1 && b.to > t0).map((b) => b.spell)),
    ];
    return { ...(low ? { low } : {}), ...(death ? { death } : {}), burstAgainst };
  };

  return (k) => {
    const t0 = k.atSeconds;
    const t1 = k.atSeconds + k.lockoutDurationSeconds;
    const ours = side(friends, enemySpans, t0, t1);
    const theirs = side(enemies, ourSpans, t0, t1);
    const burstReady: string[] = [];
    if (!sideUnderPressure(ours) && !sideUnderPressure(theirs)) {
      const s = Math.floor(t0);
      for (const u of [owner, ...friends.filter((f) => f.id !== owner.id)]) {
        const kit = new Set(
          (u.spellCastEvents ?? []).map((e) => String(e.spellId ?? "")),
        );
        for (const id of kit) {
          if (!OFFENSIVE_CD_SPELL_IDS.has(id)) continue;
          if (!kitSpellReadyAt(u, id, s, start, talents.get(u.id)!)) continue;
          const name = getEnglishSpellName(
            id,
            u.spellCastEvents?.find((e) => e.spellId === id)?.spellName,
          );
          burstReady.push(u.id === owner.id ? name : `${u.name}: ${name}`);
        }
      }
    }
    return { ours, theirs, burstReady };
  };
}
