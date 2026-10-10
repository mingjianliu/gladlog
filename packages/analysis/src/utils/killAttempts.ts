/**
 * Kill attempts, anchored on control flow (2026-08-18 redesign, user ruling:
 * "没有控制流的伤害基本没有任何意义" — damage without control is mostly
 * meaningless; only very high burst is an exception).
 *
 * This replaces the analysis UNIT, not just a threshold: the old "kill
 * window" (`computeOffensiveWindows`) is a long-lived STATE — "this enemy has
 * no major defensive up" — with a corpus median of 36s, 80.3% of windows
 * overlapping another enemy's and 37% fully covered by one (2026-08-18
 * measurement), which made every per-window exclusivity judgement
 * arithmetically self-contradictory. A kill attempt is an EVENT: a stun chain
 * landing on one target with real team damage behind it, lasting seconds.
 *
 * Anchor = STUNS ONLY, not "hard CC". Corpus validation (same day, 8,791
 * hard-CC landings): kills convert through stuns at 4.8% (prime tier) while
 * Incapacitate converts at 1.1% and Cyclone at 0.0% — breakable/
 * damage-immune CC is setup, not a kill window. See GH #16 tier-validation
 * report.
 *
 * Deliberately reused predicates (CLAUDE.md shared-predicate rule — every
 * number here is somebody else's established constant, none invented):
 *  - chain grouping: two stuns on the same target belong to one attempt iff
 *    they belong to one DR chain — `drResetMsAt` (era-aware 16s/20s), the
 *    same window `getDRLevel` walks;
 *  - "real damage behind it": `KW_BURST_MIN_DAMAGE` (30k), offensiveWindows'
 *    existing "qualifies as a kill attempt" floor. 2026-08-20 接地(GH #16,
 *    用户裁定保留):n=7695 条门前晕链(12.1 语料)实测,地板仅丢 10.1% 的
 *    链、其中 2 次击杀 —— 作为「排除纯 peel」的宽松定义地板几乎无害;
 *    转化率随伤害平滑上升(30–120k ≈0.1% → ≥500k 3.9%)无尖锐膝点,故不
 *    收紧。⚠ 绝对伤害值会随赛季装备膨胀腐烂(同 DISPEL_PENALTY 换号腐烂
 *    的数值形态)—— 每次大版本/赛季复查一次本数字;
 *    候选替代形态是目标最大血量百分比,登记待议。
 *  - kill credit: death within `KILL_CREDIT_SLACK_S` (5s) after the span —
 *    burstLedger's existing credit slack;
 *  - opportunity tier at attempt start: `killOpportunityAt` (the corpus-
 *    validated three-tier model, single source in killWindowTargetSelection).
 *
 * Failure attribution answers "this attempt did NOT convert — why", from
 * flags observable inside the span. `defensivePopped` / `externalReceived` /
 * `outhealed` are exactly the facts the 2026-08-18 tier validation showed to
 * be REVERSE-causal as prospective signals (already-active DR converts at
 * 8.4%, the highest of any cut, because it marks a kill already in progress)
 * — they belong here, after the fact, and must never migrate into the
 * opportunity tier.
 *
 * v2 (2026-08-20, user ruling 建): the second anchor path — "no control but
 * an offensive-cooldown burst with real damage" (用户主判据:看大技能使用)。
 * Team offensive major casts are pooled and clustered by the SAME
 * active-span-overlap walk analyzeBurstLedger uses per player
 * (`burstCastSpan` reach — zero new numbers); a cluster whose dominant
 * target took >= KW_BURST_MIN_DAMAGE becomes a burst-anchored attempt,
 * unless a stun-anchored attempt already covers that target in an
 * overlapping span (stun anchor wins — richer DR/chain attribution).
 * Grounding (12.1 corpus, 2114 rounds / 1139 enemy kills): stun anchor
 * covered 20.1% of kills; this anchor lifts coverage to 80.5%; the
 * remaining 19.5% are grind kills (neither anchor) and stay unmodelled.
 * 辅判据(dps 事后分布的速率分位)未实现 —— 需要自己的接地轮,留档。
 */
import {
  CombatUnitSpec,
  IArenaMatch,
  ICombatUnit,
  IShuffleRound,
} from "@gladlog/parser-compat";

import { SCHOOL_SAVE_MIN_SHARE } from "../analysis/candidates/cooldownTiming";
import { schoolShareCoveredBy } from "../analysis/crisisDecisionPoints";
import { fmtFactTime } from "../analysis/factFormat";
import { CandidateEvent } from "../analysis/types";
import {
  resolveMitigation,
  strongestComponentPct,
} from "../data/mitigationComponents";
import { ATTEMPT_INTO_TRINKET_OUTCOME_REF } from "../data/outcomeRefs";
import { getEnglishSpellName } from "../data/spellEffectData";
import { TIMELINE_LINE_FLAGS } from "../data/timelineLineFlags";
import { burstCastSpan, KILL_CREDIT_SLACK_S } from "./burstLedger";
import {
  analyzePlayerCCAndTrinket,
  breakAbilityPresses,
  findBrokenCC,
  type ICCInstance,
  type IPlayerCCTrinketSummary,
} from "./ccTrinketAnalysis";
import { analyzeOutgoingCCChains, DRLevel, drResetMsAt } from "./drAnalysis";
import { reconstructEnemyCDTimeline } from "./enemyCDs";
import {
  effectSaves,
  enemyDefensiveEvents,
  externalAuraOf,
  type IEnemyDefensiveEvent,
  immunityCountsWhenAlreadyUp,
  type ISaveAuraInterval,
  isImmunitySaveAura,
  isIntervalFrom,
  limitedAbsorbSchoolMask,
  limitedImmunitySchoolMask,
  MITIGATION_AURA_IDS,
  MITIGATION_AURA_MIN_PCT,
  SAVE_AURA_END_UNSEEN_NAMES,
  SAVE_CAST_AURA_PAIR_S,
  saveAuraCountsWhenAlreadyUp,
  saveAuraIntervals,
  SELF_SAVE_IDS,
  selfSaveCasts,
  wallTableIdOfAura,
} from "./enemyDefensives";
import {
  documentRecordsAttackSpell,
  incomingPressureBySchool,
} from "./incomingPressure";
import {
  getHpPercentAtTime,
  IKillOpportunity,
  killOpportunityAt,
  KillOpportunityTier,
  WALL_IN_HAND_MIT_IDS,
} from "./killWindowTargetSelection";
import { KW_BURST_MIN_DAMAGE } from "./offensiveWindows";
import { pvpTrinketUses } from "./pvpTrinketUses";
import { fmtTime, toRenderSecond } from "./renderGrid";
import { buildRosterSides, type RosterSides } from "./rosterSide";
import { roundEndMs } from "./roundEnd";
import { offensiveEffectCdId } from "./spellDanger";

// The defensive sets live in enemyDefensives.ts since GH #97 (2026-09-15):
// the timeline's [ENEMY DEF] line and this attribution must agree on what a
// wall is, so both import the same objects.

export interface IKillAttemptStun {
  atSeconds: number;
  durationSeconds: number;
  spellName: string;
  casterName: string;
  drLevel: DRLevel;
}

/** Why a non-converted attempt failed. Flags are independently observable;
 * `primary` picks the first true one in declaration order (trinket beats
 * defensive beats external beats healing), `"pressure"` is the residual —
 * nothing visible saved the target, the damage simply wasn't enough. When
 * both `trinketed` and `immunityBaited` hold the rendered cause names both
 * (ruling A29); `primary` stays `"trinketed"`. What each flag's window is:
 * see `attributeFailure`. */
export interface IKillAttemptAttribution {
  trinketed: boolean;
  /** Enemy-def F-E21 (ruling A′15): racials / class abilities that removed a
   * control of this attempt (Will to Survive, Blink, Berserker Shout …) —
   * `breakAbilityUses` bound by the same binder as the trinket. A break that
   * is itself a wall or a self-save (Icebound Fortitude, Lichborne) is not
   * listed here: it is credited as that. Optional for hand-built fixtures. */
  brokeOut?: string[];
  immunityBaited: boolean;
  /** Round seconds the immunity went up, set only when it was already up when
   * the attempt began and none went up inside the credit window (F-E22
   * rule 2) — rendered `forced a full immunity [up since m:ss]`. Optional for
   * hand-built fixtures. */
  immunityUpSinceS?: number;
  defensivePopped: string[];
  /** round seconds of each `defensivePopped` entry's aura start (parallel array) */
  defensivePoppedAtS: number[];
  externalReceived: string[];
  /** round seconds of each `externalReceived` cast (parallel array) */
  externalReceivedAtS: number[];
  /** B4a (2026-09-25): the target's own no-%-mitigation saves in the span
   * (`selfSaveCasts`, the same predicate the [ENEMY DEF] self-save line uses)
   * — and, since ruling D8 (2026-10-10), its effect saves (`effectSaves`:
   * Feign Death's shield, a Nature's Guardian / Cheat Death / Cauterize
   * proc), which were `immunityBaited` before it. */
  selfSaved: string[];
  selfSavedAtS: number[];
  outhealed: boolean;
  primary:
    | "trinketed"
    | "broke-out"
    | "immunity-baited"
    | "defensive"
    | "external"
    | "self-saved"
    | "outhealed"
    | "pressure";
}

