/**
 * candidateCalibration.ts — Task 5 (P1/P2 distillation) corpus calibration for
 * the four new candidate-menu builders (missedSyncWindowEvents /
 * unsyncedBurstEvents / cdHoardedEvents / cdSpentIdleEvents — all four ON
 * since 2026-08-15; the current expected value of every flag lives in
 * docs/predicate-index.md's `Feature flag state` table) and
 * the shared threat predicates they/other callers consume
 * (`matchThreatLevel`/`threatActiveAt`, `utils/threatAssessment.ts`).
 *
 * Direct-calls the REAL production builders — never a re-derived detection
 * rule (CLAUDE.md shared-predicate rule). Two consequences of that:
 *  - `buildRoundContext` replicates ONLY the wiring glue `teamPlayEvents`
 *    (candidateFindings.ts) already does to hand each builder its probes —
 *    friends/enemies split, the default-healer owner convention, the shared
 *    `enemyHealerCcWindows`/team-offensive-CD lists — not any filtering
 *    logic. If that wiring ever drifts from `teamPlayEvents`, the fixture
 *    test in `candidateCalibration.test.ts` (constant thresholds, full
 *    pipeline via `buildRoundContext` + `countsAtThresholds`) pins the parity.
 *  - Threshold *sensitivity* (the H/crisis-HP grid, the threat window tiers)
 *    calls the SAME builders with the `overrides` parameter each one gained
 *    in this same Task 5 pass (see `cdHoardedEvents` in candidateFindings.ts
 *    and `matchThreatLevel`/`threatActiveAt` in threatAssessment.ts) — a
 *    sweep is not a second implementation, it is the real function called at
 *    different constants. Omitting overrides entirely reproduces today's
 *    production behavior.
 *
 * `buildRoundContext` does the one-time, I/O-adjacent work per round
 * (`extractMajorCooldowns` per friendly, `enemyHealerCcWindows`) so a
 * sensitivity sweep over N grid cells does not re-parse/re-derive anything —
 * only `countsAtThresholds` (pure, cheap) runs per cell.
 */
import {
  ccSpellIds,
  cdAvailableAt,
  cdHoardedEvents,
  cdSpentIdleEvents,
  enemyHealerCcWindows,
  enemyMinHpPctInWindow,
  extractMajorCooldowns,
  type IEnemyHealerCcWindow,
  type IMajorCooldownInfo,
  isHealerSpec,
  type IThreatLevelOverrides,
  type MatchThreatLevel,
  matchThreatLevel,
  missedSyncWindowEvents,
  type RawStreams,
  threatActiveAt,
  unsyncedBurstEvents,
} from "@gladlog/analysis";
// Deep import, same precedent as signalSkillGradient.ts (barrel index.ts does
// not re-export crisisDecisionPoints.ts): cd-hoarded's 2026-08-30 rewrite
// (GH #34) scans crisisDecisionPoints directly, the same predicate
// crisis-no-response uses.
import { crisisDecisionPoints } from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import { lookupSyncWindowPrior } from "@gladlog/analysis/src/data/syncWindowPrior";
import type { ICombatUnit } from "@gladlog/parser-compat";

import { type LegacyRound, splitTeams } from "./storeAccess.js";

/** Effectively-unbounded cap override so a builder's RAW (pre-truncation)
 * candidate count can be measured through the same code path as its capped
 * (real, shippable) count — never a second counting rule. */
const UNCAPPED = 1_000_000;

/** One round's precomputed wiring context — everything `teamPlayEvents`
 * derives once and reuses across builders, held here so a sensitivity sweep
 * can call `countsAtThresholds` repeatedly without re-deriving any of it. */
