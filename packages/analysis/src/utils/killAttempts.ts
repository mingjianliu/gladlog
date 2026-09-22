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
  IArenaMatch,
  ICombatUnit,
  IShuffleRound,
  LogEvent,
} from "@gladlog/parser-compat";

import { CandidateEvent } from "../analysis/types";
import {
  resolveMitigation,
  strongestComponentPct,
} from "../data/mitigationComponents";
import { ATTEMPT_INTO_TRINKET_OUTCOME_REF } from "../data/outcomeRefs";
import { getEnglishSpellName } from "../data/spellEffectData";
import { TIMELINE_LINE_FLAGS } from "../data/timelineLineFlags";
import { burstCastSpan, KILL_CREDIT_SLACK_S } from "./burstLedger";
import { analyzeOutgoingCCChains, DRLevel, drResetMsAt } from "./drAnalysis";
import { reconstructEnemyCDTimeline } from "./enemyCDs";
import {
  EXTERNAL_DEF_IDS,
  IMMUNITY_IDS,
  MITIGATION_AURA_IDS,
  MITIGATION_AURA_MIN_PCT,
} from "./enemyDefensives";
import {
  getHpPercentAtTime,
  IKillOpportunity,
  killOpportunityAt,
  KillOpportunityTier,
  PVP_TRINKET_SPELL_IDS,
  WALL_IN_HAND_MIT_IDS,
} from "./killWindowTargetSelection";
import { KW_BURST_MIN_DAMAGE } from "./offensiveWindows";
import { fmtTime } from "./renderGrid";

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
 * nothing visible saved the target, the damage simply wasn't enough. */
export interface IKillAttemptAttribution {
  trinketed: boolean;
  immunityBaited: boolean;
  defensivePopped: string[];
  /** round seconds of each `defensivePopped` entry's aura start (parallel array) */
  defensivePoppedAtS: number[];
  externalReceived: string[];
  /** round seconds of each `externalReceived` cast (parallel array) */
  externalReceivedAtS: number[];
  outhealed: boolean;
  primary:
    | "trinketed"
    | "immunity-baited"
    | "defensive"
    | "external"
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
   * Burst anchor: first offensive cast → cluster reach (burstCastSpan). */
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
  /** Team damage inside [from, to + KILL_CREDIT_SLACK_S]. */
  teamDamageToTarget: number;
  teamDamageTotal: number;
  /** 0–100: share of team damage that landed on the attempt's target. */
  teamOnTargetPct: number;
  killed: boolean;
  /** Present exactly when !killed. */
  attribution?: IKillAttemptAttribution;
}

interface StunApp {
  atSeconds: number;
  durationSeconds: number;
  spellName: string;
  casterName: string;
  drLevel: DRLevel;
}

const TIER_RANK: Record<KillOpportunityTier, number> = {
  prime: 0,
  gated: 1,
  locked: 2,
};

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
): { softerTarget?: IKillAttemptSofterTarget } {
  const softer = softerTargetAt(target, enemies, atSeconds, matchStartMs);
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
        spellName: app.spellName,
        casterName: app.casterName,
        drLevel: app.drInfo.level,
      });
      stunsByTarget.set(chain.targetName, arr);
    }
  }

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
      const last = group[group.length - 1];
      const toSeconds = Math.max(
        last.atSeconds + last.durationSeconds,
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

      const killed = target.deathRecords.some((rec) => {
        const t = rec.timestamp;
        return t >= spanFromMs && t <= spanToMs;
      });

      const attempt: IKillAttempt = {
        targetUnitId: target.id,
        targetName,
        anchor: "stun",
        anchorSpellName: group[0].spellName,
        fromSeconds,
        toSeconds,
        stuns: group,
        opportunity: killOpportunityAt(target, fromSeconds, matchStartMs),
        ...softerField(target, enemies, fromSeconds, matchStartMs),
        openingDrLevel: group[0].drLevel,
        teamDamageToTarget,
        teamDamageTotal,
        teamOnTargetPct:
          teamDamageTotal > 0
            ? Math.round((100 * teamDamageToTarget) / teamDamageTotal)
            : 0,
        killed,
      };
      if (!killed) {
        attempt.attribution = attributeFailure(
          target,
          enemies,
          spanFromMs,
          spanToMs,
          matchStartMs,
        );
      }
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
    const matchEndS = (combat.endTime - matchStartMs) / 1000;
    for (const cl of clusters) {
      const fromSeconds = cl.from;
      const toSeconds = Math.min(cl.to, matchEndS);
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
      if (covered) continue;
      const killed = target.deathRecords.some((rec) => {
        const t = rec.timestamp;
        return t >= spanFromMs && t <= spanToMs;
      });
      const attempt: IKillAttempt = {
        targetUnitId: target.id,
        targetName: target.name,
        anchor: "burst",
        anchorSpellName: cl.opener,
        fromSeconds,
        toSeconds,
        stuns: [],
        opportunity: killOpportunityAt(target, fromSeconds, matchStartMs),
        ...softerField(target, enemies, fromSeconds, matchStartMs),
        teamDamageToTarget,
        teamDamageTotal,
        teamOnTargetPct:
          teamDamageTotal > 0
            ? Math.round((100 * teamDamageToTarget) / teamDamageTotal)
            : 0,
        killed,
      };
      if (!killed) {
        attempt.attribution = attributeFailure(
          target,
          enemies,
          spanFromMs,
          spanToMs,
          matchStartMs,
        );
      }
      attempts.push(attempt);
    }
  }

  attempts.sort((a, b) => a.fromSeconds - b.fromSeconds);
  return attempts;
}