export interface IKillAttemptSofterTarget {
  name: string;
  tier: Exclude<KillOpportunityTier, "locked">;
  wallsInHand: string[];
}

export interface IKillAttempt {
  targetUnitId: string;
  targetName: string;
  /** What anchors this attempt: a stun chain (v1) or an offensive-CD burst
   * cluster (v2, 2026-08-20). */
  anchor: "stun" | "burst";
  /** The opener's spell name — stuns[0] for stun anchor, the cluster's first
   * offensive cast for burst anchor. */
  anchorSpellName: string;
  /** Stun anchor: first stun landing → last stun expiry.
   * Burst anchor: first offensive cast → cluster reach (burstCastSpan).
   * Neither runs past the round's end (`roundEndMs`), and a KILL ends at the
   * death it is credited with when that comes first (T12 ① d). */
  fromSeconds: number;
  toSeconds: number;
  /** Empty for burst-anchored attempts. */
  stuns: IKillAttemptStun[];
  /** Opportunity tier of the target when the attempt STARTED (prospective —
   * the corpus-validated model; see killOpportunityAt). */
  opportunity: IKillOpportunity;
  /** The softest OTHER enemy alive at the attempt start, present only when
   * its tier was strictly softer than the target's (see softerTargetAt).
   * Absent = nobody was a softer target, which at a match opener is the
   * normal state — every trinket is up — and therefore not a targeting
   * question (user ruling 2026-09-22). */
  softerTarget?: IKillAttemptSofterTarget;
  /** DR level of the opening stun (Full = the chain started clean).
   * Absent for burst-anchored attempts (no stun to grade). */
  openingDrLevel?: DRLevel;
  /** Team damage inside [from, to + KILL_CREDIT_SLACK_S] — `to` as the
   * anchor set it, before a KILL's `toSeconds` is cut at the death. */
  teamDamageToTarget: number;
  teamDamageTotal: number;
  /** 0–100: share of team damage that landed on the attempt's target. */
  teamOnTargetPct: number;
  killed: boolean;
  /** The death this attempt is credited with, match-relative seconds —
   * present exactly when `killed` (one death, one KILL). */
  killedAtSeconds?: number;
  /** Present exactly when !killed. */
  attribution?: IKillAttemptAttribution;
}

interface StunApp {
  atSeconds: number;
  durationSeconds: number;
  spellId: string;
  spellName: string;
  casterName: string;
  drLevel: DRLevel;
}

const TIER_RANK: Record<KillOpportunityTier, number> = {
  prime: 0,
  gated: 1,
  locked: 2,
};

/** The DR categories of a CC damage breaks (or, Cyclone, that cannot be
 * hit): an enemy in one of OUR CCs of these is no softer target (F-K6). */
const BREAKABLE_DR_CATEGORIES: ReadonlySet<string> = new Set([
  "Disorient",
  "Incapacitate",
]);

/**
 * Among the OTHER enemies still alive at `atSeconds`, the one in a strictly
 * softer tier than `target` (prime beats gated beats locked; ties break on
 * lowest HP, the betterTargetExists rule). `null` when nobody was softer.
 *
 * Why this exists (user ruling 2026-09-22): the [KILL ATTEMPTS] block used
 * to stamp every attempt on a trinket-up target `locked (trinket up)` and
 * count them in its summary — including the 0:05 opener, where every enemy's
 * trinket is up by definition (cooldowns reset at the gates). The model read
 * that as "you should not have opened on someone with a trinket", an
 * accusation the user called absurd: forcing the trinket with the opener IS
 * the play. The tier only carries coaching information relative to the
 * alternatives, so the block now names the softer alternative when one
 * existed and says "no softer target" otherwise. Shared with the
 * attempt-into-trinket mapper so the fact block and the (now retired)
 * candidate can never disagree about who the softer target was.
 */
export function softerTargetAt(
  target: ICombatUnit,
  enemies: readonly ICombatUnit[],
  atSeconds: number,
  matchStartMs: number,
  /** death-kill F-K6 (ruling A′7 = A): an enemy sitting in a CC our team
   * applied that damage would break (DR Disorient / Incapacitate; Cyclone
   * cannot be hit at all) is no softer target — the team could not act on
   * it without breaking its own control. Absent ⇒ nobody is skipped. */
  inOurBreakableCc?: (e: ICombatUnit, atMs: number) => boolean,
): IKillAttemptSofterTarget | null {
  const atMs = matchStartMs + atSeconds * 1000;
  const targetRank =
    TIER_RANK[killOpportunityAt(target, atSeconds, matchStartMs).tier];
  let best: IKillAttemptSofterTarget | null = null;
  let bestRank = targetRank;
  let bestHp = Infinity;
  for (const e of enemies) {
    if (e.id === target.id) continue;
    if (e.deathRecords.some((rec) => rec.timestamp <= atMs)) continue;
    if (inOurBreakableCc?.(e, atMs)) continue;
    const opp = killOpportunityAt(e, atSeconds, matchStartMs);
    if (opp.tier === "locked") continue;
    const rank = TIER_RANK[opp.tier];
    if (rank >= targetRank) continue; // not strictly softer than the target
    if (best !== null && rank > bestRank) continue;
    const hp = getHpPercentAtTime(e, atSeconds, matchStartMs) ?? Infinity;
    if (best !== null && rank === bestRank && hp >= bestHp) continue;
    best = { name: e.name, tier: opp.tier, wallsInHand: opp.wallsInHand };
    bestRank = rank;
    bestHp = hp;
  }
  return best;
}

function softerField(
  target: ICombatUnit,
  enemies: readonly ICombatUnit[],
  atSeconds: number,
  matchStartMs: number,
  inOurBreakableCc?: (e: ICombatUnit, atMs: number) => boolean,
): { softerTarget?: IKillAttemptSofterTarget } {
  const softer = softerTargetAt(
    target,
    enemies,
    atSeconds,
    matchStartMs,
    inOurBreakableCc,
  );
  return softer ? { softerTarget: softer } : {};
}

/**
 * Extracts stun-anchored kill attempts. `friendlies` are the attackers,
 * `enemies` the potential targets — pass them exactly as the other
 * `analyzeOutgoingCCChains` product call sites do.
 */