export interface RoundContext {
  matchId: string;
  roundSeq?: number;
  friends: ICombatUnit[];
  enemies: ICombatUnit[];
  owner: ICombatUnit;
  ownerCds: IMajorCooldownInfo[];
  ccWindows: IEnemyHealerCcWindow[];
  teamOffensiveCds: Array<IMajorCooldownInfo & { ownerName: string }>;
  /** unsynced-burst 可行性门:此刻队伍有没有硬控转好(与生产同一判据)。 */
  teamCcReadyAt: (tSeconds: number) => boolean;
  /** §29b fix (2026-08-15, mirrors production's candidateFindings.ts wiring
   * unchanged): every enemy healer, not just the first match — the gate
   * `unsyncedBurstEvents` reads (`ccWindows`) already pools hard-CC across
   * all of them, so the fact must too. */
  enemyHealerNames: string[];
  legacy: LegacyRound;
  /** Whether `splitTeams(legacy).owner` (production's OWN `resolveOwner`
   * predicate, mirrored — see `buildRoundContext`'s doc comment) resolved —
   * `false` means production would show NO candidates for this round at all.
   * Task 6's corpus report uses this to give mana-pressure/mana-efficiency a
   * production-gated denominator ALONGSIDE the naive one every other type in
   * this module already reports, per the P1/P2 owner-phantom lesson. */
  ownerResolvable: boolean;
  /** Task 6 (raw-streams calibration) addition: `parseRawStreams(readRawText(
   * store, matchId), legacy.startTime)` — same time base (`legacy.startTime`)
   * production wires as `combat.startTime` in candidateFindings.ts's
   * `extractCandidateFindings` caller. Callers that never pass a 4th arg to
   * `buildRoundContext` get `{available:false, manaSamples:[], castFailed:[]}`
   * here (mana-pressure/mana-efficiency read through this exactly like
   * production reads `available:false` — silently zero, never throws), so
   * every pre-Task-6 call site (the cd-hoarded/cd-spent-idle/missed-sync/
   * unsynced-burst scan this module already supported) is byte-identical to
   * before this field existed. */
  rawStreams: RawStreams;
}

/** `buildRoundContext` callers that don't have raw.txt on hand (or don't care
 * about the two mana-* types) pass no 4th arg and get this — identical shape
 * to `parseRawStreams(null, ...)`'s own `available:false` result, so
 * `manaPressureEvents`/`manaEfficiencyEvents` degrade exactly like production
 * does when raw.txt is missing (Global Constraint). */
const UNAVAILABLE_RAW_STREAMS: RawStreams = {
  available: false,
  manaSamples: [],
  castFailed: [],
};

/**
 * Builds one round's wiring context. Returns `null` when the round has no
 * player on both sides (mirrors `teamPlayEvents`' own early return) — the
 * caller must skip, not fabricate zero counts for, a round this returns null
 * for.
 *
 * Owner resolution mirrors production's default single-owner convention
 * (`resolveOwner` falling back to the friendly healer, documented at several
 * call sites in candidateFindings.ts, e.g. `BURST_INTO_MITIGATION_MIN_PCT`'s
 * doc comment) — first the friendly healer, else the first friendly player.
 * This is a corpus-representativeness choice, not a detection rule: it
 * matches what the shipped default-owner report actually computes.
 *
 * `RoundContext.ownerResolvable` (Task 6 addition, the P1/P2 distillation
 * owner-phantom lesson applied PROSPECTIVELY instead of retroactively —
 * `p1p2-calibration.md`'s "owner-resolution selection-bias" correction found
 * this scan's own `owner` above ALWAYS resolves (`?? friends[0]` never
 * fails), while production's real gate
 * (`packages/desktop/src/renderer/src/report/derive/analysisInput.ts:31-45`'s
 * `resolveOwner`) returns `undefined` when neither the log's own `playerId`
 * nor any friendly healer is found — a round `resolveOwner` misses is a
 * round production shows NO candidates for at all, of ANY type, not just an
 * owner-scoped one.
 *
 * `splitTeams(legacy).owner` (`storeAccess.ts`, this file's own import) is
 * NOT an import of `resolveOwner` — `packages/eval` cannot depend on that
 * file (it transitively pulls in `rawStreamsCache.ts`'s `bridge`, an
 * Electron-renderer `window.gladlog` dependency with no place in a Node
 * vitest/tsx run). It is an INDEPENDENTLY HAND-WRITTEN DUPLICATE that mirrors
 * `resolveOwner`'s branch structure (playerId-match-on-a-Friendly-player,
 * else first Friendly healer, else `undefined`) — verified equivalent by a
 * pinned five-case truth table, not by this comment alone (Task 6 review
 * round 1, 2026-08-15, task-6-review.md Important #2): see
 * `packages/eval/test/explore.candidateCalibration.test.ts`'s
 * `describe("ownerResolvable parity vs resolveOwner's own truth table")` and
 * its mirror image `packages/desktop/test/analysisInput.test.ts`'s
 * `describe("resolveOwner")` — both must be updated together if either
 * function's branch structure ever changes. Registered in
 * `docs/predicate-index.md`'s "Not yet unified" section, since a true shared
 * export is not possible without either an `eval`→`desktop` dependency edge
 * (against this repo's convention) or relocating `resolveOwner` out of the
 * renderer tree (not attempted here — out of this task's scope). Reading
 * `ownerResolvable` here, in ADDITION to (never replacing) the
 * existing unconditional `owner`, closes the gap for `mana-pressure`/
 * `mana-efficiency` prospectively without touching the already-calibrated,
 * already-shipped four P1/P2 types' historical methodology or byte-for-byte
 * `RoundCandidateCounts` shape for them. */
