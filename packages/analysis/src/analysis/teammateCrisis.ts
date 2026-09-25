/**
 * Teammate crisis, seen from the HEALER's side (GH #95, 2026-09-17).
 *
 * User ruling 2026-09-13: "不管重复不重复 队友被打也要算进去" — a crisis on a
 * TEAMMATE's HP is a decision point for the healer too. This module takes the
 * teammate's own crossings from the shipped predicate
 * (`crisisDecisionPoints(teammate, …)`) and asks, per crossing, what the
 * healer did toward that teammate and whether the healer could act at all.
 *
 * It feeds ONE candidate, `teammate-crisis-idle`
 * (`candidates/teammateCrisisIdle.ts`), and ONE reference table
 * (`data/teammateCrisisPriorGenerated.json`, built by
 * `packages/eval/scripts/teammateCrisisPriorScan.ts` through this same
 * function). codex R3 (astra, three rounds, 2026-09-17) ruled for an
 * observation card only; the user overruled the same day — "这个东西可以做一下
 * 指控" — on the strength of the feasibility door below, so the candidate is
 * an accusation with the crisis-no-response discipline (outcome reference
 * cited, never "you should have pressed X").
 *
 * Definitions (each one was a codex objection or a user ruling; the
 * measurement history is in docs/superpowers/specs/2026-09-16-teammate-crisis-design.md):
 *  - healer ANSWERED = inside the teammate's response window
 *    [t − RESPONSE_PRE_MS, t + RESPONSE_WINDOW_MS] the healer cast on THEM an
 *    external (`CRISIS_EXTERNAL_IDS`), a protective (`CRISIS_PROTECTIVE_ANSWER_IDS`),
 *    a fresh heal (a heal whose spell the healer cast ON THIS TEAMMATE inside
 *    the window — GH #93: a tick of a HoT placed long before is not a press),
 *    control on one of their 2 s attackers, OR an earlier HoT of theirs was
 *    still ticking on them (user ruling 2026-09-15: a carried HoT still
 *    answers the crisis).
 *  - healer could act (codex R1/R2): not CC'd / kicked / silenced / dead at
 *    t, t+1, t+2 and t+3 s (`actionBlockedAt`, the shared predicate); no cast
 *    started before the window that never completed (channelling); within
 *    `TEAMMATE_CRISIS_REACH_YARDS` of the teammate at t; line of sight TRUE
 *    (unknown is excluded — unknown access cannot justify a card); mana at or
 *    above `TEAMMATE_CRISIS_MANA_FLOOR_PCT` when a reading exists.
 *  - everybody is still alive at t (user ruling 2026-09-19, `priorDeath`):
 *    once any player on either side has died, the point is neither a card
 *    nor a table row.
 *  - clean idle = healer did not answer, the teammate did not answer either
 *    (`responded`), the healer cast nothing and started nothing in the
 *    window, did not move `TEAMMATE_CRISIS_MOVE_YARDS` across it (both
 *    endpoint positions known — a missing one is "unknown", never "did not
 *    move"), and is not inside an inactive stretch (no cast for
 *    `TEAMMATE_CRISIS_INACTIVE_STRETCH_MS` on either side — that is a
 *    disconnected / AFK healer, reported separately and never rendered).
 *  - the answered comparator enters the reference table only after the SAME
 *    exclusions (codex R2 condition 2 — unequal filters made the 78 % vs 10 %
 *    contrast compare differently selected populations).
 *
 * Producer rule: everything the card renders comes from this point object; the
 * `diedWithin10s` field is an OUTCOME for the table builder only and must
 * never be read by the producer (same rule as `DecisionPoint.diedWithin10s`).
 */
import { LogEvent } from "@gladlog/parser-compat";

import { getEnglishSpellName } from "../data/spellEffectData";
import {
  cdAvailableAt,
  extractMajorCooldowns,
  gridHpPct,
  type IMajorCooldownInfo,
  isHealerSpec,
  isPassiveProcCast,
} from "../utils/cooldowns";
import { isEnemyCdWindowSpell } from "../utils/enemyCDs";
import { hasLineOfSight } from "../utils/losAnalysis";
import { healerReachYards } from "../utils/spellRange";
import {
  actionBlockedAt,
  CRISIS_CONTROL_IDS,
  CRISIS_EXTERNAL_IDS,
  CRISIS_HP_PCT_RENDERED,
  CRISIS_PROTECTIVE_ANSWER_IDS,
  crisisDecisionPoints,
  DMG_WINDOW_MS,
  ENEMY_BURST_LOOKBACK_MS,
  KITE_GAIN_YARDS,
  RESPONSE_PRE_MS,
  RESPONSE_WINDOW_MS,
} from "./crisisDecisionPoints";