export function extractKillAttempts(
  friendlies: ICombatUnit[],
  enemies: ICombatUnit[],
  combat: IArenaMatch | IShuffleRound,
): IKillAttempt[] {
  const matchStartMs = combat.startTime;
  const chainGapS = drResetMsAt(matchStartMs) / 1000;
  const enemyByName = new Map(enemies.map((e) => [e.name, e]));
  const readingsOf = targetReadingsFactory(enemies, friendlies, combat);
  // F-K6: the target's CC instances (`[CC ON ENEMY]`'s, our pets as sources)
  // read once per enemy through the same per-match readings
  const inOurBreakableCc = (e: ICombatUnit, atMs: number): boolean => {
    const t = (atMs - matchStartMs) / 1000;
    return readingsOf(e)
      .ccSummary()
      .ccInstances.some(
        (cc) =>
          BREAKABLE_DR_CATEGORIES.has(cc.drInfo?.category ?? "") &&
          cc.atSeconds <= t &&
          t < cc.atSeconds + cc.durationSeconds,
      );
  };
  // One death, one KILL (T2 → G2): the death each `killed` attempt credits,
  // decided once every attempt exists; failures are attributed after that.
  const creditedDeathMs = new Map<IKillAttempt, number>();
  // F-K2: covered burst clusters kept only because they reach the death
  const keptForTheKill = new Set<IKillAttempt>();
  const toAttribute: Array<{
    attempt: IKillAttempt;
    target: ICombatUnit;
    span: { fromMs: number; toMs: number; creditToMs: number };
    anchor: AttemptAnchor;
  }> = [];
  const creditOf = (
    target: ICombatUnit,
    spanFromMs: number,
    spanToMs: number,
  ): number | undefined =>
    target.deathRecords.find(
      (rec) => rec.timestamp >= spanFromMs && rec.timestamp <= spanToMs,
    )?.timestamp;

  // 1) Stun landings per target (Full/50% only — an Immune landing has no
  //    duration and anchors nothing).
  const stunsByTarget = new Map<string, StunApp[]>();
  for (const chain of analyzeOutgoingCCChains(friendlies, enemies, combat)) {
    if (!enemyByName.has(chain.targetName)) continue;
    for (const app of chain.applications) {
      if (app.drInfo.category !== "Stun") continue;
      if (app.drInfo.level !== "Full" && app.drInfo.level !== "50%") continue;
      const arr = stunsByTarget.get(chain.targetName) ?? [];
      arr.push({
        atSeconds: app.atSeconds,
        durationSeconds: app.durationSeconds,
        spellId: app.spellId,
        spellName: app.spellName,
        casterName: app.casterName,
        drLevel: app.drInfo.level,
      });
      stunsByTarget.set(chain.targetName, arr);
    }
  }

  // T12 ① d (user ruling 2026-10-10: a kill-attempt line does not run past
  // the round's end). `roundEndMs` is the one round end; both anchors end
  // there, and an anchor that starts at or after it is not in the round.
  // 101-3-555 (Duration 2:20): `[2:18–2:21] on … Storm Bolt opener` — the
  // last stun's nominal end.
  const roundEndS = (roundEndMs(combat) - matchStartMs) / 1000;

  const attempts: IKillAttempt[] = [];
  for (const [targetName, stuns] of stunsByTarget) {
    const target = enemyByName.get(targetName)!;
    stuns.sort((a, b) => a.atSeconds - b.atSeconds);

    // 2) Group into DR chains: next stun joins the attempt iff it starts
    //    within the DR reset window of the previous stun's end — the exact
    //    walk getDRLevel does, so "one attempt" can never disagree with
    //    "one DR chain".
    const groups: StunApp[][] = [];
    for (const stun of stuns) {
      const cur = groups[groups.length - 1];
      const prevEnd = cur
        ? cur[cur.length - 1].atSeconds + cur[cur.length - 1].durationSeconds
        : -Infinity;
      if (cur && stun.atSeconds - prevEnd < chainGapS) cur.push(stun);
      else groups.push([stun]);
    }

    for (const group of groups) {
      const fromSeconds = group[0].atSeconds;
      if (fromSeconds >= roundEndS) continue;
      const last = group[group.length - 1];
      const toSeconds = Math.max(
        Math.min(last.atSeconds + last.durationSeconds, roundEndS),
        fromSeconds,
      );
      const spanFromMs = matchStartMs + fromSeconds * 1000;
      const spanToMs = matchStartMs + (toSeconds + KILL_CREDIT_SLACK_S) * 1000;

      // 3) Team damage inside the span (target + all enemies, one pass).
      let teamDamageToTarget = 0;
      let teamDamageTotal = 0;
      const enemyIds = new Set(enemies.map((e) => e.id));
      for (const f of friendlies) {
        for (const d of f.damageOut) {
          const ts = d.logLine.timestamp;
          if (ts < spanFromMs || ts > spanToMs) continue;
          if (!enemyIds.has(d.destUnitId)) continue;
          const amount = Math.abs(d.effectiveAmount);
          teamDamageTotal += amount;
          if (d.destUnitId === target.id) teamDamageToTarget += amount;
        }
      }
      // CC without real damage behind it is peel/setup, not a kill attempt —
      // same floor offensiveWindows uses for its burst sub-windows.
      if (teamDamageToTarget < KW_BURST_MIN_DAMAGE) continue;

      const deathMs = creditOf(target, spanFromMs, spanToMs);
      const killed = deathMs !== undefined;

      const attempt: IKillAttempt = {
        targetUnitId: target.id,
        targetName,
        anchor: "stun",
        anchorSpellName: group[0].spellName,
        fromSeconds,
        toSeconds,
        stuns: group,
        opportunity: killOpportunityAt(target, fromSeconds, matchStartMs),
        ...softerField(
          target,
          enemies,
          fromSeconds,
          matchStartMs,
          inOurBreakableCc,
        ),
        openingDrLevel: group[0].drLevel,
        teamDamageToTarget,
        teamDamageTotal,
        teamOnTargetPct:
          teamDamageTotal > 0
            ? Math.round((100 * teamDamageToTarget) / teamDamageTotal)
            : 0,
        killed,
      };
      if (deathMs !== undefined) creditedDeathMs.set(attempt, deathMs);
      toAttribute.push({
        attempt,
        target,
        span: {
          fromMs: spanFromMs,
          toMs: matchStartMs + toSeconds * 1000,
          creditToMs: spanToMs,
        },
        anchor: { kind: "stun", stuns: group },
      });
      attempts.push(attempt);
    }
  }

  // 4) Burst-anchored attempts (v2, see the header comment): pool every
  //    friendly's offensive major casts, cluster by the SAME active-span
  //    overlap walk analyzeBurstLedger uses per player (burstCastSpan reach),
  //    then treat each cluster like a stun chain: dominant target, the same
  //    KW_BURST_MIN_DAMAGE floor, the same kill-credit slack. A cluster whose
  //    target is already covered by an overlapping stun-anchored attempt is
  //    skipped — the stun anchor carries richer DR/chain attribution.
  {
    const teamCasts: Array<{ cast: number; to: number; spellName: string }> =
      [];
    for (const f of friendlies) {
      const cds =
        reconstructEnemyCDTimeline([f], combat).players[0]?.offensiveCDs ?? [];
      for (const cd of cds) {
        if (!anchorsKillAttempt(f, cd.spellId)) continue;
        const span = burstCastSpan(cd);
        teamCasts.push({
          cast: cd.castTimeSeconds,
          to: span.to,
          spellName: cd.spellName,
        });
      }
    }
    teamCasts.sort((a, b) => a.cast - b.cast);
    const clusters: Array<{ from: number; to: number; opener: string }> = [];
    {
      let cur: { from: number; to: number; opener: string } | null = null;
      for (const c of teamCasts) {
        if (cur && c.cast <= cur.to) {
          cur.to = Math.max(cur.to, c.to);
        } else {
          if (cur) clusters.push(cur);
          cur = { from: c.cast, to: c.to, opener: c.spellName };
        }
      }
      if (cur) clusters.push(cur);
    }
    for (const cl of clusters) {
      const fromSeconds = cl.from;
      if (fromSeconds >= roundEndS) continue;
      const toSeconds = Math.min(cl.to, roundEndS);
      const spanFromMs = matchStartMs + fromSeconds * 1000;
      const spanToMs = matchStartMs + (toSeconds + KILL_CREDIT_SLACK_S) * 1000;
      // Team damage per enemy inside the span (one pass).
      const dmgByEnemy = new Map<string, number>();
      let teamDamageTotal = 0;
      const enemyIds = new Set(enemies.map((e) => e.id));
      for (const f of friendlies) {
        for (const d of f.damageOut) {
          const ts = d.logLine.timestamp;
          if (ts < spanFromMs || ts > spanToMs) continue;
          if (!enemyIds.has(d.destUnitId)) continue;
          const amount = Math.abs(d.effectiveAmount);
          teamDamageTotal += amount;
          dmgByEnemy.set(
            d.destUnitId,
            (dmgByEnemy.get(d.destUnitId) ?? 0) + amount,
          );
        }
      }
      let target: ICombatUnit | null = null;
      let teamDamageToTarget = 0;
      for (const [id, dmg] of dmgByEnemy) {
        if (dmg > teamDamageToTarget) {
          teamDamageToTarget = dmg;
          target = enemies.find((e) => e.id === id) ?? null;
        }
      }
      if (!target || teamDamageToTarget < KW_BURST_MIN_DAMAGE) continue;
      const covered = attempts.some(
        (a) =>
          a.targetUnitId === target!.id &&
          a.fromSeconds <= toSeconds &&
          a.toSeconds >= fromSeconds,
      );
      const deathMs = creditOf(target, spanFromMs, spanToMs);
      // death-kill F-K2 (ruling A13 = R1 option A): "the stun anchor wins"
      // only when that stun attempt got the kill. A covered cluster that
      // alone reaches its target's death is kept (a0a48716 [2:33–3:01]:
      // the stun attempt's credit ended before the Bloodlust go killed).
      if (
        covered &&
        (deathMs === undefined ||
          attempts.some(
            (a) =>
              a.anchor === "stun" &&
              a.killed &&
              a.targetUnitId === target!.id &&
              a.fromSeconds <= toSeconds &&
              a.toSeconds >= fromSeconds,
          ))
      )
        continue;
      const killed = deathMs !== undefined;
      const attempt: IKillAttempt = {
        targetUnitId: target.id,
        targetName: target.name,
        anchor: "burst",
        anchorSpellName: cl.opener,
        fromSeconds,
        toSeconds,
        stuns: [],
        opportunity: killOpportunityAt(target, fromSeconds, matchStartMs),
        ...softerField(
          target,
          enemies,
          fromSeconds,
          matchStartMs,
          inOurBreakableCc,
        ),
        teamDamageToTarget,
        teamDamageTotal,
        teamOnTargetPct:
          teamDamageTotal > 0
            ? Math.round((100 * teamDamageToTarget) / teamDamageTotal)
            : 0,
        killed,
      };
      if (deathMs !== undefined) creditedDeathMs.set(attempt, deathMs);
      if (covered) keptForTheKill.add(attempt);
      toAttribute.push({
        attempt,
        target,
        span: {
          fromMs: spanFromMs,
          toMs: matchStartMs + toSeconds * 1000,
          creditToMs: spanToMs,
        },
        anchor: { kind: "burst" },
      });
      attempts.push(attempt);
    }
  }

  // One death, one KILL (from the T2 session; 605 files: 44 (owner, target)
  // pairs with two or more KILL rows). Attempts credit a death anywhere in
  // [from, to + KILL_CREDIT_SLACK_S], so a burst cluster opened after a stun
  // attempt ended can credit the same death. It goes to the attempt the
  // death fell inside ([from, to]); among several, or none, the one that
  // started last before it. The others are attempts that did not convert.
  const byDeath = new Map<string, IKillAttempt[]>();
  for (const [a, ms] of creditedDeathMs) {
    const key = `${a.targetUnitId}:${ms}`;
    byDeath.set(key, [...(byDeath.get(key) ?? []), a]);
  }
  for (const [key, list] of byDeath) {
    const deathS = (Number(key.split(":").pop()) - matchStartMs) / 1000;
    if (list.length > 1) {
      const inside = list.filter(
        (a) => deathS >= a.fromSeconds && deathS <= a.toSeconds,
      );
      const keep = (inside.length > 0 ? inside : list).reduce((b, a) =>
        a.fromSeconds > b.fromSeconds ? a : b,
      );
      for (const a of list) if (a !== keep) a.killed = false;
    }
    for (const a of list)
      if (a.killed) {
        a.killedAtSeconds = deathS;
        // T12 ① d: a KILL's bracket does not run past the death it is
        // credited with (100-2-534: `[2:02–2:16] … Zenith burst (no stun) |
        // … | KILL`, the target dead at 2:14 — the cooldown's own reach). A
        // death in the kill-credit slack after the bracket leaves it alone.
        // Cut on the attempt itself: `[FORCED TRINKET]` prints the same
        // object's span, and the summary's "outside every attempt window"
        // tests the brackets as printed.
        a.toSeconds = Math.min(a.toSeconds, deathS);
      }
  }
  // …and a covered cluster whose death went to another row did not "alone
  // reach the kill": it stays skipped, as before F-K2
  for (let i = attempts.length - 1; i >= 0; i--) {
    const a = attempts[i]!;
    if (keptForTheKill.has(a) && !a.killed) attempts.splice(i, 1);
  }
  for (const { attempt, target, span, anchor } of toAttribute) {
    if (attempt.killed || keptForTheKill.has(attempt)) continue;
    attempt.attribution = attributeFailure(
      target,
      enemies,
      friendlies,
      combat,
      span,
      anchor,
      readingsOf(target),
    );
  }

  attempts.sort((a, b) => a.fromSeconds - b.fromSeconds);
  return attempts;
}