/** GH #97 cheap alternative to the [ENEMY DEF] timeline line: the summary
 * names WHEN the wall went up (`popped Barkskin@2:17`) instead of a timeline
 * line. Only one of the two renders (TIMELINE_LINE_FLAGS.enemyDef). */
function stampNames(names: string[], atS: number[]): string {
  if (TIMELINE_LINE_FLAGS.enemyDef !== "stamp") return names.join("/");
  return names
    .map((n, i) => (atS[i] !== undefined ? `${n}@${fmtTime(atS[i]!)}` : n))
    .join("/");
}

/** Short English cause for prompt/facts rendering. immunity-baited is worded
 * as a win per the user ruling — never a reproach. */
function failureText(attr: IKillAttemptAttribution): string {
  switch (attr.primary) {
    case "trinketed":
      return "target trinketed out";
    case "immunity-baited":
      return "forced a full immunity (a win — re-open after it drops)";
    case "defensive":
      return `popped ${stampNames(attr.defensivePopped, attr.defensivePoppedAtS)}`;
    case "external":
      return `saved by external (${stampNames(attr.externalReceived, attr.externalReceivedAtS)})`;
    case "outhealed":
      return "healed through";
    case "pressure":
      return "not enough damage";
  }
}

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
      : `FAILED: ${failureText(a.attribution!)}`;
    const opener =
      a.anchor === "stun"
        ? `${a.anchorSpellName} opener (${a.openingDrLevel} DR), ${a.stuns.length} stun${a.stuns.length > 1 ? "s" : ""}`
        : `${a.anchorSpellName} burst (no stun)`;
    lines.push(
      `  [${fmtTime(a.fromSeconds)}–${fmtTime(a.toSeconds)}] on ${a.targetName} — ${opener} | opportunity: ${opp} | team focus ${a.teamOnTargetPct}% (${(a.teamDamageToTarget / 1e6).toFixed(2)}M on target) | ${outcome}`,
    );
  }
  lines.push(
    `  Summary: ${attempts.length} attempts (${attempts.length - burstAnchored} stun-anchored, ${burstAnchored} burst-anchored; ${onPrime} on PRIME targets), ${kills} kill${kills === 1 ? "" : "s"}; ${withSofter} opened while a softer target existed.`,
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
        t: fmtTime(a.fromSeconds),
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

function attributeFailure(
  target: ICombatUnit,
  enemies: ICombatUnit[],
  spanFromMs: number,
  spanToMs: number,
  matchStartMs: number,
): IKillAttemptAttribution {
  const inSpan = (ts: number): boolean => ts >= spanFromMs && ts <= spanToMs;
  const secondsOf = (ts: number): number => (ts - matchStartMs) / 1000;

  let trinketed = false;
  for (const cast of target.spellCastEvents) {
    if (cast.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    if (!cast.spellId || !PVP_TRINKET_SPELL_IDS.has(cast.spellId)) continue;
    if (inSpan(cast.logLine.timestamp)) {
      trinketed = true;
      break;
    }
  }

  let immunityBaited = false;
  const defensivePopped: string[] = [];
  const defensivePoppedAtS: number[] = [];
  // One name per spell: a shapeshift-type defensive re-applies its aura
  // whenever the form refreshes (Ancient of Lore 473909 in S2 archive match
  // ad329f4a: 3 casts, 23 SPELL_AURA_APPLIED, same-millisecond REMOVED+APPLIED
  // pairs), and a wall whose cooldown exceeds the span cannot be popped twice
  // inside one attempt — without this guard the ledger rendered
  // "popped Ancient of Lore/Ancient of Lore/Ancient of Lore" (GH #44, 2026-09-01).
  const poppedIds = new Set<string>();
  for (const aura of target.auraEvents) {
    if (aura.destUnitId !== target.id) continue;
    if ((aura.logLine.event as string) !== LogEvent.SPELL_AURA_APPLIED)
      continue;
    if (!aura.spellId || !inSpan(aura.logLine.timestamp)) continue;
    if (IMMUNITY_IDS.has(aura.spellId)) immunityBaited = true;
    // The wall-in-hand subset is called out by name — those are the cards the
    // gated tier told the coach to bait; seeing one here closes that loop.
    if (
      (MITIGATION_AURA_IDS.has(aura.spellId) ||
        WALL_IN_HAND_MIT_IDS.has(aura.spellId)) &&
      !poppedIds.has(aura.spellId) &&
      // A wall applied ON the target by somebody else (Flameshaper Obsidian
      // Scales on an ally, 15 %) is not the target popping a defensive.
      // GH #96 M3a: priced through the component resolver (lower bound).
      (strongestComponentPct(
        resolveMitigation(aura.spellId, {
          carrierIsCaster: aura.srcUnitId === target.id,
          // M3b: talents are attributable only to a self-cast here (no roster)
          caster: aura.srcUnitId === target.id ? target : undefined,
        })!,
        { includeImmunity: true },
      )?.pctMin ?? 0) >= MITIGATION_AURA_MIN_PCT
    ) {
      poppedIds.add(aura.spellId);
      // The logged name is client-locale text ("树皮术" on a zh client); the
      // prompt is English everywhere else, so resolve it the way every other
      // renderer does. 2026-09-15 Opus baseline: 230/309 prompts carried a
      // CJK name, 328 of the runs came from this line and 93 from the
      // external one below.
      defensivePopped.push(getEnglishSpellName(aura.spellId, aura.spellName));
      defensivePoppedAtS.push(secondsOf(aura.logLine.timestamp));
    }
  }

  const externalReceived: string[] = [];
  const externalReceivedAtS: number[] = [];
  for (const mate of enemies) {
    if (mate.id === target.id) continue;
    for (const cast of mate.spellCastEvents) {
      if (cast.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      if (!cast.spellId || !EXTERNAL_DEF_IDS.has(cast.spellId)) continue;
      if (cast.destUnitId !== target.id) continue;
      if (inSpan(cast.logLine.timestamp)) {
        externalReceived.push(
          getEnglishSpellName(cast.spellId, cast.spellName),
        );
        externalReceivedAtS.push(secondsOf(cast.logLine.timestamp));
      }
    }
  }

  let healedIn = 0;
  for (const h of target.healIn) {
    if (inSpan(h.logLine.timestamp)) healedIn += Math.abs(h.effectiveAmount);
  }
  let damageIn = 0;
  for (const d of target.damageIn) {
    if (inSpan(d.logLine.timestamp)) damageIn += Math.abs(d.effectiveAmount);
  }
  const outhealed = healedIn > damageIn;

  const primary: IKillAttemptAttribution["primary"] = trinketed
    ? "trinketed"
    : immunityBaited
      ? "immunity-baited"
      : defensivePopped.length > 0
        ? "defensive"
        : externalReceived.length > 0
          ? "external"
          : outhealed
            ? "outhealed"
            : "pressure";

  return {
    trinketed,
    immunityBaited,
    defensivePopped,
    defensivePoppedAtS,
    externalReceived,
    externalReceivedAtS,
    outhealed,
    primary,
  };
}