export function buildRoundContext(
  matchId: string,
  legacy: LegacyRound,
  roundSeq?: number,
  rawStreams?: RawStreams,
): RoundContext | null {
  const { friends, enemies, owner: productionOwner } = splitTeams(legacy);
  if (friends.length === 0 || enemies.length === 0) return null;
  const owner = friends.find((u) => isHealerSpec(u.spec)) ?? friends[0];

  let ownerCds: IMajorCooldownInfo[] = [];
  try {
    ownerCds = extractMajorCooldowns(owner, legacy);
  } catch {
    ownerCds = [];
  }

  const ccWindows = enemyHealerCcWindows(friends, enemies, legacy);
  const teamOffensiveCds: Array<IMajorCooldownInfo & { ownerName: string }> =
    [];
  // 队伍硬控台账 —— unsynced-burst 的可行性门(2026-08-22)在生产接线处用
  // `extractMajorCooldowns × cdAvailableAt × ccSpellIds` 组装;标定必须用**同一个**
  // 判据,否则阈值扫描测的是没有这道门的旧行为(共享谓词铁律)。和进攻台账复用
  // 同一次遍历,与 candidateFindings.ts 的接线逐字对应。
  const teamCcCds: IMajorCooldownInfo[] = [];
  for (const f of friends) {
    try {
      for (const cd of extractMajorCooldowns(f, legacy)) {
        if (ccSpellIds.has(cd.spellId)) teamCcCds.push(cd);
        if (!cd.isThroughput) continue;
        teamOffensiveCds.push({ ...cd, ownerName: f.name });
      }
    } catch {
      /* this friend's CD ledger not computable -> their CDs absent */
    }
  }
  const enemyHealerNames = enemies
    .filter((e) => isHealerSpec(e.spec))
    .map((e) => e.name as string);

  return {
    matchId,
    roundSeq,
    friends,
    enemies,
    owner,
    ownerCds,
    ccWindows,
    teamOffensiveCds,
    teamCcReadyAt: (tSeconds: number) =>
      teamCcCds.some((cd) => cdAvailableAt(cd, tSeconds)),
    enemyHealerNames,
    legacy,
    ownerResolvable: productionOwner !== undefined,
    rawStreams: rawStreams ?? UNAVAILABLE_RAW_STREAMS,
  };
}

export interface RoundCandidateCounts {
  matchId: string;
  roundSeq?: number;
  cdHoardedRaw: number;
  cdHoardedCapped: number;
  cdSpentIdleRaw: number;
  cdSpentIdleCapped: number;
  missedSyncWindowRaw: number;
  missedSyncWindowCapped: number;
  unsyncedBurstRaw: number;
  unsyncedBurstCapped: number;
  threatLevel: MatchThreatLevel;
  /** `ctx.rawStreams.available` carried through so a corpus scan can report
   * what fraction of rounds had no raw.txt (or an unparseable one) — the
   * denominator both mana-* types silently zero out against without any
   * other signal in this row. */
  rawAvailable: boolean;
  /** `ctx.ownerResolvable` carried through — see `RoundContext`'s own doc
   * comment (P1/P2 owner-phantom lesson). */
  ownerResolvable: boolean;
}

/**
 * Pure, cheap: counts every builder's raw (uncapped) and capped (shipped)
 * candidate count for one already-built round context, at the given
 * threshold overrides. No I/O, no re-derivation — every count comes from
 * calling the real exported builder. `threatOverrides` omitted reproduces
 * production's default thresholds exactly (each builder's own default-param
 * fallback to its module constant).
 *
 * missed-sync-window / unsynced-burst mirror `teamPlayEvents`' own gate: with
 * zero `ccWindows` (no hard CC ever landed on the enemy healer), both are
 * structurally zero — not computed, since "no window existed to test" is a
 * different fact from "windows existed and none qualified".
 */