/**
 * Offensive cooldowns that do NOT anchor a kill attempt of the attacking
 * team, by the spec that pressed them — B-tier B15c-U10 (user ruling
 * 2026-10-06): "我方奶骑的复仇之怒不当击杀尝试的锚". A Holy Paladin's wings
 * are a healing cooldown as often as a go (06bb9860: two `Avenging Wrath
 * burst (no stun)` rows opened by the log owner healing through pressure).
 * The cast neither opens a burst cluster nor extends one. Keyed on the
 * canonical cooldown (`offensiveEffectCdId`), so an activation of it is
 * covered too. The ENEMY side — burst windows, crisis `enemyBurst` — does not
 * read this (ruling A27 stands). Registered in curatedIdRegistry.
 */
export const KILL_ATTEMPT_NON_ANCHOR_CDS: ReadonlyMap<
  CombatUnitSpec,
  ReadonlySet<string>
> = new Map([
  [CombatUnitSpec.Paladin_Holy, new Set(["31884"])], // Avenging Wrath
]);

/** May this friendly's offensive cast open or extend a burst-anchored kill
 * attempt (`KILL_ATTEMPT_NON_ANCHOR_CDS`)? */
export function anchorsKillAttempt(
  attacker: Pick<ICombatUnit, "spec">,
  spellId: string,
): boolean {
  const cdId = offensiveEffectCdId(spellId) ?? spellId;
  return !KILL_ATTEMPT_NON_ANCHOR_CDS.get(attacker.spec)?.has(cdId);
}

/** GH #97 cheap alternative to the [ENEMY DEF] timeline line: the summary
 * names WHEN the wall went up (`popped Barkskin@2:17`) instead of a timeline
 * line. Only one of the two renders (TIMELINE_LINE_FLAGS.enemyDef). */
function stampNames(
  names: string[],
  atS: number[],
  spanFromSeconds: number,
): string {
  if (TIMELINE_LINE_FLAGS.enemyDef !== "stamp")
    return names
      .map((n, i) => {
        // F-E22 rule 2: a save that was already up when the attempt began is
        // marked with the second it went up — the second its [ENEMY DEF] line
        // sits at, so the gate can find that line outside the span. One that
        // went up inside the span's own first second needs no mark.
        const at = atS[i];
        return at !== undefined &&
          toRenderSecond(at) < toRenderSecond(spanFromSeconds)
          ? `${n} [up since ${fmtTime(at)}]`
          : n;
      })
      .join("/");
  return names
    .map((n, i) => (atS[i] !== undefined ? `${n}@${fmtTime(atS[i]!)}` : n))
    .join("/");
}

/** Short English cause for prompt/facts rendering. immunity-baited is worded
 * as a win per the user ruling — never a reproach. */
function failureText(
  attr: IKillAttemptAttribution,
  spanFromSeconds: number,
): string {
  // Rule 2, as for a wall (`stampNames`): an immunity that was already up
  // when the attempt began says since when — this attempt did not force it.
  const upSince =
    TIMELINE_LINE_FLAGS.enemyDef !== "stamp" &&
    attr.immunityUpSinceS !== undefined &&
    toRenderSecond(attr.immunityUpSinceS) < toRenderSecond(spanFromSeconds)
      ? ` [up since ${fmtTime(attr.immunityUpSinceS)}]`
      : "";
  const immunity = `forced a full immunity${upSince} (a win — re-open after it drops)`;
  switch (attr.primary) {
    case "trinketed":
      // User ruling A29 (2026-09-30, "两个都写"): an attempt that met both a
      // trinket bound to one of its stuns and an immunity names both.
      return attr.immunityBaited
        ? `target trinketed out; ${immunity}`
        : "target trinketed out";
    case "broke-out":
      // Named like the trinket's cause; an immunity in the same attempt is
      // listed with it, as for the trinket (A29).
      return `broke out (${(attr.brokeOut ?? []).join("/")})${attr.immunityBaited ? `; ${immunity}` : ""}`;
    case "immunity-baited":
      return immunity;
    case "defensive":
    case "external":
    case "self-saved": {
      const popped = attr.defensivePopped.length
        ? `popped ${stampNames(attr.defensivePopped, attr.defensivePoppedAtS, spanFromSeconds)}`
        : "";
      // An external that carries a % reduction (Pain Suppression, Ironbark)
      // is already on the wall list — `defensivePopped` names every wall
      // aura on the target, whoever put it there — so it is not named a
      // second time as the external beside it.
      const extra = attr.externalReceived
        .map((_, i) => i)
        .filter(
          (i) => !attr.defensivePopped.includes(attr.externalReceived[i]!),
        );
      const external = extra.length
        ? `saved by external (${stampNames(
            extra.map((i) => attr.externalReceived[i]!),
            extra.map((i) => attr.externalReceivedAtS[i]!),
            spanFromSeconds,
          )})`
        : "";
      const selfSaved = attr.selfSaved.length
        ? `self-saved (${stampNames(attr.selfSaved, attr.selfSavedAtS, spanFromSeconds)})`
        : "";
      // B-tier B16b (user ruling 2026-10-06, "照 A29 两个都写"): an attempt
      // that met the target's own save AND an external names both — the wall
      // used to hide the external that did the saving (7f67e778 [5:07–5:22]:
      // Enraged Regeneration at 22 %, Lay on Hands at 12 %, "popped Enraged
      // Regeneration"). Without an external the line is unchanged: the first
      // of wall / self-save, as `primary` orders them.
      if (external && (popped || selfSaved))
        return [popped, external, selfSaved].filter(Boolean).join("; ");
      return popped || external || selfSaved;
    }
    case "outhealed":
      return "healed through";
    case "pressure":
      return "not enough damage";
  }
}

