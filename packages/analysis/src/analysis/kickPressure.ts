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
 * lockout ends.
 *
 * HP, two readings since FT-T03 (user ruling 2026-10-10, D7 — "the 'trough'
 * numbers may leave the whole-second grid and read the true minimum inside
 * their window; the [STATE] point readings, the crisis crossing instants …
 * do NOT move"):
 *  - WHETHER a side has a unit at the crisis line (`low` exists — which
 *    decides `kickIsHarmless`, i.e. whether the kick is listed at all, and
 *    its cap tier) is asked of `gridHpMinInWindow`, the [STATE] tick
 *    sampler, against CRISIS_HP_PCT_RENDERED, exactly as before. No
 *    kick-eaten candidate appears or disappears with the ruling.
 *  - WHAT the fact prints — the side's lowest unit, how low, and when — is
 *    the trough: `hpTroughInWindow` over the same seconds, its samples
 *    bounded to the lockout itself [kick, kick + lockout]. It is never above
 *    the grid minimum, so a low that exists on the grid always has one to
 *    print; `ourLowPct` can sit below the [STATE] tick of `ourLowT`, and the
 *    unit named can be another one than the grid's lowest (rarely: when a
 *    different unit dipped lower between two ticks).
 *
 * Triage 2026-09-29 (kick-eaten F-K3 / F-K9b), user rulings 2026-09-30:
 *  - A31 = A: an offensive cooldown counts only when it was ALREADY RUNNING
 *    when the kick landed. One pressed inside the lockout after the kick is
 *    not what the kick served (141470d0 @60.4: Force of Nature pressed 2.8 s
 *    later, 0.16 s before the lock ended, read `enemyBurst=Force of Nature`).
 *  - A33 = A: a unit's ticks while it carries an immunity are not its low HP
 *    (0068182d @72.5: `ourLowPct=40` was a mage inside Ice Block from 69.6 to
 *    75.9). Since ruling F-K9b-B (2026-10-02) a FULL immunity only
 *    (`FULL_IMMUNITY_IDS`): under Blessing of Protection, Blessing of
 *    Spellwarding or Cloak of Shadows the unit can still be hurt by the other
 *    kind of damage and is read as low (605 files: 12 of the 28 low facts the
 *    whole set removed were under one of those three).
 */