export function countsAtThresholds(
  ctx: RoundContext,
  opts: {
    threatOverrides?: IThreatLevelOverrides;
  } = {},
): RoundCandidateCounts {
  const { friends, enemies, owner, ownerCds, legacy } = ctx;

  let threatLevel: MatchThreatLevel = "low";
  try {
    threatLevel = matchThreatLevel(
      enemies,
      friends,
      legacy,
      opts.threatOverrides,
    );
  } catch {
    threatLevel = "low";
  }

  let cdHoardedRaw = 0;
  let cdHoardedCapped = 0;
  try {
    // 2026-08-30 (GH #34 cd-hoarded decision-point rewrite): mirrors
    // production's candidateFindings.ts wiring — crisisDecisionPoints on the
    // owner for their own crises, plus every OTHER friendly's as a teammate
    // crisis (the `own` flag decides which help-gate cdHoardedEvents applies
    // per source).
    const sources = [
      {
        crisisUnit: { id: owner.id, name: owner.name },
        own: true,
        points: crisisDecisionPoints(owner, legacy),
      },
      ...friends
        .filter((f) => f.id !== owner.id)
        .map((f) => ({
          crisisUnit: { id: f.id, name: f.name },
          own: false,
          points: crisisDecisionPoints(f, legacy),
        })),
    ];
    cdHoardedCapped = cdHoardedEvents(sources, ownerCds, owner).length;
    cdHoardedRaw = cdHoardedEvents(sources, ownerCds, owner, {
      cap: UNCAPPED,
    }).length;
  } catch {
    /* not computable -> 0/0 */
  }

  let cdSpentIdleRaw = 0;
  let cdSpentIdleCapped = 0;
  try {
    const probes = {
      threatActiveAt: (t: number) =>
        threatActiveAt(t, enemies, friends, legacy, {
          damageWindowMs: opts.threatOverrides?.damageWindowMs,
        }),
    };
    cdSpentIdleCapped = cdSpentIdleEvents(
      ownerCds,
      owner,
      threatLevel,
      probes,
    ).length;
    cdSpentIdleRaw = cdSpentIdleEvents(ownerCds, owner, threatLevel, probes, {
      cap: UNCAPPED,
    }).length;
  } catch {
    /* not computable -> 0/0 */
  }

  let missedSyncWindowRaw = 0;
  let missedSyncWindowCapped = 0;
  let unsyncedBurstRaw = 0;
  let unsyncedBurstCapped = 0;
  if (ctx.ccWindows.length > 0) {
    try {
      const syncProbes = {
        enemyMinHpPctAt: (from: number, to: number) =>
          enemyMinHpPctInWindow(enemies, legacy, from, to),
        // Mirror teamPlayEvents' production wiring exactly (2026-09-02
        // resurrection): same death list, same bracket-keyed reference —
        // calibration densities are only comparable if the door is the same.
        enemyDeathS: enemies.flatMap((e: any) =>
          ((e.deathRecords ?? []) as any[]).map(
            (d: any) => ((d.timestamp as number) - legacy.startTime) / 1000,
          ),
        ),
        ref: lookupSyncWindowPrior(legacy?.startInfo?.bracket ?? ""),
      };
      missedSyncWindowCapped = missedSyncWindowEvents(
        ctx.ccWindows,
        ctx.teamOffensiveCds,
        syncProbes,
      ).length;
      missedSyncWindowRaw = missedSyncWindowEvents(
        ctx.ccWindows,
        ctx.teamOffensiveCds,
        syncProbes,
        { cap: UNCAPPED },
      ).length;
    } catch {
      /* not computable -> 0/0 */
    }
    try {
      const teamOffensiveCasts = ctx.teamOffensiveCds.flatMap((cd) =>
        cd.casts.map((c) => ({
          ownerName: cd.ownerName,
          spellId: cd.spellId,
          spellName: cd.spellName,
          castTimeSeconds: c.timeSeconds,
          cooldownSeconds: cd.cooldownSeconds,
        })),
      );
      unsyncedBurstCapped = unsyncedBurstEvents(
        teamOffensiveCasts,
        ctx.ccWindows,
        ctx.enemyHealerNames,
        ctx.teamCcReadyAt,
      ).length;
      unsyncedBurstRaw = unsyncedBurstEvents(
        teamOffensiveCasts,
        ctx.ccWindows,
        ctx.enemyHealerNames,
        ctx.teamCcReadyAt,
        { cap: UNCAPPED },
      ).length;
    } catch {
      /* not computable -> 0/0 */
    }
  }

  return {
    matchId: ctx.matchId,
    roundSeq: ctx.roundSeq,
    cdHoardedRaw,
    cdHoardedCapped,
    cdSpentIdleRaw,
    cdSpentIdleCapped,
    missedSyncWindowRaw,
    missedSyncWindowCapped,
    unsyncedBurstRaw,
    unsyncedBurstCapped,
    threatLevel,
    rawAvailable: ctx.rawStreams.available,
    ownerResolvable: ctx.ownerResolvable,
  };
}