/**
 * The KILL ATTEMPTS legend line for rulings P-FU-b8 / D6
 * (`saveAuraCountsWhenAlreadyUp`): the auras that are never a cause "already
 * up" unless the log shows them end. The names are the predicate's own
 * (`SAVE_AURA_END_UNSEEN_NAMES`), so the legend cannot list another set than
 * the attribution applies. Worded without the `[ENEMY DEF]` line's `end not
 * logged`: this block also renders with that line off.
 */
export const KILL_ATTEMPTS_END_UNSEEN_LEGEND = `  ${[...SAVE_AURA_END_UNSEEN_NAMES].join(" / ")}: an enemy who goes unseen takes the aura's end out of the log, so one of these pressed BEFORE an attempt is its cause (\`[up since m:ss]\`) only when the log shows it end after the attempt began — otherwise how long it lasted is unknown and the attempt reads its next cause. Pressed inside the attempt it counts as any other save.`;

/**
 * Renders the [KILL ATTEMPTS] prompt block. All attempts render (no silent
 * cap — median 5/round, p90 11); times on the fmtTime render grid. The span
 * deliberately carries NO "(Ns)" duration label and the gated note says
 * "in hand", not "available" — both phrasings are claimed by eval gate
 * regexes (checkWindowSpanConsistency / MISSED_OPTION) that re-parse rendered
 * text, and this block must not volunteer strings those gates re-derive.
 */
export function formatKillAttemptsForContext(
  attempts: IKillAttempt[],
  /** Enemy players who died this round — round 2 W2g (138e, 6174): the
   * summary said "0 kills" while the Feral died 10 s after a saved attempt
   * (a kill outside every attempt window). Stated so the block cannot read
   * as "nobody died". Absent ⇒ the old summary. Match-relative seconds of
   * each enemy player's death, so "outside every attempt window" is a time
   * test, not deaths minus kills (codex review of batch 8: an attempt on A at
   * 10–30 s with B dying at 20 s read "1 outside every attempt window"). */
  enemyDeathSeconds?: readonly number[],
): string[] {
  if (attempts.length === 0) return [];
  const lines: string[] = [];
  lines.push(
    "KILL ATTEMPTS — team kill attempts (a stun chain, or an offensive-cooldown burst, with real team damage behind it):",
  );
  // User ruling 2026-09-22: a trinket-up target is the default state
  // (cooldowns reset at the gates) and forcing the trinket with the opener is
  // the play — the block must never read as "should not have opened on a
  // trinket-up target". The tier is only a targeting question relative to the
  // alternatives, so each line names the softer alternative or says none.
  lines.push(
    "  Trinket up is the default state (cooldowns reset at the gates): a stun on a trinket-up target is how the trinket gets forced, not a targeting error. Only a line naming a softer target raises a targeting question.",
  );
  // FT-T02d: what the damage figure is.
  lines.push(
    "  `(N M on target)` = the team's damage on the target: what landed plus what the target's shields absorbed.",
  );
  // F-E22 / F-E22b (rulings A29, A′4): what may be named after FAILED.
  // FT-T15 ⑦ (user ruling 2026-10-10): the text after FAILED is the first
  // match of `attributeFailure`'s fixed `primary` order, not a measured
  // cause — the legend states that order and no longer says "cause" /
  // "reason". The selection itself is untouched (A29 / A′4 / B16b).
  lines.push(
    "  `FAILED: X` names what the attempt ran into — the first that applies, in this fixed order: the target's trinket, a break ability, a full immunity, a wall, an external, a self-save, `healed through` (over the attempt and the next 5 s the target received more healing than damage), `not enough damage` (none of the above). It is what was pressed or up, picked in that order — not a measurement of what stopped the kill. A wall / external / self-save is named when it went up inside the attempt, or was already up when it began (`[up since m:ss]`) — one pressed after the attempt was over is not named; an immunity, the trinket or a break in the next 5 s still is. An immunity met along with the trinket or a break is named beside it, and so is an external beside the target's own save (`popped X; saved by external (Y)`): the attempt met both. `target trinketed out` / `broke out (X)` = the trinket / a racial or class ability removed a control of this attempt.",
  );
  // P-FU-b8 / D6: which "already up" is never claimed.
  lines.push(KILL_ATTEMPTS_END_UNSEEN_LEGEND);
  let kills = 0;
  let withSofter = 0;
  let onPrime = 0;
  let burstAnchored = 0;
  for (const a of attempts) {
    if (a.killed) kills++;
    if (a.softerTarget) withSofter++;
    if (a.opportunity.tier === "prime") onPrime++;
    if (a.anchor === "burst") burstAnchored++;
    const softer = a.softerTarget
      ? `softer target then: ${a.softerTarget.name} — ${
          a.softerTarget.tier === "prime"
            ? "PRIME"
            : `gated, ${a.softerTarget.wallsInHand.join("/")} in hand`
        }`
      : "no softer target";
    const opp =
      a.opportunity.tier === "prime"
        ? "PRIME (no trinket, no 20-99% wall in hand)"
        : a.opportunity.tier === "gated"
          ? `gated (${a.opportunity.wallsInHand.join("/")} in hand; ${softer})`
          : `trinket up (${softer})`;
    const outcome = a.killed
      ? "KILL"
      : `FAILED: ${failureText(a.attribution!, a.fromSeconds)}`;
    const opener =
      a.anchor === "stun"
        ? `${a.anchorSpellName} opener (${a.openingDrLevel} DR), ${a.stuns.length} stun${a.stuns.length > 1 ? "s" : ""}`
        : `${a.anchorSpellName} burst (no stun)`;
    lines.push(
      `  [${fmtTime(a.fromSeconds)}–${fmtTime(a.toSeconds)}] on ${a.targetName} — ${opener} | opportunity: ${opp} | team focus ${a.teamOnTargetPct}% (${(a.teamDamageToTarget / 1e6).toFixed(2)}M on target) | ${outcome}`,
    );
  }
  lines.push(
    `  Summary: ${attempts.length} attempts (${attempts.length - burstAnchored} stun-anchored, ${burstAnchored} burst-anchored; ${onPrime} on PRIME targets), ${kills} kill${kills === 1 ? "" : "s"} inside an attempt; ${withSofter} opened while a softer target existed.` +
      (() => {
        if (!enemyDeathSeconds || enemyDeathSeconds.length <= kills) return "";
        // death-kill F-K1: a death some attempt credits as its kill (in that
        // attempt's kill-credit slack) is not "outside every attempt window"
        const outside = enemyDeathSeconds.filter(
          (d) =>
            !attempts.some(
              (a) =>
                (d >= a.fromSeconds && d <= a.toSeconds) ||
                (a.killed &&
                  a.killedAtSeconds !== undefined &&
                  Math.abs(a.killedAtSeconds - d) < 0.001),
            ),
        ).length;
        return ` Enemy deaths this round: ${enemyDeathSeconds.length}${outside > 0 ? ` (${outside} outside every attempt window)` : ""}.`;
      })(),
  );
  return lines;
}

/** Per-round cap, same discipline as every other *_CAP in candidateFindings. */
// at-cap 体检(2026-08-26,782 owner-回合,GH #34):263/485 有产出回合打到
// 上限(54%)—— 承重梯队,真实攻击-撞-饰品事件量约为出面量的两倍以上。
export const ATTEMPT_INTO_TRINKET_CAP = 2;