/** Healer → teammate reach for an external / direct heal. The 40 yd figure
 * is the generic friendly-spell range; `docs/BACKLOG.md` #34 recorded that
 * per-spell official ranges differ (some externals are 40, a few shorter) —
 * kept at the generic figure here because the card only claims the healer
 * was "within reach", not that a specific spell was in range. */
export const TEAMMATE_CRISIS_REACH_YARDS = 40;
// ↑ Since GH #83 (2026-09-23) only the FALLBACK: the reach is the healer's own
// (`healerReachYards` — Discipline with Phantom Reach 46, Preservation 30).
/** feasibility is probed at these offsets from the crossing (codex R1:
 * "whole-window", not the crossing instant) */
export const TEAMMATE_CRISIS_BLOCK_PROBE_MS: readonly number[] = [
  0, 1000, 2000, 3000,
];
/** a SPELL_CAST_START this long before the window with no success after it
 * = the healer was channelling / mid-cast when the teammate dropped */
export const TEAMMATE_CRISIS_CHANNEL_LOOKBACK_MS = 5000;
/** endpoint displacement across the window that reads as "repositioning" —
 * the same yardage the kite predicate uses for "gained distance" */
export const TEAMMATE_CRISIS_MOVE_YARDS = KITE_GAIN_YARDS;
export const TEAMMATE_CRISIS_MANA_FLOOR_PCT = 10;
export const TEAMMATE_CRISIS_INACTIVE_STRETCH_MS = 15_000;
/** advancedAction sample tolerance for a position / mana reading at t */
export const TEAMMATE_CRISIS_SAMPLE_TOL_MS = 1500;
/** user ruling 2026-09-17 ("可以严格一点,开大技能现在玩家有插件监视的,只要说的靠谱"):
 * an enemy offensive-cooldown press at least this many seconds before the
 * crossing is stated as a CUE the healer could see on a cooldown tracker —
 * one GCD-and-a-bit of reaction time; a later press is stated as a bare
 * fact with no cue wording. Never "had you opened earlier you would have
 * avoided it" (codex R3 condition 2 stands for the counterfactual). */
export const TEAMMATE_CRISIS_CUE_MIN_S = 2;

export type TeammateCrisisHealerAnswer =
  "external" | "protective" | "freshHeal" | "carriedHeal" | "peel";

/** Why a point is NOT a comparator (neither a card nor a table row). Listed
 * in evaluation order; the first that applies is recorded. */
export type TeammateCrisisExclusion =
  | "healerBlocked"
  | "healerChannelling"
  | "outOfReach"
  | "losBlocked"
  | "losUnknown"
  | "outOfMana"
  | "priorDeath";

/** Which side had already lost a player when the teammate crossed. User
 * ruling 2026-09-19 ("如果已经有人死了 就不要提示;其他时候可以出"): once anybody
 * is dead the round is a different game (a 2v3 is mostly decided, a 3v2 is
 * mostly won) and "you cast nothing" stops being the lesson. The side is
 * recorded so the table rows can re-derive a narrower reading (friendly
 * deaths only) without another archive scan. */
export type TeammateCrisisPriorDeathSide = "friendly" | "enemy" | "both";

/** Why an un-answered comparator point is still not CLEAN idle. */
export type TeammateCrisisIdleReason =
  "busyElsewhere" | "castStarted" | "posUnknown" | "moved" | "inactiveStretch";