/** One-shot convenience: build the context and count at the given
 * thresholds. What the CLI's main (n>=500, final-constants) scan calls per
 * round; the sensitivity sweep instead calls `buildRoundContext` once and
 * `countsAtThresholds` many times (see the module header). */
export function scanRound(
  matchId: string,
  legacy: LegacyRound,
  roundSeq: number | undefined,
  opts: Parameters<typeof countsAtThresholds>[1] = {},
  // Task 6: trailing optional param (not folded into `opts`) so every
  // pre-Task-6 call site (positional `opts` as the 4th arg) keeps compiling
  // and behaving byte-identically — `rawStreams` omitted degrades to
  // `UNAVAILABLE_RAW_STREAMS` via `buildRoundContext`'s own default.
  rawStreams?: RawStreams,
): RoundCandidateCounts | null {
  const ctx = buildRoundContext(matchId, legacy, roundSeq, rawStreams);
  if (!ctx) return null;
  return countsAtThresholds(ctx, opts);
}

interface TypeSummary {
  occurrenceRatePct: number;
  meanCappedPerRound: number;
  meanRawPerRound: number;
}

interface CalibrationSummary {
  roundsScanned: number;
  perType: {
    cdHoarded: TypeSummary;
    cdSpentIdle: TypeSummary;
    missedSyncWindow: TypeSummary;
    unsyncedBurst: TypeSummary;
  };
  threatDistributionPct: { low: number; med: number; high: number };
  /** Task 6: % of scanned rounds where `ctx.rawStreams.available` was true —
   * the denominator both mana-* types silently zero out against otherwise
   * (plan Task 6 deliverable "raw.txt availability rate"). */
  rawAvailableRatePct: number;
}

function typeSummary(
  rows: RoundCandidateCounts[],
  rawKey: keyof RoundCandidateCounts,
  cappedKey: keyof RoundCandidateCounts,
): TypeSummary {
  const n = rows.length;
  if (n === 0)
    return { occurrenceRatePct: 0, meanCappedPerRound: 0, meanRawPerRound: 0 };
  const capped = rows.map((r) => r[cappedKey] as number);
  const raw = rows.map((r) => r[rawKey] as number);
  const occurrence = capped.filter((c) => c > 0).length;
  return {
    occurrenceRatePct: (occurrence / n) * 100,
    meanCappedPerRound: capped.reduce((a, b) => a + b, 0) / n,
    meanRawPerRound: raw.reduce((a, b) => a + b, 0) / n,
  };
}

/** Aggregates a corpus scan's per-round rows into the report-shaped summary:
 * per-type 发生率 (% rounds with >=1 capped candidate) + 场均条数 (mean capped
 * count/round, plus mean raw for cap-truncation visibility) + threat-level
 * distribution. */
export function summarize(rows: RoundCandidateCounts[]): CalibrationSummary {
  const n = rows.length;
  const low = rows.filter((r) => r.threatLevel === "low").length;
  const med = rows.filter((r) => r.threatLevel === "med").length;
  const high = rows.filter((r) => r.threatLevel === "high").length;
  const rawAvailable = rows.filter((r) => r.rawAvailable).length;
  return {
    roundsScanned: n,
    perType: {
      cdHoarded: typeSummary(rows, "cdHoardedRaw", "cdHoardedCapped"),
      cdSpentIdle: typeSummary(rows, "cdSpentIdleRaw", "cdSpentIdleCapped"),
      missedSyncWindow: typeSummary(
        rows,
        "missedSyncWindowRaw",
        "missedSyncWindowCapped",
      ),
      unsyncedBurst: typeSummary(
        rows,
        "unsyncedBurstRaw",
        "unsyncedBurstCapped",
      ),
    },
    threatDistributionPct:
      n === 0
        ? { low: 0, med: 0, high: 0 }
        : {
            low: (low / n) * 100,
            med: (med / n) * 100,
            high: (high / n) * 100,
          },
    rawAvailableRatePct: n === 0 ? 0 : (rawAvailable / n) * 100,
  };
}