/**
 * attempt-into-trinket candidate (2026-08-18 wiring, user-picked shape): a
 * FAILED stun-anchored attempt opened on a target whose trinket was still up
 * (tier "locked"), while another enemy was PRIME at that same instant — the
 * only tier comparison the corpus validation supports. Kills are excluded (it
 * worked; nothing to coach), and so are gated/prime openers. Among prime
 * alternatives the lowest-HP one is named (same rule as betterTargetExists).
 */
export function attemptIntoTrinketEvents(
  attempts: IKillAttempt[],
): CandidateEvent[] {
  const out: CandidateEvent[] = [];
  // 仅晕锚(2026-08-20 v2 落地时的刻意选择):三档机会模型的语料验证锚在
  // 晕落地时刻(8,791 次硬控),把它外推到大招起手时刻未经验证 —— 大招锚
  // 尝试只进 [KILL ATTEMPTS] 事实块,不喂本失误候选。
  // The prime alternative is the attempt's own `softerTarget` (softerTargetAt,
  // shared with the fact block since 2026-09-22) — one predicate for "who was
  // the softer target", so the block and this candidate can never disagree.
  const candidates = attempts.filter(
    (a) =>
      a.anchor === "stun" &&
      !a.killed &&
      a.opportunity.tier === "locked" &&
      a.softerTarget?.tier === "prime",
  );
  for (const a of candidates) {
    const alt = a.softerTarget!;
    const t = Math.floor(a.fromSeconds);
    out.push({
      id: `attempt-into-trinket:${a.targetUnitId}:${t}`,
      type: "attempt-into-trinket",
      t: a.fromSeconds,
      unitNames: [a.targetName, alt.name],
      spell: a.stuns[0].spellName,
      facts: {
        t: fmtFactTime(a.fromSeconds),
        target: a.targetName,
        stun: a.stuns[0].spellName,
        stunsN: String(a.stuns.length),
        focusPct: String(a.teamOnTargetPct),
        dmgM: (a.teamDamageToTarget / 1e6).toFixed(2),
        primeAlt: alt.name,
        failedBy: a.attribution!.primary,
        // Corpus outcome reference (2026-08-30 probe), rendered verbatim from
        // data/outcomeRefs.ts — packages/eval's checkOutcomeRefConsistency
        // re-parses these three facts and compares them against that same
        // constant, so never format them any other way here.
        refN: String(ATTEMPT_INTO_TRINKET_OUTCOME_REF.n),
        refKillTrinketDown: String(
          ATTEMPT_INTO_TRINKET_OUTCOME_REF.killPctTrinketDown,
        ),
        refKillTrinketUp: String(
          ATTEMPT_INTO_TRINKET_OUTCOME_REF.killPctTrinketUp,
        ),
      },
    });
  }
  return out
    .sort((x, y) => Number(y.facts.dmgM ?? 0) - Number(x.facts.dmgM ?? 0))
    .slice(0, ATTEMPT_INTO_TRINKET_CAP);
}

/** What anchored the attempt, for the bound-trinket test (F-E22 rule 1). */
type AttemptAnchor =
  { kind: "stun"; stuns: readonly StunApp[] } | { kind: "burst" };

/** What `attributeFailure` reads about one target that does not depend on the
 * attempt: its save auras and its CC / break summary. Built once per target per
 * match, on first use — 28k attempts over the 605-file capture each rebuilt
 * the aura intervals (twice) and the CC analysis. */
interface ITargetReadings {
  saveIntervals: () => ISaveAuraInterval[];
  ccSummary: () => IPlayerCCTrinketSummary;
  /** The externals this target received, as the `[ENEMY DEF]` external
   * lines render them (`enemyDefensiveEvents` of its teammates) — a cast on
   * it, or an aura on it whose cast the log missed. */
  externalsReceived: () => IEnemyDefensiveEvent[];
  /** the round's units by roster side (`buildRosterSides`) */
  sides: () => RosterSides;
  /** `documentRecordsAttackSpell` over the round's units */
  recordsAttackSpell: () => boolean;
}

function targetReadingsFactory(
  enemies: ICombatUnit[],
  friendlies: readonly ICombatUnit[],
  combat: IArenaMatch | IShuffleRound,
): (target: ICombatUnit) => ITargetReadings {
  const intervals = new Map<string, ISaveAuraInterval[]>();
  const cc = new Map<string, IPlayerCCTrinketSummary>();
  let externals: IEnemyDefensiveEvent[] | undefined;
  let rosterSides: RosterSides | undefined;
  let attackSpellRecorded: boolean | undefined;
  return (target) => ({
    saveIntervals: () => {
      let v = intervals.get(target.id);
      if (!v) {
        v = saveAuraIntervals(target, enemies, combat);
        intervals.set(target.id, v);
      }
      return v;
    },
    ccSummary: () => {
      let v = cc.get(target.id);
      if (!v) {
        v = targetCcSummary(target, friendlies, combat);
        cc.set(target.id, v);
      }
      return v;
    },
    externalsReceived: () => {
      externals ??= enemies.flatMap((mate) =>
        enemyDefensiveEvents(mate, enemies, combat).filter(
          (d) => d.kind === "external",
        ),
      );
      return externals.filter((d) => d.recipientId === target.id);
    },
    sides: () =>
      (rosterSides ??= buildRosterSides(Object.values(combat.units ?? {}))),
    recordsAttackSpell: () =>
      (attackSpellRecorded ??= documentRecordsAttackSpell(
        Object.values(combat.units ?? {}),
      )),
  });
}

/**
 * Why a non-converted attempt failed, from what the log shows around its span.
 * Three windows, each a different question (triage 2026-09-29, enemy-def
 * F-E22 + crisis-external F-E22b; user rulings A29, A30, A′4, A7-补):
 *
 *  - **[from, to]** — the attempt itself (first stun → last stun's expiry, or
 *    the burst cluster). A wall, an external or a self-save is "the save" only
 *    when it was applied / cast INSIDE it, or was already up at `from`
 *    (rule 2: Guardian Spirit pressed 0.14 s before the first stun, 537209d8).
 *    Pressed after the attempt was over — in the kill-credit slack — it is not
 *    why the attempt failed (rule 3′ = A′4: fa5e6c66 named a Divine Protection
 *    popped 2.8 s after the span; 69546267 a Guardian Spirit 3.3 s after).
 *    Since ruling D8 (2026-10-10) the self-saves include Feign Death's shield
 *    and the Nature's Guardian / Cheat Death / Cauterize procs, which read
 *    "forced a full immunity" (with the immunity's window, below) before it.
 *  - **[from, to + KILL_CREDIT_SLACK_S]** — unchanged for the kill itself, for
 *    the healing / damage balance, for a bound trinket, and for an immunity
 *    (an immunity popped in the slack still ends the go; A29 lists it).
 *  - **the trinket's own CC** — a trinket counts only when the break binder
 *    (`bindBreakToWindow` over the target's CC instances, the ones
 *    `[ENEMY TRINKET]` names) ties it to a stun of THIS attempt; for a burst
 *    anchor, to a CC active inside [from, to] (rule 1: 95127ab4's trinket at
 *    18.66 broke a Paralysis, not the Rake chain that ended at 15.30).
 *
 * School gates, both on the share of the damage aimed at the target over
 * [from, to + slack] that falls in the save's schools, floor
 * `SCHOOL_SAVE_MIN_SHARE` (the 50 % cd-hoarded's `coversCrisisSchool` uses):
 *  - a school-limited IMMUNITY (Blessing of Protection, Spellwarding, Cloak —
 *    `limitedImmunitySchoolMask`) is "a full immunity" only above the floor
 *    (A30; b711d4ac: Blessing of Protection against a go that was 24 %
 *    physical). Below it, it is still an external if an ally cast it inside
 *    the span.
 *  - a school-limited ABSORB with no table row (Anti-Magic Shell —
 *    `limitedAbsorbSchoolMask`) is a self-save / external only above the
 *    floor (A7-补); below it the attempt falls through to the next cause.
 * The share is `incomingPressureBySchool` over the TARGET's record — what
 * landed plus what a shield ate, from every source (pets and guardians
 * included). A shield judged on landed damage alone deletes its own evidence:
 * the better Anti-Magic Shell works, the lower the magic share. A window with
 * no damage of any kind reads differently per save: an immunity still counts
 * (an immune hit is a MISS line with no amount, so "nothing landed" is what a
 * working immunity looks like), an absorb does not (a shield nothing hit
 * saved nobody — cd-hoarded's reading of the same null).
 *
 * `readings` are the target's per-match readings every attempt on it shares.
 */