export interface TeammateCrisisPoint {
  mateId: string;
  mateName: string;
  /** whole second since round start — `fmtTime`'s grid (from the teammate's
   * own DecisionPoint) */
  tSec: number;
  tMs: number;
  /** the [STATE] tick's reading at tSec, from the teammate's DecisionPoint */
  hpPct: number;
  /** damage taken in the 2 s before the crossing, fraction of max HP
   * (rounded to 2 dp like `DecisionPoint.dmg2s`) */
  dmg2s: number;
  attackerNames: string[];
  /** the most recent enemy offensive-cooldown press inside
   * `ENEMY_BURST_LOOKBACK_MS` before the crossing — the fact the card may
   * state ("X opened Y Ns earlier"); never a timing claim */
  enemyBurst: {
    casterName: string;
    spellId: string;
    spellName: string;
    secondsBefore: number;
  } | null;
  /** the teammate's own answer (`DecisionPoint.responded`) */
  mateResponded: boolean;
  healerAnswers: TeammateCrisisHealerAnswer[];
  healerAnswered: boolean;
  /** heal landed on the teammate from the healer's earlier HoTs inside the
   * window, integer % of the teammate's max HP (0 when none) */
  carriedHealPct: number;
  /** healer → teammate distance at t, whole yards; null when either position
   * is missing */
  distanceYd: number | null;
  /** line of sight healer → teammate at t through `hasLineOfSight`, computed
   * whenever both positions exist — independent of `excluded`, which only
   * tests LoS once the healer is free and in reach (GH #83: the reach fact
   * needs it for every point). null when a position is missing or the map's
   * geometry cannot answer. */
  losClear: boolean | null;
  /** the healer's externals that were off cooldown at t */
  externalsReady: { spellId: string; spellName: string }[];
  /** healer mana at t, integer %, null when the log carried no reading */
  manaPct: number | null;
  excluded: TeammateCrisisExclusion | null;
  /** a player's death at or before t, by side; null when everyone was alive.
   * Non-null ⇒ `excluded` is set (to `priorDeath` unless an earlier reason
   * already applied). */
  priorDeathSide: TeammateCrisisPriorDeathSide | null;
  /** healer did not answer AND cast nothing in the window */
  healerIdle: boolean;
  idleReason: TeammateCrisisIdleReason | null;
  /** user 2026-09-17 ("4 要看一下另外一个队友是否危险"): when the healer was
   * busy elsewhere, whom were they casting on and was THAT unit in crisis —
   * the recipient of the healer's first in-window cast on another friendly,
   * with the [STATE] reading at that cast, and whether ANY in-window cast
   * went to a friendly at or under the crisis line. null when no in-window
   * cast targeted another friendly. */
  busyOn: { name: string; hpPct: number | null; spellName: string } | null;
  busyOnInCrisis: boolean;
  /** the card population: comparator ∧ healerIdle ∧ !mateResponded ∧ no idle
   * reason */
  cleanIdle: boolean;
  /** user ruling 2026-09-17 ("1 我觉得可以") — the `teammate-crisis-triage`
   * population: comparator, healer did not answer THIS teammate, the
   * teammate did not answer either, and every in-window cast the healer made
   * went to a friendly whose [STATE] HP was above the crisis line (the
   * recipient's HP known). Full-archive: 305 such points, teammate died 35 %,
   * vs 215 where the other recipient WAS in crisis, 18 %. */
  misprioritized: boolean;
  /** OUTCOME — for the reference table only. The producer must never read
   * this field. */
  diedWithin10s: boolean;
}

interface Pos {
  x: number;
  y: number;
}

function sampleNear(u: any, ms: number): any | null {
  let best: any = null;
  for (const s of (u?.advancedActions ?? []) as any[]) {
    if ((s.advancedActorMaxHp ?? 0) <= 0) continue;
    const d = Math.abs(s.timestamp - ms);
    if (
      d <= TEAMMATE_CRISIS_SAMPLE_TOL_MS &&
      (!best || d < Math.abs(best.timestamp - ms))
    )
      best = s;
  }
  return best;
}

function posOf(u: any, ms: number): Pos | null {
  const s = sampleNear(u, ms);
  return s?.advancedActorPositionX == null
    ? null
    : { x: s.advancedActorPositionX, y: s.advancedActorPositionY };
}

/** mana (power type 0) at t as an integer percent, null without a reading */
function manaPctAt(u: any, ms: number): number | null {
  const s = sampleNear(u, ms);
  const pw = ((s?.advancedActorPowers ?? []) as any[]).find(
    (p) => Number(p.type) === 0 && (p.max ?? 0) > 0,
  );
  return pw ? Math.round((pw.current / pw.max) * 100) : null;
}