import {
  type AtomicArenaCombat,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { getEnglishSpellName } from "../data/spellEffectData";
import { burstCastSpan } from "../utils/burstLedger";
import {
  gridHpMinInWindow,
  hpTroughInWindow,
  kitSpellReadyAt,
  playerTalentIdSets,
} from "../utils/cooldowns";
import { reconstructEnemyCDTimeline } from "../utils/enemyCDs";
import { fullImmunityIntervals } from "../utils/enemyDefensives";
import { OFFENSIVE_CD_SPELL_IDS } from "../utils/spellDanger";
import { CRISIS_HP_PCT_RENDERED } from "./crisisDecisionPoints";

/** Deaths this long after the lockout ends still count as its outcome. */
export const KICK_OUTCOME_S = 5;

export interface KickSidePressure {
  /** Present when a unit of the side sat at or below CRISIS_HP_PCT_RENDERED
   * on a [STATE] tick of the window (the decision, on the grid). The values
   * are the side's lowest TROUGH inside the lockout and the second it
   * happened at (`hpTroughInWindow`, FT-T03) — at or below that tick. */
  low?: { unit: string; pct: number; atSec: number };
  /** The side's first death from the kick to KICK_OUTCOME_S after the lockout. */
  death?: { unit: string; atSec: number };
  /** The OTHER side's offensive cooldowns already running when the kick
   * landed (ruling A31). */
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

/**
 * How much was at stake while the kick had the school locked — lower sorts
 * first. One predicate over the fields the facts print (`kickPressureFacts`),
 * for kick-eaten's cap (triage 2026-09-29 F-K12a, user ruling A34,
 * 2026-09-30):
 *   0  a death on either side (`*DeathUnit`)
 *   1  a unit at the crisis line on either side (`*LowUnit`)
 *   2  an offensive cooldown running against either side, nothing else
 *   3  only a burst of ours ready (`burstReady`)
 * A kick with none of these is harmless and never reaches the cap.
 */
export function kickPressureTier(p: KickPressure): 0 | 1 | 2 | 3 {
  if (p.ours.death !== undefined || p.theirs.death !== undefined) return 0;
  if (p.ours.low !== undefined || p.theirs.low !== undefined) return 1;
  if (p.ours.burstAgainst.length > 0 || p.theirs.burstAgainst.length > 0)
    return 2;
  return 3;
}

/** Tiers the regular per-round cap may leave uncounted: a kick with a death
 * or a crisis-HP fact (ruling A34's exemption; since 2026-10-01 only the
 * first `KICK_EATEN_EXEMPT_CAP` of them per round). */
export const KICK_CAP_EXEMPT_MAX_TIER = 1;

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
  const immune = new Map<string, ReturnType<typeof fullImmunityIntervals>>();
  /** Does the unit carry a full immunity at that rendered second? */
  const immuneAt = (u: ICombatUnit) => {
    let spans = immune.get(u.id);
    if (!spans) {
      spans = fullImmunityIntervals(u, combat);
      immune.set(u.id, spans);
    }
    const s = spans;
    return (sec: number) => s.some((iv) => iv.fromS <= sec && sec < iv.toS);
  };

  const side = (
    units: ICombatUnit[],
    against: Array<{ from: number; to: number; spell: string }>,
    t0: number,
    t1: number,
  ): KickSidePressure => {
    const s0 = Math.floor(t0);
    const s1 = Math.ceil(t1);
    // the lockout itself, in whole ms: the trough's samples are bounded to it
    const span = {
      fromMs: start + Math.round(t0 * 1000),
      toMs: start + Math.round(t1 * 1000),
    };
    let gridLow = false;
    let low: KickSidePressure["low"];
    for (const u of units) {
      const skip = immuneAt(u);
      // the DECISION stays on the [STATE] grid (ruling D7: crossings do not
      // move) — is any unit of this side at the crisis line on a tick?
      const g = gridHpMinInWindow(u, start, s0, s1, skip);
      if (g && g.pct <= CRISIS_HP_PCT_RENDERED) gridLow = true;
      // the FACT is the trough: the true minimum inside the lockout
      const m = hpTroughInWindow(u, start, s0, s1, skip, span);
      if (m && m.pct <= CRISIS_HP_PCT_RENDERED && (!low || m.pct < low.pct))
        low = { unit: u.name, pct: Math.round(m.pct), atSec: m.atSec };
    }
    // a trough under the line with every tick above it is not a low: the
    // grid did not see a unit at the crisis line, so the fact is not added
    if (!gridLow) low = undefined;
    let death: KickSidePressure["death"];
    for (const u of units) {
      const d = deathS(u);
      if (d !== null && d >= t0 && d <= t1 + KICK_OUTCOME_S && (!death || d < death.atSec))
        death = { unit: u.name, atSec: d };
    }
    const burstAgainst = [
      ...new Set(
        against.filter((b) => b.from <= t0 && b.to > t0).map((b) => b.spell),
      ),
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
          // readiness is read on the rendered second (`s` = floor of the
          // kick); a cooldown pressed between that second and the kick is
          // spent, not ready. Unreachable while every span ran at least
          // 10 s (the cast was then "running"); with the floor gone, a
          // zero-length cooldown cast 0.7 s before the kick was named ready
          // (pre-review: a teammate's Soul Fire at 60.2, kick at 60.9).
          // A press is a SPELL_CAST_SUCCESS, the event `kitSpellReadyAt`
          // prices; the stream holds nothing else today.
          if (
            (u.spellCastEvents ?? []).some((e) => {
              const tS = (e.logLine.timestamp - start) / 1000;
              return (
                e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
                String(e.spellId ?? "") === id &&
                tS > s &&
                tS <= t0
              );
            })
          )
            continue;
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