function attributeFailure(
  target: ICombatUnit,
  enemies: ICombatUnit[],
  friendlies: readonly ICombatUnit[],
  combat: IArenaMatch | IShuffleRound,
  span: { fromMs: number; toMs: number; creditToMs: number },
  anchor: AttemptAnchor,
  readings: ITargetReadings,
): IKillAttemptAttribution {
  const matchStartMs = combat.startTime;
  const { fromMs, toMs, creditToMs } = span;
  const inCredit = (ts: number): boolean => ts >= fromMs && ts <= creditToMs;
  // The save window as the attempt renders it, `[m:ss–m:ss]`: a save is
  // inside when its rendered second is (codex review, 2026-10-03: with the
  // span ending at 15.5 s, a Barkskin at 15.6 s also reads 0:15 and the
  // `checkEnemyDefRefConsistency` gate finds it there).
  const renderedS = (ms: number): number =>
    toRenderSecond((ms - matchStartMs) / 1000);
  const fromR = renderedS(fromMs);
  const toR = renderedS(toMs);
  const inSave = (ts: number): boolean => {
    const r = renderedS(ts);
    return r >= fromR && r <= toR;
  };

  // Rule 1: the trinket, bound to the CC it broke. The uses come from the
  // shared predicate (G7-P2: an Adaptation proc is a trinket use too).
  /** Is this CC — the one a break was bound to — a control of THIS attempt:
   * one of its stuns, or for a burst anchor a CC active inside [from, to]. */
  const ofThisAttempt = (
    cc: Pick<ICCInstance, "atSeconds" | "durationSeconds" | "spellId">,
  ): boolean =>
    anchor.kind === "stun"
      ? anchor.stuns.some(
          (st) =>
            st.spellId === cc.spellId &&
            Math.abs(st.atSeconds - cc.atSeconds) < 0.01,
        )
      : matchStartMs + cc.atSeconds * 1000 <= toMs &&
        matchStartMs + (cc.atSeconds + cc.durationSeconds) * 1000 >= fromMs;

  let trinketed = false;
  for (const use of pvpTrinketUses(target)) {
    if (!inCredit(use.atMs)) continue;
    const bound = findBrokenCC(
      readings.ccSummary().ccInstances,
      matchStartMs,
      use.atMs,
    );
    if (bound && ofThisAttempt(bound)) {
      trinketed = true;
      break;
    }
  }

  // F-E21 (ruling A′15): a racial or class ability that removed a control of
  // this attempt — the trinket's rule, the trinket's binder. 9e9f9565 3:11:
  // Will to Survive ended the Leg Sweep and the line read "healed through".
  const brokeOut: string[] = [];
  if (breakAbilityPresses(target).some((p) => inCredit(p.ts))) {
    for (const u of readings.ccSummary().breakAbilityUses ?? []) {
      if (!u.brokenCc || !inCredit(matchStartMs + u.atSeconds * 1000)) continue;
      // a break that is also a wall or a self-save is credited as that
      if (MITIGATION_AURA_IDS.has(u.spellId) || SELF_SAVE_IDS.has(u.spellId))
        continue;
      if (ofThisAttempt(u.brokenCc) && !brokeOut.includes(u.name))
        brokeOut.push(u.name);
    }
  }

  // A30 / A7-补: is a school-limited save's school what was aimed at the
  // target? `whenNoDamage` is the answer for a window with no damage at all.
  let damageBySchool: Record<string, number> | undefined;
  const coversIncomingDamage = (
    mask: number | undefined,
    whenNoDamage: boolean,
  ): boolean => {
    if (mask === undefined) return true;
    damageBySchool ??= incomingPressureBySchool(
      target,
      fromMs,
      creditToMs,
      readings.sides(),
      readings.recordsAttackSpell(),
    );
    const share = schoolShareCoveredBy({ dmg2sBySchool: damageBySchool }, mask);
    return share === null ? whenNoDamage : share >= SCHOOL_SAVE_MIN_SHARE;
  };
  const immunityCovers = (spellId: string): boolean =>
    coversIncomingDamage(limitedImmunitySchoolMask(spellId), true);
  const absorbCovers = (spellId: string): boolean =>
    coversIncomingDamage(limitedAbsorbSchoolMask(spellId), false);
  // Rule 2's "already up when the attempt began" — for EVERY cause below
  // (wall, immunity, external, self-save, Feign Death's shield), so none of
  // them can read it another way. An aura whose carrier goes unseen and whose
  // end the log never showed is "up" here only by the interval builder's
  // official-length cap, and does not count (`saveAuraCountsWhenAlreadyUp`:
  // ruling P-FU-b8 for Mass Invisibility / Vanish / Burrow, extended to
  // Greater Invisibility by D6 — `popped Greater Invisibility [up since
  // 5:49]` on an attempt at 6:04, the mage casting again 3 s after the press).
  const upAtFrom = (iv: ISaveAuraInterval): boolean =>
    matchStartMs + iv.fromS * 1000 < fromMs &&
    matchStartMs + iv.toS * 1000 > fromMs &&
    saveAuraCountsWhenAlreadyUp(iv);
  /** A save pressed BEFORE the attempt counts through its aura: one that went
   * up inside the span, or was up when it began. One rule for the external
   * and the self-save branch (codex review, 2026-10-06: an ally's
   * Anti-Magic Shell cast at 9.9 s, aura 10.1 s, attempt from 10 s). */
  const auraSavesSpan = (iv: ISaveAuraInterval): boolean =>
    inSave(matchStartMs + iv.fromS * 1000) || upAtFrom(iv);

  let immunityBaited = false;
  /** an immunity went up inside the credit window (or a proc heal fired) */
  let immunityInside = false;
  let immunityUpSinceS: number | undefined;
  const defensivePopped: string[] = [];
  const defensivePoppedAtS: number[] = [];
  const selfSaved: string[] = [];
  const selfSavedAtS: number[] = [];
  // One name per spell: a shapeshift-type defensive re-applies its aura
  // whenever the form refreshes (Ancient of Lore 473909 in S2 archive match
  // ad329f4a: 3 casts, 23 SPELL_AURA_APPLIED, same-millisecond REMOVED+APPLIED
  // pairs), and a wall whose cooldown exceeds the span cannot be popped twice
  // inside one attempt — without this guard the ledger rendered
  // "popped Ancient of Lore/Ancient of Lore/Ancient of Lore" (GH #44, 2026-09-01).
  const poppedIds = new Set<string>();
  // The target's auras, as the [ENEMY DEF] line sees them (`saveAuraIntervals`:
  // a re-announced aura is one press). An interval whose start was inferred
  // (up before the log saw it) is skipped — only a logged application counts.
  const targetIntervals = readings.saveIntervals();
  for (const iv of targetIntervals) {
    if (iv.inferredStart) continue;
    const startMs = matchStartMs + iv.fromS * 1000;
    const upAtStart = upAtFrom(iv);
    const bySelf = isIntervalFrom(iv, target);
    // An immunity that went up inside the credit window, or (rule 2) one
    // that was already up when the attempt began — the second only when the
    // aura IS the immunity (`immunityCountsWhenAlreadyUp`; a Mass
    // Invisibility / Vanish / Burrow whose REMOVED the log lost is already
    // not `upAtStart`, ruling P-FU-b8 — a stun landing on the target shows
    // it). Feign Death, Cheat Death, Cauterize and Nature's
    // Guardian are not read here at all (ruling D8): see the self-saves.
    const immunityInSpan = inCredit(startMs);
    if (
      isImmunitySaveAura(iv.spellId) &&
      (immunityInSpan || (upAtStart && immunityCountsWhenAlreadyUp(iv))) &&
      immunityCovers(iv.spellId)
    ) {
      immunityBaited = true;
      if (immunityInSpan) immunityInside = true;
      else immunityUpSinceS = Math.max(immunityUpSinceS ?? 0, iv.fromS);
    }
    if (!inSave(startMs) && !upAtStart) continue;
    // The wall-in-hand subset is called out by name — those are the cards the
    // gated tier told the coach to bait; seeing one here closes that loop.
    // F-E1a: a wall whose table row is keyed by its cast (Blur, Greater
    // Invisibility) is found here under its logged aura id.
    const wallId = wallTableIdOfAura(iv.spellId);
    if (
      (MITIGATION_AURA_IDS.has(wallId) || WALL_IN_HAND_MIT_IDS.has(wallId)) &&
      !poppedIds.has(iv.spellId) &&
      // A wall applied ON the target by somebody else (Flameshaper Obsidian
      // Scales on an ally, 15 %) is not the target popping a defensive.
      // GH #96 M3a: priced through the component resolver (lower bound).
      (strongestComponentPct(
        resolveMitigation(wallId, {
          carrierIsCaster: bySelf,
          // M3b: talents are attributable only to a self-cast here (no roster)
          caster: bySelf ? target : undefined,
        })!,
        { includeImmunity: true },
      )?.pctMin ?? 0) >= MITIGATION_AURA_MIN_PCT
    ) {
      poppedIds.add(iv.spellId);
      // The logged name is client-locale text ("树皮术" on a zh client); the
      // prompt is English everywhere else, so resolve it the way every other
      // renderer does. 2026-09-15 Opus baseline: 230/309 prompts carried a
      // CJK name, 328 of the runs came from this line and 93 from the
      // external one below.
      defensivePopped.push(getEnglishSpellName(iv.spellId, iv.spellName));
      defensivePoppedAtS.push(iv.fromS);
    }
  }

  const externalReceived: string[] = [];
  const externalReceivedAtS: number[] = [];
  // The externals the `[ENEMY DEF]` lines show on this target — one source,
  // so an external seen only as its aura (the cast missing from the log)
  // counts here exactly where it renders (codex review, 2026-10-03).
  for (const d of readings.externalsReceived()) {
    const castMs = matchStartMs + d.atSeconds * 1000;
    if (!inSave(castMs)) {
      // Rule 2, as for a wall and a self-save: thrown before the attempt
      // and its aura still on the target when the attempt began (an
      // Anti-Magic Shell put on the ally half a second before the first
      // stun). The aura is the one the `[ENEMY DEF]` external line pairs
      // (`externalAuraOf`); a grip / redirect or an instant heal has none —
      // it is a moment, and a moment before the attempt is not its cause.
      if (castMs >= fromMs) continue; // after the span
      const aura = externalAuraOf(
        d.spellId,
        d.atSeconds,
        targetIntervals,
        d.casterId,
      );
      if (!aura || !auraSavesSpan(aura)) continue;
    }
    // A school-limited immunity thrown BEFORE the attempt began — merely
    // still up, against a go in the other school — did nothing in this
    // attempt (c2058ed4: Blessing of Spellwarding at 117.04 s, span 117.18–
    // 119.87 s, 89 % physical → stays `healed through`). Decided on the raw
    // instant: the two floor to the same rendered second, which must not
    // turn the press into one "inside" the attempt (codex review,
    // 2026-10-04). Thrown INSIDE the span it is still the external the target
    // received (b711d4ac, below).
    if (castMs < fromMs) {
      const auraId =
        externalAuraOf(d.spellId, d.atSeconds, targetIntervals, d.casterId)
          ?.spellId ?? d.spellId;
      if (!immunityCovers(auraId)) continue;
    }
    // Only a table-less absorb is gated here (Anti-Magic Shell on an ally).
    // A school-limited immunity that failed the test above is still an
    // external the target received when it was thrown inside the span
    // (b711d4ac: Blessing of Protection).
    if (!absorbCovers(d.spellId)) continue;
    // One name per spell, as for walls and self-saves: two Intervenes or
    // two Leaps of Faith in one span read "Leap of Faith/Leap of Faith".
    if (externalReceived.includes(d.spellName)) continue;
    externalReceived.push(d.spellName);
    externalReceivedAtS.push(d.atSeconds);
  }

  // The target's own no-%-mitigation saves: pressed inside the span, or
  // (rule 2) pressed before it with the save's aura still up when it began.
  // Read from the CASTS, so "on itself" is the cast's own target — Blessing
  // of Sacrifice leaves an aura on the paladin who threw it at an ally, and
  // that is not the paladin saving himself.
  for (const c of selfSaveCasts(target, matchStartMs)) {
    const castMs = matchStartMs + c.atSeconds * 1000;
    if (!inSave(castMs)) {
      if (castMs >= fromMs) continue; // after the span: not its cause
      const stillUp = targetIntervals.some(
        (iv) =>
          iv.spellId === c.spellId &&
          isIntervalFrom(iv, target) &&
          Math.abs(iv.fromS - c.atSeconds) <= SAVE_CAST_AURA_PAIR_S &&
          // an aura that only starts after the span is no save of it (codex
          // review, 2026-10-06: cast 9.8 s, aura 11.1 s, attempt 10–10.2 s)
          auraSavesSpan(iv),
      );
      if (!stillUp) continue;
    }
    if (selfSaved.includes(c.spellName)) continue;
    if (!absorbCovers(c.spellId)) continue;
    selfSaved.push(c.spellName);
    selfSavedAtS.push(c.atSeconds);
  }

  // User ruling D8 (2026-10-10, re-opening A25): "KILL ATTEMPTS 不再对这四个
  // 写 forced a full immunity". Feign Death's shield and a Nature's Guardian /
  // Cheat Death / Cauterize proc are the target's own saves without damage
  // reduction — `effectSaves`, the reader of their `[ENEMY DEF]` lines — so
  // they take the self-save's place in the order and the self-save's window:
  // inside the span, not the 5 s after it an immunity is given. Rule 2
  // ("already up when the attempt began") holds for the shield alone, whose
  // aura IS the save; a proc is a moment — one that fired before the attempt
  // is not why it failed, however long the aura it leaves lingers (Cauterize
  // 6 s, Cheating Death 3 s). An aura whose start the log did not see is
  // skipped, as for every other cause.
  let effectSaved = false;
  for (const s of effectSaves(target, targetIntervals, matchStartMs)) {
    if (s.interval?.inferredStart) continue;
    const atMs = matchStartMs + s.atSeconds * 1000;
    if (!inSave(atMs)) {
      if (atMs >= fromMs) continue; // after the span: not its cause
      if (s.effect !== "absorb" || !s.interval || !upAtFrom(s.interval))
        continue;
    }
    if (selfSaved.includes(s.spellName)) continue;
    if (!absorbCovers(s.spellId)) continue;
    selfSaved.push(s.spellName);
    selfSavedAtS.push(s.atSeconds);
    effectSaved = true;
  }
  // one list in log order (the casts above already are)
  if (effectSaved) {
    const order = selfSaved
      .map((_, i) => i)
      .sort((a, b) => selfSavedAtS[a]! - selfSavedAtS[b]!);
    const names = order.map((i) => selfSaved[i]!);
    const ats = order.map((i) => selfSavedAtS[i]!);
    selfSaved.splice(0, selfSaved.length, ...names);
    selfSavedAtS.splice(0, selfSavedAtS.length, ...ats);
  }

  let healedIn = 0;
  for (const h of target.healIn) {
    if (inCredit(h.logLine.timestamp)) healedIn += Math.abs(h.effectiveAmount);
  }
  let damageIn = 0;
  for (const d of target.damageIn) {
    if (inCredit(d.logLine.timestamp)) damageIn += Math.abs(d.effectiveAmount);
  }
  const outhealed = healedIn > damageIn;

  const primary: IKillAttemptAttribution["primary"] = trinketed
    ? "trinketed"
    : brokeOut.length > 0
      ? "broke-out"
      : immunityBaited
        ? "immunity-baited"
        : defensivePopped.length > 0
          ? "defensive"
          : externalReceived.length > 0
            ? "external"
            : selfSaved.length > 0
              ? "self-saved"
              : outhealed
                ? "outhealed"
                : "pressure";

  return {
    trinketed,
    brokeOut,
    immunityBaited,
    ...(immunityBaited && !immunityInside && immunityUpSinceS !== undefined
      ? { immunityUpSinceS }
      : {}),
    defensivePopped,
    defensivePoppedAtS,
    externalReceived,
    externalReceivedAtS,
    selfSaved,
    selfSavedAtS,
    outhealed,
    primary,
  };
}

/** The target's CC / break summary — the one `analyzePlayerCCAndTrinket`
 * builds for `[ENEMY TRINKET]` / `[CC ON ENEMY]`, with the attackers' pets as
 * sources — so a trinket or break is bound here to the same CC the timeline
 * names. */
function targetCcSummary(
  target: ICombatUnit,
  friendlies: readonly ICombatUnit[],
  combat: IArenaMatch | IShuffleRound,
): IPlayerCCTrinketSummary {
  const friendlyPets = Object.values(combat.units ?? {}).filter(
    (u) => u.ownerId && friendlies.some((f) => f.id === u.ownerId),
  );
  return analyzePlayerCCAndTrinket(
    target,
    friendlies as ICombatUnit[],
    combat,
    friendlyPets,
  );
}