/**
 * Every teammate crossing a HEALER owner could have answered, with what the
 * healer did. Non-healer owners get an empty list (the table is built from
 * healer rounds; a DPS owner's teammate crisis is GH #59's territory).
 *
 * `ledger` lets the product pass the cooldown ledger it already computed;
 * the corpus scan omits it and this function computes its own — same
 * function (`extractMajorCooldowns`), so the two sides agree on readiness.
 */
export function teammateCrisisPoints(
  owner: any,
  combat: any,
  ledger?: IMajorCooldownInfo[],
): TeammateCrisisPoint[] {
  if (!owner?.info || !isHealerSpec(owner.spec)) return [];
  const players = (Object.values(combat?.units ?? {}) as any[]).filter(
    (u) => u.info,
  );
  const friends = players.filter(
    (u) => u.reaction === owner.reaction && u.id !== owner.id,
  );
  const enemies = players.filter((u) => u.reaction !== owner.reaction);
  const enemyIds = new Set(enemies.map((u) => u.id));
  const zoneId = String(combat.zoneId ?? combat.startInfo?.zoneId ?? "");
  // GH #83: this healer's reach — their spec's core heals with the range
  // talents they hold (Phantom Reach 46, Astral Influence 45, Preservation 30)
  const healerReach = healerReachYards(owner, TEAMMATE_CRISIS_REACH_YARDS);
  let cds: IMajorCooldownInfo[];
  if (ledger) cds = ledger;
  else {
    try {
      cds = extractMajorCooldowns(owner, combat);
    } catch {
      cds = [];
    }
  }
  const externalCds = cds.filter((cd) =>
    CRISIS_EXTERNAL_IDS.has(String(cd.spellId)),
  );
  // GH #108: the owner's presses — a passive proc is not the healer acting
  const ownerCasts = ((owner.spellCastEvents ?? []) as any[]).filter(
    (c) =>
      c.logLine?.event === LogEvent.SPELL_CAST_SUCCESS && !isPassiveProcCast(c),
  );
  const ownerStarts = (owner.castStartEvents ?? []) as any[];
  const friendlyDeaths: number[] = [];
  const enemyDeaths: number[] = [];
  for (const u of players)
    for (const d of (u.deathRecords ?? []) as any[])
      (u.reaction === owner.reaction ? friendlyDeaths : enemyDeaths).push(
        d.timestamp as number,
      );
  const enemyBurstCasts: {
    t: number;
    casterName: string;
    spellId: string;
  }[] = [];
  for (const e of enemies) {
    for (const c of (e.spellCastEvents ?? []) as any[]) {
      const sid = String(c.spellId ?? "");
      // one predicate with the enemy-CD window builder and crisisDecisionPoints'
      // enemyBurst (utils/enemyCDs.ts): canonical offensive table AND a real
      // cooldown — never a curse / Ignite the table admits without one
      if (isEnemyCdWindowSpell(sid))
        enemyBurstCasts.push({
          t: c.timestamp,
          casterName: e.name,
          spellId: sid,
        });
    }
  }
  const nameOfUnit = (id: string | undefined): string | null => {
    if (!id) return null;
    const u = combat.units?.[id];
    if (u?.info) return u.name;
    const o = u?.ownerId ? combat.units?.[u.ownerId] : undefined;
    return o?.info ? o.name : null;
  };
  const idOfAttacker = (id: string | undefined): string | null => {
    if (!id) return null;
    const u = combat.units?.[id];
    if (u?.info) return id;
    const o = u?.ownerId ? combat.units?.[u.ownerId] : undefined;
    return o?.info ? u.ownerId : null;
  };

  const out: TeammateCrisisPoint[] = [];
  for (const mate of friends) {
    const mateMax = Math.max(
      1,
      ...((mate.advancedActions ?? []) as any[]).map(
        (x) => x.advancedActorMaxHp ?? 0,
      ),
    );
    const role = isHealerSpec(mate.spec) ? "healer" : "dps";
    let points;
    try {
      points = crisisDecisionPoints(mate, combat, role);
    } catch {
      continue;
    }
    for (const p of points) {
      // the danger floor only — the teammate's own feasibility (stunned,
      // kicked, died fast) is the strongest reason for the healer to act,
      // never a reason to drop the healer's opportunity (codex R1)
      if (!p.dangerous) continue;
      const t = p.tMs;
      const w0 = t - RESPONSE_PRE_MS;
      const w1 = t + RESPONSE_WINDOW_MS;
      const inWin = (ms: number) => ms >= w0 && ms <= w1;
      const attackerIds = new Set<string>();
      const attackerNames = new Set<string>();
      for (const d of (mate.damageIn ?? []) as any[]) {
        if (!(d.timestamp > t - DMG_WINDOW_MS && d.timestamp <= t)) continue;
        const id = idOfAttacker(d.srcUnitId);
        if (!id || !enemyIds.has(id)) continue;
        attackerIds.add(id);
        const n = nameOfUnit(d.srcUnitId);
        if (n) attackerNames.add(n);
      }
      const answers = new Set<TeammateCrisisHealerAnswer>();
      const castIdsOnMate = new Set<string>();
      for (const c of ownerCasts) {
        if (!inWin(c.timestamp)) continue;
        const id = String(c.spellId ?? "");
        const onMate = c.destUnitId === mate.id;
        if (onMate) castIdsOnMate.add(id);
        if (onMate && CRISIS_EXTERNAL_IDS.has(id)) answers.add("external");
        if (onMate && CRISIS_PROTECTIVE_ANSWER_IDS.has(id))
          answers.add("protective");
        if (
          CRISIS_CONTROL_IDS.has(id) &&
          c.destUnitId &&
          attackerIds.has(c.destUnitId)
        )
          answers.add("peel");
      }
      let carried = 0;
      let fresh = false;
      for (const h of (mate.healIn ?? []) as any[]) {
        if (h.srcUnitId !== owner.id) continue;
        if (!(h.timestamp > w0 && h.timestamp <= w1)) continue;
        if (castIdsOnMate.has(String(h.spellId ?? ""))) fresh = true;
        else carried += Math.abs(h.effectiveAmount ?? h.amount ?? 0);
      }
      if (fresh) answers.add("freshHeal");
      else if (carried > 0) answers.add("carriedHeal");
      const healerAnswers = [...answers];
      const healerAnswered = healerAnswers.length > 0;

      // ── could the healer act at all? (exclusions, in order) ──────────────
      let excluded: TeammateCrisisExclusion | null = null;
      const blocked = TEAMMATE_CRISIS_BLOCK_PROBE_MS.some(
        (dt) => actionBlockedAt(owner, combat, t + dt).blocked,
      );
      const channelling = ownerStarts.some(
        (c) =>
          c.timestamp < w0 &&
          c.timestamp >= w0 - TEAMMATE_CRISIS_CHANNEL_LOOKBACK_MS &&
          !ownerCasts.some(
            (x) => x.timestamp >= c.timestamp && x.timestamp <= w1,
          ),
      );
      const pos1 = posOf(owner, t);
      const pos2 = posOf(mate, t);
      const distRaw =
        pos1 && pos2 ? Math.hypot(pos1.x - pos2.x, pos1.y - pos2.y) : null;
      const distanceYd = distRaw === null ? null : Math.round(distRaw);
      const losClear = pos1 && pos2 ? hasLineOfSight(zoneId, pos1, pos2) : null;
      const manaPct = manaPctAt(owner, t);
      if (blocked) excluded = "healerBlocked";
      else if (channelling) excluded = "healerChannelling";
      else if (distRaw === null || distRaw > healerReach)
        excluded = "outOfReach";
      else {
        const los = losClear;
        if (los === false) excluded = "losBlocked";
        else if (los === null) excluded = "losUnknown";
        else if (manaPct !== null && manaPct < TEAMMATE_CRISIS_MANA_FLOOR_PCT)
          excluded = "outOfMana";
      }
      // evaluated last so the older reasons keep their labels in the rows
      const friendlyDown = friendlyDeaths.some((ms) => ms <= t);
      const enemyDown = enemyDeaths.some((ms) => ms <= t);
      const priorDeathSide: TeammateCrisisPriorDeathSide | null =
        friendlyDown && enemyDown
          ? "both"
          : friendlyDown
            ? "friendly"
            : enemyDown
              ? "enemy"
              : null;
      if (excluded === null && priorDeathSide !== null) excluded = "priorDeath";

      // ── idle and its innocent explanations ───────────────────────────────
      const busy = ownerCasts.some((c) => inWin(c.timestamp));
      const healerIdle = !healerAnswered && !busy;
      let idleReason: TeammateCrisisIdleReason | null = null;
      if (!healerAnswered) {
        if (busy) idleReason = "busyElsewhere";
        else if (ownerStarts.some((c) => inWin(c.timestamp)))
          idleReason = "castStarted";
        else {
          const pA = posOf(owner, w0);
          const pB = posOf(owner, w1);
          if (!pA || !pB) idleReason = "posUnknown";
          else if (
            Math.hypot(pA.x - pB.x, pA.y - pB.y) >= TEAMMATE_CRISIS_MOVE_YARDS
          )
            idleReason = "moved";
          else {
            let lastBefore = -Infinity;
            let nextAfter = Infinity;
            for (const c of ownerCasts) {
              if (c.timestamp < w0 && c.timestamp > lastBefore)
                lastBefore = c.timestamp;
              if (c.timestamp > w1 && c.timestamp < nextAfter)
                nextAfter = c.timestamp;
            }
            if (
              w0 - lastBefore >= TEAMMATE_CRISIS_INACTIVE_STRETCH_MS &&
              nextAfter - w1 >= TEAMMATE_CRISIS_INACTIVE_STRETCH_MS
            )
              idleReason = "inactiveStretch";
          }
        }
      }
      const cleanIdle =
        excluded === null && healerIdle && !p.responded && idleReason === null;
      let busyOn: TeammateCrisisPoint["busyOn"] = null;
      let busyOnInCrisis = false;
      if (busy) {
        for (const c of ownerCasts) {
          if (!inWin(c.timestamp)) continue;
          const dest = c.destUnitId ? combat.units?.[c.destUnitId] : undefined;
          if (!dest?.info || dest.id === mate.id) continue;
          if (dest.reaction !== owner.reaction) continue;
          const hpAtCast = gridHpPct(dest, c.timestamp);
          if (!busyOn)
            busyOn = {
              name: dest.name,
              hpPct: hpAtCast,
              spellName:
                getEnglishSpellName(String(c.spellId ?? ""), "") ||
                String(c.spellId ?? ""),
            };
          if (hpAtCast !== null && hpAtCast <= CRISIS_HP_PCT_RENDERED)
            busyOnInCrisis = true;
        }
      }
      const misprioritized =
        excluded === null &&
        !healerAnswered &&
        !p.responded &&
        idleReason === "busyElsewhere" &&
        busyOn !== null &&
        busyOn.hpPct !== null &&
        !busyOnInCrisis;

      let burst: TeammateCrisisPoint["enemyBurst"] = null;
      for (const b of enemyBurstCasts) {
        if (!(b.t > t - ENEMY_BURST_LOOKBACK_MS && b.t <= t)) continue;
        if (!burst || b.t > t - burst.secondsBefore * 1000)
          burst = {
            casterName: b.casterName,
            spellId: b.spellId,
            spellName: getEnglishSpellName(b.spellId, "") || b.spellId,
            secondsBefore: Math.round((t - b.t) / 1000),
          };
      }

      out.push({
        mateId: mate.id,
        mateName: mate.name,
        tSec: p.tSec,
        tMs: t,
        hpPct: p.hpPct,
        dmg2s: p.dmg2s,
        attackerNames: [...attackerNames],
        enemyBurst: burst,
        mateResponded: p.responded,
        healerAnswers,
        healerAnswered,
        carriedHealPct: Math.round((carried / mateMax) * 100),
        distanceYd,
        losClear,
        externalsReady: externalCds
          .filter((cd) => cdAvailableAt(cd, p.tSec))
          .map((cd) => ({
            spellId: String(cd.spellId),
            spellName: cd.spellName,
          })),
        manaPct,
        excluded,
        priorDeathSide,
        healerIdle,
        idleReason,
        cleanIdle,
        busyOn,
        busyOnInCrisis,
        misprioritized,
        diedWithin10s: p.diedWithin10s,
      });
    }
  }
  return out.sort((a, b) => a.tSec - b.tSec);
}
