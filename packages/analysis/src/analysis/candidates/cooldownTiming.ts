/**
 * Cooldown-timing candidate producers — `missed-sync-window`,
 * `unsynced-burst`, `cd-hoarded` and `cd-spent-idle`, plus the enemy-healer
 * CC window and friendly-crisis predicates they all key off.
 *
 * Split out of `candidateFindings.ts` on 2026-08-16 (mechanical split by
 * theme); logic moved verbatim. All four ask the same question from different
 * angles — was this button pressed at the moment the team's window wanted it —
 * which is why the shared window predicates live here with them.
 */
import { ABILITY_EFFECTS_GENERATED } from "../../data/abilityEffectsGenerated";
import { costNormPhrase } from "../../data/curatedAbilityFacts";
import { MITIGATION_TABLE } from "../../data/mitigationData";
import { OFF_GCD_SPELL_IDS } from "../../data/offGcdGenerated";
import { getEnglishSpellName } from "../../data/spellEffectData";
import { reachesAlly } from "../../data/spellTargeting";
import {
  syncRefClearsMinContrast,
  type SyncWindowPriorRef,
} from "../../data/syncWindowPrior";
import {
  type DecisionRecord,
  isDecisionTraceActive,
  traceDecision,
} from "../../facts/decisionTrace";
import { isAllyCopyWallId } from "../../utils/allyCopyWall";
import { buffFullDurationForCaster } from "../../utils/buffDuration";
import { burstCastSpan } from "../../utils/burstLedger";
import {
  type ActWindowState,
  cannotCastIntervalsForSpells,
  couldActForMostOf,
  lockedSchoolsText,
} from "../../utils/cannotCastIntervals";
import { oppressingRoarOnAtMs } from "../../utils/ccBreakAnalysis";
import { ccFullDurationForApplication } from "../../utils/ccDuration";
import {
  ccRemovalCause,
  formatCcRemovalCause,
  type ICcRemovalCause,
  renderedCcDuration,
} from "../../utils/ccTrinketAnalysis";
import {
  CD_INSTANT_SLACK_S,
  cdAvailableAt,
  cdCanHelpAnotherUnit,
  cdChargeStateAt,
  cdIsProcOnly,
  cdReadyInTimeAt,
  DEFENSIVE_TAGS,
  getUnitHpAtTimestamp,
  HP_SAMPLE_RADIUS_MS,
  type IMajorCooldownInfo,
  isHealerSpec,
  lockCastsOf,
  SELF_CAST_NOOP_EXTERNAL_IDS,
  THROUGHPUT_EMPOWER_DEFENSIVE_IDS,
} from "../../utils/cooldowns";
import {
  analyzeOutgoingCCChains,
  DR_CATEGORY_MAP,
  drDurationFactor,
  type DRLevel,
} from "../../utils/drAnalysis";
import { reconstructEnemyCDTimeline } from "../../utils/enemyCDs";
import { incomingPressureBySchool } from "../../utils/incomingPressure";
import {
  distanceBetween,
  getUnitPositionAtTime,
} from "../../utils/losAnalysis";
import { cdOutOfRangeReachYards, isDeadAt } from "../../utils/positionAnalysis";
import { INTERP_MAX_GAP_MS } from "../../utils/positionSampling";
import { castFailedInWindow, type RawStreams } from "../../utils/rawStreams";
import { renderedWindowSeconds, toRenderSecond } from "../../utils/renderGrid";
import type { RosterSides } from "../../utils/rosterSide";
import { SOLO_SHUFFLE_BRACKET } from "../../utils/roundEnd";
import { OFFENSIVE_CD_SPELL_IDS } from "../../utils/spellDanger";
import { type MatchThreatLevel } from "../../utils/threatAssessment";
import {
  type DecisionPoint,
  DMG_WINDOW_MS,
  RESPONSE_PRE_MS,
  schoolShareCoveredBy,
} from "../crisisDecisionPoints";
import { fmtFactNum as fmt } from "../factFormat";
import { CandidateEvent } from "../types";
import {
  filterIntentGuardEvidence,
  formatAttemptedFact,
  gcdLockedUntilS,
  INTENT_GUARD_GCD_S,
  NOT_READY_REASONS,
} from "./shared";

/**
 * HARD_CC_CATEGORIES (P1 sync-lens, 2026-08-15, `missedSyncWindowEvents` /
 * `unsyncedBurstEvents`): the DR categories that count as "the enemy healer
 * is locked out of casting" — mirrors `DR_CATEGORY_MAP`'s full PvP-relevant
 * label set (drAnalysis.ts's `SCM_CATEGORY_LABELS` already excludes
 * 'taunt'/'root' at the source, "not relevant for PvP CC analysis") minus
 * "Root" defensively (currently a no-op — no spell maps to it — kept in case
 * a future DR-category addition ever does). Two existing precedents back this
 * exact split, not a fresh invention:
 *  - `ccBreakAnalysis.ts`'s `rootBreakCount` bucket: "kept in its own bucket,
 *    never mixed into hard CC (a broken root is often a tactically correct
 *    trade, not a mistake to coach)".
 *  - `matchArchetype.ts`'s `classifiedFriendlyCCEvents`: CC events whose
 *    spell IS in the DR category map are already this file's established
 *    "hard CC" measurement; the remainder ("roots, minor incapacitates, or
 *    unmapped spells") is explicitly documented as "not hard CC".
 * Every application `analyzeOutgoingCCChains` returns is already restricted
 * to `ccSpellIds` (spellCategories' `type === "cc"`, the same set
 * `isCastBlockingAuraType` treats as cast-blocking) — this filter narrows
 * that further to the subset with recognized DR bookkeeping, matching the
 * matchArchetype.ts precedent rather than re-deriving a parallel "hard CC"
 * notion from spellCategories directly.
 */
export const HARD_CC_CATEGORIES: ReadonlySet<string> = new Set(
  Object.values(DR_CATEGORY_MAP).filter((category) => category !== "Root"),
);

export interface IEnemyHealerCcWindow {
  fromSeconds: number;
  toSeconds: number;
  spellName: string;
  spellId: string;
  healerName: string;
  /** who applied it (`IOutgoingCCApplication.casterName`, the log's source
   * name) — read only by the `setupBy` fact (B11b) */
  casterName?: string;
  drLevel?: DRLevel;
  /** what ended the lock, when the log says (`ccRemovalCause`; sync-burst
   * F-S3) — a CC that ran out or was capped at the round end has none */
  endedBy?: ICcRemovalCause;
}

/**
 * Shared "敌治疗硬控窗" extraction (CLAUDE.md shared-predicate rule): both
 * `missedSyncWindowEvents` and `unsyncedBurstEvents` consume the exact same
 * windows so a "the healer was locked" fact can never disagree between the
 * two candidate types. Built on `analyzeOutgoingCCChains` — the same
 * outgoing-CC data source `dr-clipped-cc` already reads — filtered to
 * targets `isHealerSpec` classifies as the enemy healer, then narrowed to
 * `HARD_CC_CATEGORIES` (see its doc comment for the category decision).
 * `friends`/`enemies` decide caster/target sides exactly as every other
 * `teamPlayEvents` caller passes them; matching a chain to "the enemy healer"
 * is by `targetName` because `IOutgoingCCChain` does not carry a target unit
 * id (analyzeOutgoingCCChains' own return shape).
 *
 * Exported (review fix round 1, 2026-08-15): originally file-private, kept
 * exported so tests can call it directly instead of re-deriving its logic.
 * `missedSyncWindowEvents`/`unsyncedBurstEvents` are wired into
 * `teamPlayEvents` (candidateFindings.ts) and both flags have been ON since
 * 2026-08-15 — see docs/predicate-index.md's `Feature flag state` table for
 * the current expected value of every flag.
 */
export function enemyHealerCcWindows(
  friends: any[],
  enemies: any[],
  combat: any,
): IEnemyHealerCcWindow[] {
  const healerNames = new Set(
    enemies.filter((e) => isHealerSpec(e.spec)).map((e) => e.name as string),
  );
  if (healerNames.size === 0) return [];
  const out: IEnemyHealerCcWindow[] = [];
  for (const chain of analyzeOutgoingCCChains(friends, enemies, combat)) {
    if (!healerNames.has(chain.targetName)) continue;
    const healer = enemies.find((e) => e.name === chain.targetName);
    for (const app of chain.applications) {
      if (!HARD_CC_CATEGORIES.has(app.drInfo.category)) continue;
      if (app.drInfo.level === "Immune") continue;
      const applyMs = Math.round(combat.startTime + app.atSeconds * 1000);
      // the official length at its DR step, as `[CC ON ENEMY] broke out`
      // reads it: a CC that ran its course was not ended by a press. Under an
      // Oppressing Roar that course is 30 % longer (FT-T07) — the one
      // per-application length, `ccFullDurationForApplication`.
      const full = ccFullDurationForApplication(
        app.spellId,
        friends.find((f) => f.name === app.casterName),
        healer ? oppressingRoarOnAtMs(healer, app.spellId, applyMs) : false,
      );
      const endedBy = healer
        ? ccRemovalCause(
            healer,
            app.spellId,
            applyMs,
            Math.round(
              combat.startTime + (app.atSeconds + app.durationSeconds) * 1000,
            ),
            full === undefined
              ? undefined
              : applyMs + full * drDurationFactor(app.drInfo.level) * 1000,
          )
        : undefined;
      out.push({
        fromSeconds: app.atSeconds,
        toSeconds: app.atSeconds + app.durationSeconds,
        spellName: app.spellName,
        spellId: app.spellId,
        healerName: chain.targetName,
        casterName: app.casterName,
        drLevel: app.drInfo.level,
        ...(endedBy ? { endedBy } : {}),
      });
    }
  }
  return out.sort((a, b) => a.fromSeconds - b.fromSeconds);
}

/** Per-match cap for missed-sync-window. <标定定稿 2026-08-15,报告
 * p1p2-calibration.md>: confirmed at 2, unchanged — full-corpus scan (1028
 * matches/3441 rounds, at B8's fixed no-HP-gate definition, which Task 5 has
 * no threshold lever over) measured 场均条数(capped) 1.37 (raw pre-cap 3.20),
 * comfortably inside the 0.5–2 target band; the cap is doing real
 * truncation work (raw > capped), not sitting idle. 发生率 76.4% sits above
 * every OTHER type's precedent (max 63.6%) — but that is a property of B8's
 * user-ruled "no HP gate" design already locked before Task 5, not a
 * threshold this constant can move; a lower cap would only shrink how many
 * of an already-firing round's windows get reported, not how often the type
 * fires at all. 双向误差注: a lower cap would drop real, distinct missed
 * windows from an already-high-occurrence round (each window is an
 * independent "we had the lock and didn't press it" fact); a higher cap
 * would let a single grindy round dominate the menu even more than the
 * 3.20 raw average already implies it wants to. */
const MISSED_SYNC_WINDOW_CAP = 2; // <标定定稿 2026-08-15,报告 p1p2-calibration.md>

/**
 * missed-sync-window (P1 起爆-1, 2026-08-15; REDESIGNED 2026-09-02 — the
 * GH #13 resurrection, user-approved): a window where the enemy healer sat in
 * hard CC (`enemyHealerCcWindows`) while >=1 friendly canonical offensive
 * major cooldown was ready (`cdAvailableAt` at the window's start) AND no
 * friendly canonical offensive major was cast in [start−2s, end] (the team
 * had the lock and the tool, and did not press it).
 *
 * What the resurrection changed vs the 2026-08-15 predicate (each item is
 * shared with syncWindowScan.ts — the reference table and the candidate are
 * about the same population by construction, CLAUDE.md shared-predicate
 * rule):
 *   - CD table: caller now filters on `OFFENSIVE_CD_SPELL_IDS`
 *     (spellDanger.ts, chg9 canonical 47) instead of `isThroughput`, which
 *     had been listing Tiger's Lust / Berserker Shout / racials as "ready
 *     offensive CDs".
 *   - Eligibility: rendered duration >= SYNC_WINDOW_MIN_DUR_S; rendered
 *     start >= SYNC_WINDOW_MIN_T_S (opener/setup windows excluded); windows
 *     containing an enemy death are excluded (a kill already converting
 *     without CDs is not a missed sync).
 *   - entered: the press may lead the lock by up to SYNC_ENTER_LEAD_S — a CD
 *     opened 1 s before the stun lands is sync, not a miss.
 *   - Reference + door: the bracket's corpus cell (syncWindowPrior.ts) is
 *     quoted in facts, and a bracket whose entered/unentered kill contrast
 *     is under `SYNC_REF_MIN_CONTRAST_PP` (or whose cell misses the n floor)
 *     produces NO candidates — this is what keeps the flood GH #13
 *     documented (74% fire rate, mostly Solo Shuffle) from returning
 *     without hand-coding a bracket list.
 *
 * B8 red line (user-ruled, non-negotiable, CI-pinned by a dedicated test):
 * NO HP gate — unchanged by the resurrection. Enemy HP is carried in facts
 * as an accelerator only; `minHp === null` (no advanced logging) still
 * emits. (The death-in-window exclusion above is an outcome-event gate, not
 * a blood threshold: the 93%-to-dead B1 finale case B8 protects has no
 * enemy death BEFORE the sync and still fires.)
 *
 * Fact/suggestion split (CLAUDE.md decision-point-card discipline): facts
 * carry only what happened plus the corpus reference numbers — "you should
 * have burst" lives in buildFindingsPrompt's legend text.
 *
 * Severity/cap: sorted by rendered window length (a longer lock is a bigger
 * missed opportunity), then capped at MISSED_SYNC_WINDOW_CAP.
 */
/**
 * Reliability audit B3 (2026-09-25): the shared sync-window predicate — ONE
 * function set the candidate AND `packages/eval/scripts/syncWindowScan.ts`
 * (the reference table) run, so the table is measured on exactly the windows
 * and the "entered" the candidate judges (the scan used to carry its own copy
 * of the eligibility gates).
 *
 * B3ii — one continuous lock is one window. `enemyHealerCcWindows` emits one
 * window per CC application; 825ca842's Fear 51.24–55.77 + Blind 51.35–53.85
 * + Cheap Shot 53.59–57.19 on the same healer became two missed-sync
 * candidates (both of the round's cap). Windows on the same healer that
 * overlap or touch merge; the merged window keeps the opener's id / DR and
 * names the chain "Fear→Cheap Shot".
 */
/** What `mergeHealerCcWindows` adds to the opener: every component's start
 * (a merged lock is judged at each) and who cast each component. */
export interface MergedLockParts {
  componentStartsSeconds: number[];
  componentCasters: Array<{ spellName: string; casterName?: string }>;
}

/**
 * A merged lock's name: its components in order, joined by "→", a run of the
 * same control written once with its count — `Fear→Cheap Shot`,
 * `Hammer of Justice ×2`. FT-T09: a run used to be written once with no
 * count, so two Hammers of Justice (2 s + 3 s on the timeline) read
 * `cc=Hammer of Justice, durationS=5` — one control, of a length no
 * `[CC ON ENEMY]` line shows.
 */
export function lockChainName(names: readonly string[]): string {
  const runs: Array<{ name: string; n: number }> = [];
  for (const name of names) {
    const last = runs[runs.length - 1];
    if (last && last.name === name) last.n++;
    else runs.push({ name, n: 1 });
  }
  return runs.map((r) => (r.n > 1 ? `${r.name} ×${r.n}` : r.name)).join("→");
}

export function mergeHealerCcWindows<
  W extends Pick<
    IEnemyHealerCcWindow,
    | "fromSeconds"
    | "toSeconds"
    | "spellName"
    | "spellId"
    | "healerName"
    | "casterName"
    | "drLevel"
    | "endedBy"
  >,
>(windows: readonly W[]): Array<W & MergedLockParts> {
  const out: Array<W & MergedLockParts> = [];
  const byHealer = new Map<string, W[]>();
  for (const w of windows) {
    const list = byHealer.get(w.healerName) ?? [];
    list.push(w);
    byHealer.set(w.healerName, list);
  }
  for (const list of byHealer.values()) {
    const sorted = [...list].sort((a, b) => a.fromSeconds - b.fromSeconds);
    let cur = null as W | null;
    let names: string[] = [];
    let starts: number[] = [];
    let casters: MergedLockParts["componentCasters"] = [];
    for (const w of sorted) {
      if (cur && w.fromSeconds <= cur.toSeconds) {
        // the chain ends where its last-ending component ends, and so does
        // what ended it (sync-burst F-S3: "the last component's removal")
        const extends_ = w.toSeconds >= cur.toSeconds;
        cur = { ...cur, toSeconds: Math.max(cur.toSeconds, w.toSeconds) };
        if (extends_) {
          if (w.endedBy) cur.endedBy = w.endedBy;
          else delete cur.endedBy;
        }
        names.push(w.spellName);
        starts.push(w.fromSeconds);
        casters.push({ spellName: w.spellName, casterName: w.casterName });
        continue;
      }
      if (cur)
        out.push({
          ...cur,
          spellName: lockChainName(names),
          componentStartsSeconds: starts,
          componentCasters: casters,
        });
      cur = { ...w };
      names = [w.spellName];
      starts = [w.fromSeconds];
      casters = [{ spellName: w.spellName, casterName: w.casterName }];
    }
    if (cur)
      out.push({
        ...cur,
        spellName: lockChainName(names),
        componentStartsSeconds: starts,
        componentCasters: casters,
      });
  }
  return out.sort((a, b) => a.fromSeconds - b.fromSeconds);
}

/** Eligibility of a (merged) enemy-healer lock: rendered start ≥
 * SYNC_WINDOW_MIN_T_S, rendered length ≥ SYNC_WINDOW_MIN_DUR_S, and no enemy
 * died inside it. */
export function syncWindowEligible(
  w: Pick<IEnemyHealerCcWindow, "fromSeconds" | "toSeconds">,
  enemyDeathS: readonly number[],
): boolean {
  const t = toRenderSecond(w.fromSeconds);
  if (t < SYNC_WINDOW_MIN_T_S) return false;
  if (toRenderSecond(w.toSeconds) - t < SYNC_WINDOW_MIN_DUR_S) return false;
  return !enemyDeathS.some((d) => d >= w.fromSeconds && d <= w.toSeconds);
}

/** An offensive CD with, optionally, the unit that owns it — needed for the
 * B3i feasibility gate and the B3iii active-span check. Without an owner both
 * fall back to the pre-2026-09-25 behaviour. */
export type SyncWindowCd = Pick<
  IMajorCooldownInfo,
  | "spellId"
  | "spellName"
  | "casts"
  | "cooldownSeconds"
  | "neverUsed"
  | "charges"
> &
  Partial<Pick<IMajorCooldownInfo, "responseOnly">> & {
    /** the unit that owns the CD */
    owner?: any;
    /** the owner's enemies' ids (for `buildCannotCastIntervals`) */
    ownerEnemyIds?: Set<string>;
    /** the round's units — a cooldown the owner's PET casts is asked of the
     *  pet (`cannotCastIntervalsForSpells`); absent = the owner's reading */
    roundUnits?: readonly any[];
    /** absolute ms of match start (the owner's intervals are absolute) */
    matchStartMs?: number;
    /** The enemies a burst in this lock would land on — every enemy but the
     *  healers (the lock is on a healer). With them, a CD that hits an enemy
     *  is ready only if its owner was within the spell's own reach
     *  (`cdOutOfRangeReachYards`, the CD_OUT_OF_RANGE predicate) of one of
     *  them at some half-second of the free part of the lock. */
    reachTargets?: readonly any[];
    /** work order 2026-10-14d Part 2 (preview): each press's OBSERVED effect
     *  end (`burstCastSpan`'s `buffEndSeconds`), keyed by the press second in
     *  whole ms; absent → the official length */
    castEndS?: ReadonlyMap<number, number>;
  };

/** Hard-cast bars a START → SUCCESS pair can span (the [ENEMY HARD CAST] /
 *  hardCastOccupancyWithin bound). */
const SYNC_CAST_BAR_MAX_S = 12;

/** One SyncWindowCd per friendly offensive CD — the candidate and
 *  syncWindowScan (the reference table) build it the same way. */
export function syncWindowCdFor<T extends object>(
  cd: T,
  owner: any,
  enemies: readonly any[],
  ownerEnemyIds: Set<string>,
  matchStartMs: number,
  /** the round's units (`combat.units`) — required, so the candidate and the
   *  scan cannot differ on whose intervals a pet-cast cooldown is asked of */
  roundUnits: readonly any[],
  /** the round — with it each press carries its observed effect end
   *  (`castEndS`); the candidate and the scan both pass it */
  combat?: any,
): T & {
  owner: any;
  ownerEnemyIds: Set<string>;
  matchStartMs: number;
  reachTargets: readonly any[];
  roundUnits: readonly any[];
} {
  let castEndS: Map<number, number> | undefined;
  if (combat) {
    try {
      castEndS = new Map(
        (
          reconstructEnemyCDTimeline([owner], combat).players[0]
            ?.offensiveCDs ?? []
        )
          .filter((c) => c.spellId === String((cd as any).spellId))
          .map((c) => [Math.round(c.castTimeSeconds * 1000), c.buffEndSeconds]),
      );
    } catch {
      castEndS = undefined;
    }
  }
  return {
    ...cd,
    owner,
    ownerEnemyIds,
    matchStartMs,
    reachTargets: enemies.filter((e) => !isHealerSpec(e.spec)),
    roundUnits,
    ...(castEndS ? { castEndS } : {}),
  };
}

/** Could the CD's owner reach any burst target with it during [fromS, toS]?
 *  true when unknowable (no reach for the spell, no positions) — fail-open,
 *  like CD_OUT_OF_RANGE's abstentions. Reliability round 3 W1a: 82a2 (a
 *  Warrior knocked 16–26 yd away by Thunderstorm, his Colossus Smash
 *  "ready"), fd45 (a Rogue on the healer he Gouged, the kill target out of
 *  Deathmark's reach — Mutilate "Out of range" 82.284). */
function syncCdReachable(
  cd: SyncWindowCd,
  fromS: number,
  toS: number,
  /** the owner's cannot-cast intervals (ms): reach counts only at an instant
   *  the owner could also act (codex review of batch 11 — a Warrior close to
   *  the enemy only while stunned, 25 yd away once free, was "ready") */
  blocked: ReadonlyArray<{ from: number; to: number }> = [],
): boolean {
  if (!cd.owner || !cd.reachTargets || cd.matchStartMs === undefined)
    return true;
  // no non-healer enemy at all, or every one of them dead through the lock:
  // there is no burst target to sync onto (agy review of batch 11 — a 2v2
  // whose enemy DPS died earlier was accused against the lone healer)
  if (cd.reachTargets.length === 0) return false;
  const anyAlive = (() => {
    for (let t = fromS; t <= toS + 1e-9; t += 0.5)
      if (
        cd.reachTargets!.some((e) => !isDeadAt(e, cd.matchStartMs! + t * 1000))
      )
        return true;
    return false;
  })();
  if (!anyAlive) return false;
  const reach = cdOutOfRangeReachYards(cd.owner, cd.spellId);
  if (reach === null) return true;
  // Unreachable only when the owner was observed free at some instant AND
  // every burst target alive during the free part was observed at least once
  // then — never in reach. A target never positioned while the owner was free
  // could be the one in reach (codex review of batch 11: a missing nearby
  // enemy plus a far one read as "out of reach"); a sample gap of either
  // side is bridged by the samples around it (probe 2026-09-27, 545-1: a
  // rogue 23–38 yd off both targets with a 2 s gap of his own must stay
  // unreachable). Samples inside the owner's cannot-cast intervals do not
  // count at all (codex: a Warrior close only while stunned).
  const seen = new Set<NonNullable<SyncWindowCd["reachTargets"]>[number]>();
  const alive = new Set<NonNullable<SyncWindowCd["reachTargets"]>[number]>();
  let sawOwner = false;
  for (let t = fromS; t <= toS + 1e-9; t += 0.5) {
    const tMs = cd.matchStartMs + t * 1000;
    if (blocked.some((b) => tMs >= b.from && tMs < b.to)) continue;
    // a target alive while the owner is free must be seen at an instant the
    // owner is seen too — enumerate it whether or not the owner has a
    // position now (codex re-check: a target alive only while the owner
    // was unpositioned never entered the set and read "out of reach")
    for (const e of cd.reachTargets) if (!isDeadAt(e, tMs)) alive.add(e);
    const o = getUnitPositionAtTime(cd.owner, tMs, INTERP_MAX_GAP_MS);
    if (!o) continue;
    sawOwner = true;
    for (const e of cd.reachTargets) {
      if (isDeadAt(e, tMs)) continue;
      const p = getUnitPositionAtTime(e, tMs, INTERP_MAX_GAP_MS);
      if (!p) continue;
      seen.add(e);
      if (distanceBetween(o, p) <= reach) return true;
    }
  }
  if (!sawOwner) return true;
  for (const e of alive) if (!seen.has(e)) return true;
  return false;
}

/** When the press of `c` began: the owner's SPELL_CAST_START of the same
 *  spell ≤ SYNC_CAST_BAR_MAX_S before the success, else the success. */
function syncPressStartS(cd: SyncWindowCd, successS: number): number {
  const starts = cd.owner?.castStartEvents;
  if (!starts?.length || cd.matchStartMs === undefined) return successS;
  // the LATEST start of the spell before the success is this bar
  let latest = -Infinity;
  for (const e of starts) {
    if (e.spellId !== cd.spellId) continue;
    const s = (e.timestamp - cd.matchStartMs) / 1000;
    if (s <= successS && s >= successS - SYNC_CAST_BAR_MAX_S && s > latest)
      latest = s;
  }
  return latest === -Infinity ? successS : latest;
}

/**
 * Which offensive CDs were READY for this lock, and did the team ENTER it.
 *
 * B3i — ready needs an owner who could act: at least REACTION_WINDOW_S (the
 * 2026-09-23 reaction ruling) of the lock outside the owner's own cannot-cast
 * intervals (hard CC, silence, kick lockouts — the shared
 * `buildCannotCastIntervals`). e9ea8a0c @298: the Demon Hunter's The Hunt was
 * "ready" while he was stunned by a Capacitor Totem for most of the window.
 * Roots are not cannot-cast (whether a given CD works while rooted is not in
 * the repo's data), so a rooted owner stays ready — the fail-open direction.
 *
 * B3iii — entered counts a burst whose ACTIVE span overlaps the lock, not only
 * a press inside [from − SYNC_ENTER_LEAD_S, to]: 7c598eeb r0 @33, the Balance
 * Druid's Incarnation was running 17.4–37.4 across the whole Cyclone, and its
 * second charge made it "ready" and the window "unentered". The span is the
 * cast plus the owner's full buff duration (`buffFullDurationForCaster`,
 * talent-aware); unknown duration → the press instant only (the old test).
 */
export function evaluateSyncWindow(
  w: Pick<IEnemyHealerCcWindow, "fromSeconds" | "toSeconds"> & {
    /** Starts of the locks a merged window is made of
     * (`mergeHealerCcWindows`); absent = the window's own start. */
    componentStartsSeconds?: readonly number[];
  },
  cds: readonly SyncWindowCd[],
): { ready: SyncWindowCd[]; entered: boolean } {
  // A merged lock is judged at each of its component starts — a CD that
  // comes off cooldown mid-lock was ready for the part of the lock that
  // followed, exactly as the unmerged windows judged it. Found on the desktop
  // uncoveredHighlights fixture: Intimidation 82.2 merged with Freezing Trap
  // 85 → one window from 82.2, and Avenging Wrath (back at 84) was lost.
  const starts = w.componentStartsSeconds?.length
    ? w.componentStartsSeconds
    : [w.fromSeconds];
  const ready = cds.filter((cd) => {
    // a response-only row (`IMajorCooldownInfo.responseOnly`) enters a lock
    // when pressed — `entered` below — and is never named ready and unpressed
    if (cd.responseOnly) return false;
    const readyAtS = starts.find((s) => cdAvailableAt(cd, s));
    if (readyAtS === undefined) return false;
    // F-S1 (triage sync-burst): a holder dead at the instant its cooldown
    // counts as ready holds nothing — 539b6ed0, Incarnation "ready" for a
    // lock starting 1.3 s after its Druid died. `isDeadAt` is the one dead-at
    // predicate (the kill-window facts, [RES] and the cd-hoarded gate read it).
    if (
      cd.owner &&
      cd.matchStartMs !== undefined &&
      isDeadAt(cd.owner, cd.matchStartMs + readyAtS * 1000)
    )
      return false;
    if (!cd.owner || !cd.ownerEnemyIds || cd.matchStartMs === undefined)
      return true;
    let blocked: Array<{ from: number; to: number }>;
    try {
      // FT-T10: a lockout counts only when it locks this cooldown's school;
      // a cooldown the owner's pet casts is asked of the pet
      blocked = cannotCastIntervalsForSpells(
        cd.owner,
        cd.ownerEnemyIds,
        [cd.spellId],
        cd.roundUnits,
      );
    } catch {
      return true;
    }
    const fromMs = cd.matchStartMs + readyAtS * 1000;
    const toMs = cd.matchStartMs + w.toSeconds * 1000;
    // user ruling 2026-09-26: free for most of the lock, not merely 1 s of it
    if (!couldActForMostOf(blocked, fromMs, toMs)) return false;
    return syncCdReachable(cd, readyAtS, w.toSeconds, blocked);
  });
  const entered = cds.some((cd) =>
    cd.casts.some((c) => castEntersWindow(cd, c, w)),
  );
  return { ready, entered };
}

/** Did this press of `cd` enter the lock `w` — the ONE "entered" test
 *  (`evaluateSyncWindow`'s verdict and the `enteredNextLock` fact). */
function castEntersWindow(
  cd: SyncWindowCd,
  c: { timeSeconds: number },
  w: { fromSeconds: number; toSeconds: number },
): boolean {
  // work order 2026-10-14d Part 2 (preview): the press's OBSERVED end when
  // the CD timeline has it (`burstCastSpan` reads the same field), else the
  // official length
  const observed = cd.castEndS?.get(Math.round(c.timeSeconds * 1000));
  const spanEnd =
    observed ??
    c.timeSeconds +
      (cd.owner ? (buffFullDurationForCaster(cd.spellId, cd.owner) ?? 0) : 0);
  // a press leading the lock by ≤ SYNC_ENTER_LEAD_S (the old test), or a
  // burst still ACTIVE when the lock starts — a burst that ended before
  // the lock is not in it, however close
  // a hard-cast CD enters when its bar STARTS inside the lock (round 3
  // W1a, f4eb: Summon Demonic Tyrant started 166.724 inside a lock
  // ending 167.143, landed 167.861 — "none entered")
  const startS = syncPressStartS(cd, c.timeSeconds);
  const pressedIn =
    (c.timeSeconds >= w.fromSeconds - SYNC_ENTER_LEAD_S &&
      c.timeSeconds <= w.toSeconds) ||
    (startS >= w.fromSeconds - SYNC_ENTER_LEAD_S && startS <= w.toSeconds);
  const activeIn = c.timeSeconds <= w.toSeconds && spanEnd > w.fromSeconds;
  return pressedIn || activeIn;
}

/**
 * Reliability audit B3iii (user ruling 2026-09-25): which of a HEALER's own
 * offensive cooldowns count as team burst for a sync window. Only Power
 * Infusion — it is handed to a DPS for their burst. The others a healer
 * holds (Holy Paladin Avenging Wrath, Discipline Archangel, Restoration
 * Shaman Ascendance) add little to the team's damage ("除了灌注 其他对输出帮助
 * 不大"). Hand table, registered in curatedIdRegistry.
 */
export const HEALER_TEAM_BURST_IDS: ReadonlySet<string> = new Set([
  "10060", // Power Infusion
]);

/** Does this friendly's offensive cooldown count as team burst for a sync
 * window — the canonical offensive table, and for a healer only
 * `HEALER_TEAM_BURST_IDS`. One predicate for the candidate and
 * syncWindowScan (the reference table it quotes). */
export function countsAsTeamBurst(
  owner: { spec?: unknown },
  spellId: string,
): boolean {
  if (!OFFENSIVE_CD_SPELL_IDS.has(spellId)) return false;
  return (
    !isHealerSpec(owner.spec as never) || HEALER_TEAM_BURST_IDS.has(spellId)
  );
}

/** Signed one-decimal offset, the `attemptedAt` convention. */
const signedS = (d: number): string => `${d >= 0 ? "+" : ""}${d.toFixed(1)}`;

/**
 * The per-CD timing a `missed-sync-window` line cannot show with names
 * alone (triage sync-burst F-S2 / F-S6; facts only — the verdict, the gates
 * and the 09-02 window are unchanged). Offsets are intervals between raw
 * instants (one decimal), relative to the lock's raw start or end:
 *
 *  - `pressedAfter` (A36 = A, 2026-09-30): a ready CD whose first press after
 *    the lock falls in (end, end + SYNC_ENTER_LEAD_S] — b711d4ac's Kingsbane
 *    0.28 s after the Cyclone ended.
 *  - `readyFrom`: a ready CD that came back from cooldown within the
 *    SYNC_ENTER_LEAD_S before the lock or during it, at its RAW return (last
 *    press + cooldown, charge-aware) — not `cdAvailableAt`'s first true
 *    instant, which includes the 0.5 s slack (e10c6bea Kingsbane: +0.4, the
 *    slack would print −0.1). Omitted for a rate-warped cooldown.
 *  - `holderCc`: the ready CD's holder's own cannot-cast intervals for THIS
 *    cooldown (the gate's `cannotCastIntervalsForSpells`, no second
 *    predicate) that overlap the lock, unclipped — a disarm among them when
 *    the cooldown needs a weapon (since work order 2026-10-14d Part 2b). For
 *    a cooldown the holder's pet casts the gate reads the PET's intervals,
 *    and none of those is printed.
 */
export function syncReadyTimingFacts(
  w: { fromSeconds: number; toSeconds: number },
  ready: readonly SyncWindowCd[],
): { pressedAfter?: string; readyFrom?: string; holderCc?: string } {
  const pressedAfter: string[] = [];
  const readyFrom: string[] = [];
  const holderCc: string[] = [];
  for (const cd of ready) {
    const after = cd.casts.find(
      (c) =>
        c.timeSeconds > w.toSeconds &&
        c.timeSeconds <= w.toSeconds + SYNC_ENTER_LEAD_S,
    );
    if (after)
      pressedAfter.push(
        `${cd.spellName} ${signedS(after.timeSeconds - w.toSeconds)}s`,
      );
    const ret = rawReturnAfter(cd, w.fromSeconds - SYNC_ENTER_LEAD_S);
    if (ret !== null && ret <= w.toSeconds)
      readyFrom.push(`${cd.spellName} ${signedS(ret - w.fromSeconds)}s`);
    if (cd.owner && cd.ownerEnemyIds && cd.matchStartMs !== undefined) {
      let blocked: Array<{ from: number; to: number }> = [];
      try {
        // the gate's own intervals (FT-T10): what stopped THIS cooldown —
        // on the holder. The fact says "the holder was hard-CC'd / silenced
        // / locked out / disarmed", so what the gate read on the holder's PET
        // (a cooldown the pet casts) is not printed here.
        blocked = cannotCastIntervalsForSpells(
          cd.owner,
          cd.ownerEnemyIds,
          [cd.spellId],
          cd.roundUnits,
        ).filter((iv) => iv.onPetId === undefined);
      } catch {
        blocked = [];
      }
      const fromMs = cd.matchStartMs + w.fromSeconds * 1000;
      const toMs = cd.matchStartMs + w.toSeconds * 1000;
      const spans = blocked
        .filter((b) => b.from < toMs && b.to > fromMs)
        .sort((a, b) => a.from - b.from)
        .map(
          (b) =>
            `${signedS((b.from - fromMs) / 1000)}…${signedS((b.to - fromMs) / 1000)}s`,
        );
      if (spans.length) holderCc.push(`${cd.spellName} ${spans.join(" ")}`);
    }
  }
  return {
    ...(pressedAfter.length ? { pressedAfter: pressedAfter.join("; ") } : {}),
    ...(readyFrom.length ? { readyFrom: readyFrom.join("; ") } : {}),
    ...(holderCc.length ? { holderCc: holderCc.join("; ") } : {}),
  };
}

/** When `cd` came back if it was NOT available at `probeS` (raw, no slack):
 *  the last press ≤ probeS + its cooldown, or the next charge; null when it
 *  was available at probeS (or its clock is rate-warped). */
function rawReturnAfter(cd: SyncWindowCd, probeS: number): number | null {
  if ((cd as { rateWindows?: unknown[] }).rateWindows?.length) return null;
  const lock = lockCastsOf(cd as IMajorCooldownInfo).filter(
    (c) => c.timeSeconds <= probeS,
  );
  if ((cd.charges ?? 1) > 1) {
    // the entry's own per-press effects (codex 60-POSTHOC-04b #2: an
    // Incarnation under Control of the Dream read back at 130 s, not 115)
    const st = cdChargeStateAt(
      cd as IMajorCooldownInfo,
      lock.map((c) => c.timeSeconds),
      probeS,
    );
    return st.charges > 0 ? null : st.nextRecharge;
  }
  const last = lock.at(-1);
  if (!last) return null;
  const ret =
    last.timeSeconds + (last.cooldownSecondsOverride ?? cd.cooldownSeconds);
  return ret > probeS ? ret : null;
}

export const SYNC_WINDOW_MIN_T_S = 30;
export const SYNC_WINDOW_MIN_DUR_S = 3;
export const SYNC_ENTER_LEAD_S = 2;
/** `endedBy` of a lock the round ended on (F06a) — what its `[CC ON ENEMY]`
 * line says with `CC_STILL_ON_AT_ROUND_END`. */
export const SYNC_LOCK_ENDED_BY_ROUND_END = "the round's end";
/** What a `readyCds` entry of a missed-sync-window row says of a cooldown
 * the log owner holds — `The Hunt (yours)`. */
export const SYNC_READY_CD_YOURS = "yours";
const SYNC_READY_CD_ENTRY = new RegExp(
  String.raw`^(.+) \((?:(${SYNC_READY_CD_YOURS})|(.+)'s)\)$`,
);

/**
 * One `readyCds` entry of a missed-sync-window row: the cooldown and whose it
 * is (L04, user ruling 2026-10-11) — `The Hunt (yours)` for the log owner's,
 * `The Hunt (Name-Realm's)` for a teammate's, the unit name every candidate
 * row and the loadout's `<unit name=…>` use. The holder is the unit whose
 * ledger `evaluateSyncWindow` read the cooldown from (`SyncWindowCd.owner`);
 * a cooldown with no holder unit (a hand-built fixture) stays a bare name.
 *
 * Before, the row listed names alone and its legend said they "may still be
 * teammates'": on the 605-file capture 441 of 726 rows name no cooldown the
 * owner's own kit lists (272 of them a lock the owner did not cast either).
 * The gate (`checkSyncWindowReadyCdHolders`) parses the entry back with
 * `parseSyncReadyCdEntry`.
 */
export function syncReadyCdEntry(
  spellName: string,
  holderName: string | undefined,
  isOwner: boolean,
): string {
  if (isOwner) return `${spellName} (${SYNC_READY_CD_YOURS})`;
  return holderName ? `${spellName} (${holderName}'s)` : spellName;
}

/** `syncReadyCdEntry` read back: the cooldown, and its holder — `yours`, a
 * unit name, or neither (`holder` null) for an entry that states none. */
export function parseSyncReadyCdEntry(entry: string): {
  spell: string;
  yours: boolean;
  holder: string | null;
} {
  const m = entry.match(SYNC_READY_CD_ENTRY);
  if (!m) return { spell: entry, yours: false, holder: null };
  return m[2] !== undefined
    ? { spell: m[1]!, yours: true, holder: null }
    : { spell: m[1]!, yours: false, holder: m[3]! };
}

/**
 * L04 (c) (user ruling 2026-10-11): in Solo Shuffle a missed-sync-window row
 * reaches the log owner's menu only when part of it is the owner's
 * (`syncRowHasOwnerPart`) — "telling a player that a random teammate did not
 * press has nothing actionable"; a fixed 2v2 / 3v3 team keeps every row. The
 * bracket is the row's own `cellKey` (`lookupSyncWindowPrior` keys the
 * reference on `startInfo.bracket` and returns it as `cellKey`), so the gate
 * (`checkSyncWindowOwnerPart`) asks the same question of the rendered row.
 */
export function syncRowNarrowedToOwnerPart(
  cellKey: string | undefined,
): boolean {
  return cellKey === SOLO_SHUFFLE_BRACKET;
}

/**
 * Is part of this missed-sync-window row the log owner's — one of its ready
 * cooldowns (`X (yours)`, `syncReadyCdEntry`) or the lock (`setupBy`: the
 * owner cast it, or a control of its chain)? A yes/no on two facts the row
 * carries, no threshold. A later lock folded into the row (`alsoHeldAt`) is
 * not asked about: `setupBy` is about the row's own lock.
 */
export function syncRowHasOwnerPart(facts: {
  readyCds?: string;
  setupBy?: string;
}): boolean {
  return (
    !!facts.setupBy ||
    (facts.readyCds ?? "")
      .split("、")
      .some((entry) => parseSyncReadyCdEntry(entry).yours)
  );
}

/**
 * The numbers a missed-sync-window row states about its lock's length
 * (F06a). `durationS` is the lock's length through the control lines' own
 * formatter (`renderedCcDuration`: rounded to the whole second, `<1` under
 * half a second) — for a one-control lock the very number its
 * `[CC ON ENEMY]` line prints; `windowEndT` is the timeline second it ended
 * in. Both stop at the round's end: the `[CC ON ENEMY]` line of a lock the
 * round ended on is cut there (`stillOnAtRoundEnd`), and the row read
 * `windowEndT=188, durationS=5` for a Kidney Shot the round ended 1 s into.
 *
 * `durationS` was `windowEndT − t`, the floored endpoints' difference: one
 * off the control line's number in 32 of 452 one-control pairs of the
 * 605-file capture (a 4.4 s Hammer of Justice from x.9 to y.3 read 5 here and
 * `(4s)` there), and 2–6 s over it in 16 of the 19 pairs the round's end cut.
 */
export function syncLockLengthFacts(
  w: { fromSeconds: number; toSeconds: number },
  roundEndS: number | undefined,
): {
  /** the lock's end, cut at the round's end */
  endSeconds: number;
  cutByRoundEnd: boolean;
  windowEndT: string;
  durationS: string;
} {
  const cutByRoundEnd = roundEndS !== undefined && w.toSeconds > roundEndS;
  const endSeconds = cutByRoundEnd
    ? Math.max(w.fromSeconds, roundEndS)
    : w.toSeconds;
  return {
    endSeconds,
    cutByRoundEnd,
    windowEndT: String(toRenderSecond(endSeconds)),
    durationS: renderedCcDuration({
      durationSeconds: endSeconds - w.fromSeconds,
    }).replace(/s$/, ""),
  };
}
export function missedSyncWindowEvents(
  ccWindows: Pick<
    IEnemyHealerCcWindow,
    | "fromSeconds"
    | "toSeconds"
    | "spellName"
    | "spellId"
    | "healerName"
    | "casterName"
    | "drLevel"
    | "endedBy"
  >[],
  offensiveCds: SyncWindowCd[],
  probes: {
    /** Wired to `lowestHpTroughInEventSpan` (utils/cooldowns.ts) over the
     * enemy team in production — the lowest HP inside the lock's own span,
     * the reading its [CONSEQ] line prints. Accelerator-only, see the B8
     * doc comment above — must NEVER gate the candidate. */
    enemyMinHpPctAt: (fromSeconds: number, toSeconds: number) => number | null;
    /** Whose reading `enemyMinHpPctAt` returned;
     * optional — absent, the unit fact is omitted. Facts only (F-S7). */
    enemyMinHpUnitAt?: (
      fromSeconds: number,
      toSeconds: number,
    ) => string | null;
    /** seconds (match-relative) of every enemy deathRecord. */
    enemyDeathS: number[];
    /** the log owner's unit id — an `endedBy` breaker that is the owner
     * reads "you", and a ready cooldown the owner holds reads `(yours)`
     * (`syncReadyCdEntry`); optional (absent, both are named). With it, a
     * Solo Shuffle round's rows are narrowed to the owner's part (L04 (c),
     * `syncRowNarrowedToOwnerPart`) — pass `ownerName` too, or a lock the
     * owner cast is not known as theirs. */
    ownerId?: string;
    /** the log owner's name as the CC applications carry it (`casterName`)
     * — with it, a lock the owner cast (part of) carries `setupBy` (B11b).
     * Facts only. */
    ownerName?: string;
    /** the last playable second (`playableEndMs`): a later lock, or a press
     * after it, never reaches `enteredNextLock`. Absent ⇒ no cut. */
    playableEndS?: number;
    /** the round's end in match seconds (`roundEndMs` — what the
     * `[CC ON ENEMY]` lines are cut at): the row's `windowEndT`,
     * `durationS` and HP reading stop there (F06a), and so does the lock
     * the eligibility test and the ranking read — a lock that began at or
     * after it is not in the round, one the round ended on counts for its
     * in-round part. Whether a cooldown ENTERED the lock is still read on
     * the lock as logged. Absent ⇒ no cut. */
    roundEndS?: number;
    /** The owner's refused presses (SPELL_CAST_FAILED, the recorder's own
     *  rows) of these spells in [fromS, toS] — work order 2026-10-14b
     *  fix 13. Facts only; absent ⇒ the fact is omitted. */
    ownerRefusedAt?: (
      spellIds: readonly string[],
      fromS: number,
      toS: number,
    ) => Array<{ spellName: string; tS: number; why: string }>;
    /** The bracket's reference cell, or null when the bracket has no cell,
     * misses the n floor, or fails the min-contrast door — null silences
     * the type for the whole round (the resurrection's bracket gate). */
    ref: SyncWindowPriorRef | null;
  },
  // Calibration-only override, same rationale as cdHoardedEvents' — defaults
  // to the module constant, production call sites unaffected.
  overrides?: { cap?: number },
): CandidateEvent[] {
  const cap = overrides?.cap ?? MISSED_SYNC_WINDOW_CAP;
  const ref = probes.ref;
  if (ref === null || !syncRefClearsMinContrast(ref)) return [];
  // L04 (c): a Solo Shuffle owner gets the rows part of which is theirs.
  // With no owner in the question (the calibration counts) nothing is cut.
  const ownerPartOnly =
    probes.ownerId !== undefined && syncRowNarrowedToOwnerPart(ref.cellKey);
  const merged = mergeHealerCcWindows(ccWindows);
  const candidates: Array<{
    w: (typeof merged)[number];
    ready: string[];
    readyCds: SyncWindowCd[];
    minHp: number | null;
    minHpUnit: string | null;
    /** later locks the same ready CDs were still held through */
    alsoHeld: number[];
    /** …and those locks themselves */
    alsoHeldWins: Array<(typeof merged)[number]>;
  }> = [];
  // One accusation per held CD (round 3 W1a, 24b6: Freezing Trap broken
  // 108.149, Cyclone 110.635 — two accusations against one held Volley).
  // A lock whose every ready CD was already accused in an earlier lock and
  // not pressed since is the same hold, not a new one.
  // Measured on the 605-file slice (2026-09-26): the same hold recurs 0–88 s
  // later (median ~20 s), so the later locks are not dropped silently — the
  // accusation lists them (facts.alsoHeldAt).
  const accused = new Map<
    SyncWindowCd,
    { end: number; cand: (typeof candidates)[number] }
  >();
  // F06a: the lock up to the round's end. A Solo Shuffle round ends at its
  // first player death — a FRIENDLY one leaves `enemyDeathS` empty, and a
  // Kidney Shot that landed 1 s before it was a 5 s "missed sync window"
  // (`syncLockLengthFacts`' rows: `durationS=<1, endedBy=the round's end`).
  const inRound = (w: (typeof merged)[number]) =>
    probes.roundEndS === undefined
      ? w
      : { ...w, toSeconds: Math.min(w.toSeconds, probes.roundEndS) };
  for (const w of merged) {
    if (probes.roundEndS !== undefined && w.fromSeconds >= probes.roundEndS)
      continue;
    if (!syncWindowEligible(inRound(w), probes.enemyDeathS)) continue;
    // readiness is read on the lock up to the round's end (codex
    // 60-POSTHOC-04b #1: a Cyclone running 0.6 s past a Shuffle round's
    // ending death read `readyCds=The Hunt`, the log's tail counted) — the
    // cd-hoarded owner gate's clip; whether the burst was entered is read on
    // the whole lock, as before
    const evAll = evaluateSyncWindow(w, offensiveCds);
    const ev = {
      ...evAll,
      ready:
        probes.roundEndS !== undefined && w.toSeconds > probes.roundEndS
          ? evaluateSyncWindow(inRound(w), offensiveCds).ready
          : evAll.ready,
    };
    const ready = ev.ready.map((cd) => cd.spellName);
    if (ready.length === 0) continue;
    if (ev.entered) continue;
    // the SAME hold: exactly the accused candidate's ready set, none of it
    // pressed since (agy review of batch 11 — a subset or a mix of two
    // earlier accusations folded in and claimed a spent CD was still held)
    const firstCand = accused.get(ev.ready[0]!)?.cand;
    const sameHold =
      firstCand !== undefined &&
      firstCand.ready.length === ev.ready.length &&
      ev.ready.every((cd) => {
        const prev = accused.get(cd);
        return (
          prev !== undefined &&
          prev.cand === firstCand &&
          !cd.casts.some(
            (c) => c.timeSeconds > prev.end && c.timeSeconds < w.fromSeconds,
          )
        );
      });
    if (sameHold) {
      firstCand!.alsoHeld.push(toRenderSecond(w.fromSeconds));
      firstCand!.alsoHeldWins.push(w);
      for (const cd of ev.ready)
        accused.set(cd, { end: w.toSeconds, cand: accused.get(cd)!.cand });
      continue;
    }
    // F06a: the readings stop where the row's own `windowEndT` does
    const factsEndS = syncLockLengthFacts(w, probes.roundEndS).endSeconds;
    const cand = {
      w,
      ready,
      readyCds: ev.ready,
      // B8: this value only ever feeds `facts` below — it is read AFTER the
      // ready/castDuring gates above have already decided emission.
      minHp: probes.enemyMinHpPctAt(w.fromSeconds, factsEndS),
      minHpUnit: probes.enemyMinHpUnitAt?.(w.fromSeconds, factsEndS) ?? null,
      alsoHeld: [] as number[],
      alsoHeldWins: [],
    };
    candidates.push(cand);
    for (const cd of ev.ready) accused.set(cd, { end: w.toSeconds, cand });
  }
  return (
    candidates
      .sort(
        (a, b) =>
          renderedWindowSeconds(b.w.fromSeconds, inRound(b.w).toSeconds) -
          renderedWindowSeconds(a.w.fromSeconds, inRound(a.w).toSeconds),
      )
      .slice(0, cap)
      .map(({ w, readyCds, minHp, minHpUnit, alsoHeld, alsoHeldWins }) => {
        const t = toRenderSecond(w.fromSeconds);
        const length = syncLockLengthFacts(w, probes.roundEndS);
        const timing = syncReadyTimingFacts(w, readyCds);
        // B2-① (user ruling 2026-10-06; facts only — the verdict and the
        // reference numbers are unchanged): a ready CD whose FIRST press after
        // this lock entered the NEXT lock on an enemy healer, by the verdict's
        // own `castEntersWindow`. fe1a9355 @94: Kingsbane, unpressed through
        // the Seduction, went into the Kidney Shot→Fear lock that followed.
        const afterEnd = (s: number) =>
          probes.playableEndS !== undefined && s > probes.playableEndS;
        const next = merged.find((n) => n.fromSeconds > w.toSeconds);
        const enteredNext =
          next && !afterEnd(next.fromSeconds)
            ? readyCds.flatMap((cd) => {
                const first = cd.casts
                  .filter((c) => c.timeSeconds > w.toSeconds)
                  .sort((a, b) => a.timeSeconds - b.timeSeconds)[0];
                if (!first || afterEnd(first.timeSeconds)) return [];
                if (!castEntersWindow(cd, first, next)) return [];
                return [
                  `${cd.spellName} at ${toRenderSecond(first.timeSeconds)} in the ${toRenderSecond(next.fromSeconds)}–${toRenderSecond(next.toSeconds)} lock (${next.spellName})`,
                ];
              })
            : [];
        // B11b (user ruling 2026-10-06): whose control the lock was. Only the
        // owner is named; a chain the owner cast part of names that part.
        const ownParts = probes.ownerName
          ? w.componentCasters.filter((c) => c.casterName === probes.ownerName)
          : [];
        // Work order 2026-10-14b fix 13 (facts only): (a) the owner's own
        // ready cooldowns pressed and refused inside this lock or a later
        // held one — 24b6a229: Volley refused "not ready" (the GCD) 1.2 s
        // into the 1:50 Cyclone, listed in alsoHeldAt as a plain hold; the
        // lock stays in alsoHeldAt. (b) the owner's own control on the same
        // healer right after the lock, not chained into it (chaining would
        // move the window) — 82a2d681: Blinding Sleet 0.54 s after the
        // Storm Bolt ended.
        const ownReadyIds = readyCds
          .filter(
            (cd) =>
              probes.ownerId !== undefined && cd.owner?.id === probes.ownerId,
          )
          .map((cd) => cd.spellId);
        const refusedInLock =
          probes.ownerRefusedAt && ownReadyIds.length
            ? [w, ...alsoHeldWins]
                .flatMap((l) => {
                  const groups = new Map<string, number[]>();
                  for (const r of probes.ownerRefusedAt!(
                    ownReadyIds,
                    l.fromSeconds,
                    Math.min(l.toSeconds, probes.roundEndS ?? Infinity),
                  )) {
                    const k = `${r.spellName}\u0000${r.why}`;
                    groups.set(k, [
                      ...(groups.get(k) ?? []),
                      r.tS - l.fromSeconds,
                    ]);
                  }
                  return [...groups].map(([k, offs]) => {
                    const [spell, why] = k.split("\u0000");
                    const n = offs.length > 1 ? `×${offs.length}` : "";
                    const at = offs
                      .map(
                        (o) =>
                          `+${(Math.floor(o * 10 + 1e-9) / 10).toFixed(1)}`,
                      )
                      .join("/");
                    return `${toRenderSecond(l.fromSeconds)}: ${spell}${n} ${at}s (${why})`;
                  });
                })
                .join("; ")
            : "";
        const followUp = probes.ownerName
          ? merged.find(
              (n) =>
                n.healerName === w.healerName &&
                n.fromSeconds > w.toSeconds &&
                n.fromSeconds - w.toSeconds <= SYNC_ENTER_LEAD_S &&
                n.componentCasters.length > 0 &&
                n.componentCasters.every(
                  (c) => c.casterName === probes.ownerName,
                ),
            )
          : undefined;
        const setupBy =
          ownParts.length === 0
            ? ""
            : ownParts.length === w.componentCasters.length
              ? "you"
              : `you (${[...new Set(ownParts.map((c) => c.spellName))].join("、")})`;
        return {
          // spellId disambiguates two CC windows on the same healer that floor
          // to the same rendered second (review fix round 2, 2026-08-15) — the
          // menu id is the eventIds reference key, so a collision here corrupts
          // adoption attribution, not just cosmetics.
          id: `missed-sync-window:${w.healerName}:${w.spellId}:${t}`,
          type: "missed-sync-window",
          t,
          unitNames: [w.healerName],
          spell: w.spellName,
          spellId: w.spellId,
          facts: {
            t: String(t),
            windowEndT: length.windowEndT,
            healer: w.healerName,
            cc: w.spellName,
            dr: w.drLevel ?? "Full",
            // F06a: the control lines' formatter, not the floored endpoints'
            // difference (`syncLockLengthFacts`) — the gate pairs it with the
            // `[CC ON ENEMY]` line (`checkSyncWindowLockLength`).
            durationS: length.durationS,
            // L04: each entry says whose cooldown it is (`syncReadyCdEntry`)
            readyCds: readyCds
              .map((cd) =>
                syncReadyCdEntry(
                  cd.spellName,
                  cd.owner?.name,
                  probes.ownerId !== undefined &&
                    cd.owner?.id === probes.ownerId,
                ),
              )
              .join("、"),
            ...(minHp !== null ? { enemyMinHpPct: fmt(minHp) } : {}),
            ...(minHp !== null && minHpUnit
              ? { enemyMinHpUnit: minHpUnit }
              : {}),
            ...timing,
            // the same held CDs through later healer locks (rendered seconds,
            // "、"-joined — a ", " would cut the facts value)
            ...(alsoHeld.length ? { alsoHeldAt: alsoHeld.join("、") } : {}),
            // sync-burst F-S3: what ended the lock, only when the log says —
            // a lock your own team's damage cut short is its own lesson. A
            // lock the round ended on was ended by nothing logged after it.
            ...(length.cutByRoundEnd
              ? { endedBy: SYNC_LOCK_ENDED_BY_ROUND_END }
              : w.endedBy
                ? { endedBy: formatCcRemovalCause(w.endedBy, probes.ownerId) }
                : {}),
            ...(enteredNext.length
              ? { enteredNextLock: enteredNext.join("; ") }
              : {}),
            ...(setupBy ? { setupBy } : {}),
            ...(refusedInLock ? { refusedInLock } : {}),
            ...(followUp
              ? {
                  ownerFollowUpCc: `${followUp.spellName} +${(Math.floor((followUp.fromSeconds - w.toSeconds) * 10 + 1e-9) / 10).toFixed(1)}s (${syncLockLengthFacts(followUp, probes.roundEndS).durationS}s)`,
                }
              : {}),
            // Corpus reference (syncWindowPrior.ts) — the gate
            // (checkSyncWindowRefConsistency) redoes the lookup from cellKey
            // and re-checks every one of these numbers plus the door.
            refN: String(ref.nEntered + ref.nUnentered),
            refKillEntered: String(ref.killEnteredPct),
            refKillUnentered: String(ref.killUnenteredPct),
            cellKey: ref.cellKey,
          },
        };
      })
      // L04 (c): AFTER the cap — a row that goes frees no slot, so no shorter
      // lock of the round moves up into the menu in its place.
      .filter((e) => !ownerPartOnly || syncRowHasOwnerPart(e.facts))
  );
}

/** Per-match cap for unsynced-burst. <标定定稿 2026-08-15,报告
 * p1p2-calibration.md>: confirmed at 2, unchanged — same full-corpus scan as
 * `MISSED_SYNC_WINDOW_CAP` above, this type's own definition equally fixed
 * before Task 5 (no HP gate, complements `unconverted-burst` deliberately).
 * 场均条数(capped) 1.17 (raw pre-cap 1.98), inside the 0.5–2 band; 发生率
 * 69.5%, same "already-locked definition, not a Task 5 lever" caveat as
 * MISSED_SYNC_WINDOW_CAP's doc comment. 双向误差注: same shape as that
 * constant's — a lower cap drops real independent unsynced presses from an
 * already-firing round; a higher cap lets one round's raw ~2 average
 * dominate the menu further. */
const UNSYNCED_BURST_CAP = 2; // <标定定稿 2026-08-15,报告 p1p2-calibration.md>;at-cap 体检 2026-08-26:223/393(57%)—— 承重,ba31cd05 摘 105 条净减 66 即此 cap 回填所致

/**
 * unsynced-burst (P1 起爆-2, 2026-08-15, user-ruled definition): a friendly
 * offensive major cooldown was cast whose effect window contained ZERO hard
 * CC on the enemy healer — the burst went out with the enemy healer free to
 * answer it. Complements the existing `unconverted-burst` (an OUTCOME fact:
 * the target didn't die) — this type is CAUSE-level (no sync happened at
 * all) and is deliberately NOT deduped against it: the same cast can produce
 * both candidates (their `id`s/eventIds are independent) because "didn't
 * convert" and "wasn't synced" are two different coaching facts about the
 * same button press.
 *
 * Effect window: `burstCastSpan` — the exact predicate the burst ledger
 * already uses for "how long is this CD's effect active", built from
 * `spellEffectData[spellId].durationSeconds`. Since 2026-10-01 (ruling A14)
 * there is no 10 s fallback: a CD whose buff duration is unknown / instant
 * has a zero-length window.
 *
 * Severity/cap: sorted by the cooldown's own length (`cooldownSeconds`
 * descending) — the biggest-cooldown CDs are the highest-value presses to
 * burn unsynced (a 30s CD misfiring is routine; a 3-minute CD misfiring is
 * not), ties broken chronologically (stable sort). Capped per the constant's
 * doc comment above.
 *
 * `healerNames` (§29b fix, 2026-08-15): the "no hard CC overlapped this
 * cast" gate below reads `ccWindows`, which `enemyHealerCcWindows` already
 * pools across EVERY enemy healer (its `Pick<..., "fromSeconds" |
 * "toSeconds">` signature drops which healer each window belongs to on
 * purpose — this function only ever asks "was ANY enemy healer locked
 * during this span"). A pass (no window overlaps) therefore proves ALL
 * enemy healers were free, not just one — so the fact must name the full
 * set, not `enemies.find(...)`'s first match. Before this fix the wiring
 * call site passed only the first enemy healer's name, which in a
 * dual-healer comp could point at a healer who was never the one actually
 * free to answer (or omit a second healer who also was) — see BACKLOG
 * §29(b). `healerNames.length === 0` (no enemy healer on the roster) still
 * returns [] — same "no object to talk sync about" rationale the previous
 * single-name null check had.
 */
export function unsyncedBurstEvents(
  casts: Array<{
    ownerName: string;
    spellId: string;
    spellName: string;
    castTimeSeconds: number;
    cooldownSeconds: number;
  }>,
  ccWindows: Pick<IEnemyHealerCcWindow, "fromSeconds" | "toSeconds">[],
  healerNames: string[],
  /** Feasibility gate (2026-08-22 corpus adjudication): did the TEAM have any
   * hard CC off cooldown when this cooldown went out? The advice is "line the
   * cooldown up with CC on their healer next time", which is not advice if the
   * CC was down — you cannot spend a resource you do not have. */
  teamCcReadyAt: (tSeconds: number) => boolean,
  // Calibration-only override, same rationale as cdHoardedEvents' — defaults
  // to the module constant, production call sites unaffected.
  overrides?: { cap?: number },
): CandidateEvent[] {
  if (healerNames.length === 0) return [];
  const cap = overrides?.cap ?? UNSYNCED_BURST_CAP;
  const candidates: Array<{
    cast: (typeof casts)[number];
    windowEndT: number;
  }> = [];
  for (const cast of casts) {
    const span = burstCastSpan({
      castTimeSeconds: cast.castTimeSeconds,
      // 单一谓词(2026-09-06):`casts` 是队伍的进攻施放清单,不带单位,
      // 所以拿不到施法者;传 undefined 与原先直读同值。
      buffEndSeconds:
        cast.castTimeSeconds +
        (buffFullDurationForCaster(cast.spellId, undefined) ?? 0),
    });
    // 2026-08-23 用户裁定「重复吧」:这条指控印的是「**你的**爆发 CD 出去时对面
    // 治疗没被控」,而一个**给出去的** buff 不是施法者自己的爆发 —— 能量灌注是牧师
    // 按在法师身上让**法师**爆发的,法师那一下已经被单独指控过一次,把它同时记在
    // 牧师头上就是同一次爆发数两遍。实测(S2 归档 120 文件、治疗视角 375 条指控):
    // 能量灌注 66 条,其中与另一条 ±3s 同窗的 8 条。
    // 同一把尺子顺带兜住三个**根本不是爆发**的:黑暗 196718(40% 团减)、猛虎之志
    // 116841(给队友的解控/加速)、恢复萨的升腾 114052 —— 它们只是被打了 Offensive
    // 牌子才混进 teamOffensiveCds,「你的黑暗没和控制对齐」不是一句能成立的话。
    // 元素/增强萨的升腾(114050/114051)不够得着队友,照旧留在指控范围内。
    if (reachesAlly(cast.spellId)) continue;
    const hasHardCc = ccWindows.some(
      (w) => w.fromSeconds < span.to && w.toSeconds > span.from,
    );
    if (hasHardCc) continue;
    // 2026-08-22, ~278 sampled instances of the 12.1 archive: in **0%** of them
    // had the team failed to CC the enemy healer at all that round — every
    // accused team did sync elsewhere (median 13-18s away), so "you don't line
    // burst up with CC" was never the actual failure. The type fired on 66-70%
    // of all offensive cooldowns with a flat skill gradient (-0.1pp), i.e. it
    // was describing normal play: CC and burst cooldowns run independently and
    // cannot always overlap. Only accuse when a hard CC was actually ready.
    if (!teamCcReadyAt(cast.castTimeSeconds)) continue;
    candidates.push({ cast, windowEndT: toRenderSecond(span.to) });
  }
  return candidates
    .sort(
      (a, b) =>
        b.cast.cooldownSeconds - a.cast.cooldownSeconds ||
        a.cast.castTimeSeconds - b.cast.castTimeSeconds,
    )
    .slice(0, cap)
    .map(({ cast, windowEndT }) => {
      const t = toRenderSecond(cast.castTimeSeconds);
      return {
        id: `unsynced-burst:${cast.ownerName}:${cast.spellId}:${t}`,
        type: "unsynced-burst",
        t,
        unitNames: [cast.ownerName, ...healerNames],
        spell: cast.spellName,
        spellId: cast.spellId,
        facts: {
          t: String(t),
          windowEndT: String(windowEndT),
          owner: cast.ownerName,
          spell: cast.spellName,
          // §29b fix: the gate proves ALL enemy healers were free (see the
          // function doc comment), so the fact names the full set — same
          // "、"-joined convention missedSyncWindowEvents' readyCds uses,
          // not an arbitrary first match.
          healer: healerNames.join("、"),
        },
      };
    });
}

/** cd-hoarded: the own-team HP floor a hoarded window's worst moment must
 * have crossed to count as a "crisis" happened during the hoard, not just
 * "someone took a scratch". Deliberately a separate number/constant from
 * `CD_WASTE_PRESSURE_HP_PCT` — that gate asks "was the WHOLE ROUND
 * pressured", this one asks "was THIS SPECIFIC hoarded window a crisis" —
 * same shape as the cd-waste/cd-hoarded split documented on
 * `THREAT_LEVEL_LOW_MIN_HP_PCT` in threatAssessment.ts. <标定定稿 2026-08-15,
 * 报告 p1p2-calibration.md>: lowered from the 45% placeholder to 35%.
 * 双向误差注: a higher bar (45%, the placeholder) admits moderate-pressure
 * dips that are not really a "crisis"; a bar below 35% (untested) would
 * start excluding real near-death windows that bottomed out in the
 * high-20s/low-30s rather than under 35.
 *
 * NOT cd-hoarded's own gate any more (2026-08-30, GH #34 decision-point
 * rewrite): `cdHoardedEvents` below now keys its crisis moment on
 * `crisisDecisionPoints`' own `CRISIS_HP_PCT` (40%, crisisDecisionPoints.ts)
 * — the same predicate `crisis-no-response` uses, so "was there a crisis"
 * is one shared fact instead of two competing HP floors. This constant is
 * kept, exported, and UNCHANGED for its one remaining consumer:
 * `mdCycloneWindowEvents` (candidates/massDispel.ts), which still gates on
 * `friendlyCrisisMomentInWindow` + this 35% floor for its own, unrelated
 * four-gate criterion (GH #25). Do not fold the two back together — they
 * are independently calibrated for different candidate types that happen to
 * share a number by coincidence, not by predicate. */
export const CD_HOARD_CRISIS_HP_PCT = 35; // <标定定稿 2026-08-15,报告 p1p2-calibration.md>; consumer since 2026-08-30 is md-cyclone-window only

/** Per-match cap for cd-hoarded. Carried forward from the retired
 * window-shaped predicate's <标定定稿 2026-08-15,报告 p1p2-calibration.md>
 * (kept at 2 to match every other per-round-capped type in this file) — the
 * 2026-08-30 decision-point rewrite (GH #34) changes WHAT fires, not the
 * shipping cap, and has not itself been re-swept against a fresh corpus
 * (docs/BACKLOG.md #34 tracks that follow-up). at-cap 体检 2026-08-26
 * (pre-rewrite): 302/482 有产出回合打到上限(63%)。 */
const CD_HOARD_CAP = 2;

/** cd-hoarded's own "was the ready cooldown actually pressed" window
 * (2026-08-30 decision-point rewrite, GH #34; 3,000-match outcome probe
 * "cd-hoarded", eval-private/reports/signal-outcomes-2026-08-30/report.md):
 * a press landing up to `RESPONSE_PRE_MS` (crisisDecisionPoints.ts, the same
 * "a response landed just before the sampled crossing still counts"
 * convention) BEFORE the crossing still counts as answering it, through
 * this many seconds AFTER. This is cd-hoarded's own, corpus-measured number
 * — deliberately not crisisDecisionPoints' 3s `RESPONSE_WINDOW_MS` (a
 * different question: "did the crisis unit do ANYTHING" vs. "did the OWNER
 * spend THIS specific ready cooldown"). */
export const CD_HOARD_RESPONSE_S = 5;
/** How far before the crisis reading an offensive press of the player's own
 *  still counts as "just pressed" for `facts.ownBurstPressed` (B2-②, user
 *  ruling 2026-10-06: "within 2 s before the crisis"). */
export const OWN_BURST_LEAD_S = 2;

/**
 * The schools a save covers: its signed `MITIGATION_TABLE` row's mask, else —
 * for an absorb with no percentage row — the DB2 absorb school mask (aura 69
 * MiscValue_0, `abilityEffectsGenerated.absorbSchoolMask`). Anti-Magic Shell
 * 48707 / 410358 = 0x7e, magic only (triage F-H20, user ruling 2026-09-30:
 * read the DB2 mask, no hand-signed percentage). Undefined = no school claim.
 */
export function saveSchoolMask(spellId: string): number | undefined {
  return (
    MITIGATION_TABLE[spellId]?.schoolMask ??
    ABILITY_EFFECTS_GENERATED[spellId]?.absorbSchoolMask
  );
}

/**
 * A school-limited save (`saveSchoolMask` is not all schools) is a relevant
 * "ready" save for a crisis only when it covers at
 * least this share of the crisis's 2 s of damage — a majority, so the save
 * named would have stopped most of what put the unit there. Editorial, not
 * measured; the audited misses sat far from it (Blessing of Protection vs
 * 22 % and 0 % physical, 06bb9860 / a5a8d31b).
 */
export const SCHOOL_SAVE_MIN_SHARE = 0.5;
const ALL_SCHOOLS = 0x7f;

export function coversCrisisSchool(
  spellId: string,
  point: Pick<DecisionPoint, "dmg2sBySchool">,
): boolean {
  const mask = saveSchoolMask(spellId);
  if (mask === undefined || (mask & ALL_SCHOOLS) === ALL_SCHOOLS) return true;
  const share = schoolShareCoveredBy(point, mask);
  return share === null || share >= SCHOOL_SAVE_MIN_SHARE;
}

/**
 * `coversCrisisSchool` at an arbitrary instant (B-tier B3a, user ruling
 * 2026-10-06: `cheaper available:` and `[DEATH] … Unused:` read cd-hoarded's
 * school rule): does this save cover at least `SCHOOL_SAVE_MIN_SHARE` of what
 * `unit` was being hit with in the `DMG_WINDOW_MS` up to `atMs` — the window
 * and the split a crisis point's `dmg2sBySchool` is built from
 * (`incomingPressureBySchool`, landed and absorbed, exclusive start). A save
 * with no school claim, an all-school one, and a window with no damage all
 * cover — the fail-open direction `coversCrisisSchool` has.
 */
export function saveCoversPressureOn(
  spellId: string,
  unit: Parameters<typeof incomingPressureBySchool>[0],
  atMs: number,
  round: { sides?: RosterSides; recordsAttackSpell?: boolean } = {},
): boolean {
  const mask = saveSchoolMask(spellId);
  if (mask === undefined || (mask & ALL_SCHOOLS) === ALL_SCHOOLS) return true;
  return coversCrisisSchool(spellId, {
    dmg2sBySchool: incomingPressureBySchool(
      unit,
      atMs - DMG_WINDOW_MS,
      atMs,
      round.sides,
      round.recordsAttackSpell,
      true,
    ),
  });
}

/**
 * Corpus-derived outcome reference for cd-hoarded (2026-08-30, GH #34;
 * re-run 2026-10-08 and 2026-10-13 in the GH #115 batched regens):
 * 3,000-match outcome probe "cd-hoarded" (`signalOutcomeProbe.ts --only
 * cd-hoarded`, the first 3,000 files of manifest-archive-2026-08-28-newseason;
 * report eval-private/runs/regen-115-2026-10-13/cd-hoarded-ref/report.md;
 * first run: eval-private/reports/signal-outcomes-2026-08-30/report.md). Decision
 * point = every friendly crisis (`crisisDecisionPoints` on the owner for
 * their own crises, and on each teammate as owner for theirs; HP crossed
 * <=40%, 5s merge — `CRISIS_HP_PCT`/`CRISIS_WINDOW_GAP_MS`,
 * crisisDecisionPoints.ts) at which the owner had >=1 usable major
 * Defensive cooldown ready (a personal wall or a self-castable external for
 * the owner's own crisis; any cooldown `canHelpAnotherUnit` says can reach
 * the crisis unit for a teammate's). Across 15,653 such decision points,
 * the crisis unit died within 10s **5.8%** of the time when a ready
 * cooldown was spent within `CD_HOARD_RESPONSE_S` vs **13.0%** when every
 * ready cooldown was held (share acted 27%; 2v2 7.0% vs 16.7%; Solo Shuffle
 * 5.3% vs 11.6%; own-crisis 6.9% vs 19.7%; teammate-crisis 5.5% vs 11.8%).
 * The 2026-08-30 run (16,960 points: 4.5% vs 11.4%) recorded only "3,000
 * matches"; its 2v2 / Solo Shuffle point counts (4,485 / 11,943) are close
 * to this slice's (4,359 / 11,274) but not equal, and its 3v3 count (532) is
 * far off (23 here — the slice holds 6 3v3 files), so the slice is a best
 * reconstruction, not proven to be the same input.
 *
 * Descriptive, never causal — the legend (buildFindingsPrompt.ts) says so
 * explicitly and the reference does not identify WHICH cooldown mattered.
 * Corpus-derived, not typed in from intuition; a table-based refresh (the
 * same shape as `data/behaviorPriorGenerated.json`) is the follow-up, not
 * yet built — until then this is a fixed constant block, not a per-cell
 * lookup keyed on bracket/role/damage the way that table is.
 *
 * The re-run is on the current partition: reliability audit A2's spent /
 * abstain changes (2026-09-24), triage F-W6's spec-baseline defensives in
 * the ledger (2026-10-06), and every crisis-point change since (dmg2s window
 * e0012b99, damage = amount − overkill b999ce1c) — pinned code 859883a6.
 * The 2026-10-13 re-run (pinned code d511b212, after the ledger gained the
 * buttons a talent grants under another id and the owner-feasibility
 * changes of 2026-10-11) moved the point count 15,645 → 15,656 and no
 * printed rate, overall or per slice. The 2026-10-20 re-run (code cc8b22e8c,
 * after the fact1215 fixes) moved it 15,656 → 15,653 and no printed rate;
 * four per-slice rates moved by 0.1 pp (2v2 and own-crisis, both sides).
 */
export const CD_HOARDED_OUTCOME_REF = {
  refDeathSpent: "5.8",
  refDeathHeld: "13.0",
  refN: "15653",
} as const;

/** One crisis-decision-point SOURCE cd-hoarded scans: the unit in crisis
 * (the owner or a named teammate), whether it is the OWNER's own crisis,
 * and that unit's full (UNFILTERED) `crisisDecisionPoints` output —
 * `cdHoardedEvents` applies its own `dangerous && !inCC` filter itself (see
 * its doc comment for why not the fuller `feasible` flag: gate 4,
 * death-in-window, must NOT exclude a crisis unit who died inside the
 * window — a crisis unit who died within the response window is exactly
 * the shape this type exists to catch). Only the seven fields the predicate
 * actually reads are required, not the whole `DecisionPoint` shape, so a
 * caller/test never has to hand-build the entire interface. */
export interface ICdHoardedCrisisSource {
  crisisUnit: { id: string; name: string };
  /** true when crisisUnit IS the cd-hoarded owner (their own crisis). */
  own: boolean;
  points: (Pick<
    DecisionPoint,
    | "tSec"
    | "hpPct"
    | "dmg2s"
    | "attackers2s"
    | "enemyBurst"
    | "inCC"
    | "dangerous"
  > &
    Partial<Pick<DecisionPoint, "responses" | "dmg2sBySchool">>)[];
  /** Reliability audit A2 (2026-09-24): the major defensives friendlies put
   * on the crisis unit (`majorWallIntervals`, the same record the
   * `[STACKED DEFENSIVES]` line reads). A wall up at the crossing, whoever
   * cast it, makes cd-hoarded ABSTAIN (never "responded", never "enough").
   * Absent = no abstention (the pre-2026-09-24 behaviour). */
  majorWalls?: {
    spellId: string;
    srcUnitName: string;
    fromS: number;
    toS: number;
  }[];
  /** the crisis unit's death instants (seconds since round start), for the
   * BACKLOG #43 proc exemption — a proc that fired while they still died
   * inside CD_HOARD_RESPONSE_S does not lift the accusation */
  deathSeconds?: number[];
}

/** The shape `cdHoardedEvents` needs from each of the owner's cooldowns —
 * `tag` required (the base gate hard-requires `=== "Defensive"`, unlike the
 * retired predicate's optional hint-only tag). */
type CdHoardCandidateCd = Pick<
  IMajorCooldownInfo,
  "spellId" | "spellName" | "casts" | "cooldownSeconds" | "neverUsed" | "tag"
> &
  Partial<
    Pick<IMajorCooldownInfo, "isThroughput" | "charges" | "responseOnly">
  >;

/** The shape `isSpendableDefensiveCd` / `readyDefensiveCds` read. Exported
 * so the cohort-prior engine (`analysis/cdTriggerPrior.ts`) can type its
 * input against the same pick rather than re-listing the fields. */
export type SpendableDefensiveCd = CdHoardCandidateCd;

/**
 * "Is this one of the owner's SAVE cooldowns at all" — the time-independent
 * half of `readyDefensiveCds`'s gate: Defensive-tagged, not a throughput CD,
 * and something the player can actually press (not a proc). Exported
 * (2026-09-04, GH #54 (f) / BACKLOG #38 (a)) so the `[CD PRIOR]` cohort
 * engine and its corpus scan count exactly the cooldowns `cd-hoarded` would
 * accuse over — one roster, both consumers (CLAUDE.md shared-predicate rule);
 * `readyDefensiveCds` below is now written through it.
 */
export function isSpendableDefensiveCd(
  cd: Pick<SpendableDefensiveCd, "spellId" | "tag" | "isThroughput"> & {
    isProcOnly?: boolean;
  },
): boolean {
  return cd.tag === "Defensive" && !cd.isThroughput && !cdIsProcOnly(cd);
}

/** Base "can this Defensive CD be pressed at all right now" gate — the part
 * of the readiness predicate that does NOT depend on whose crisis this is;
 * `helps` layers the own-crisis-vs-teammate-crisis distinction on top. */
function readyDefensiveCds(
  cds: CdHoardCandidateCd[],
  tSec: number,
  helps: (cd: CdHoardCandidateCd) => boolean,
): CdHoardCandidateCd[] {
  return cds.filter(
    (cd) => isSpendableDefensiveCd(cd) && cdAvailableAt(cd, tSec) && helps(cd),
  );
}

/**
 * The span cd-hoarded reads the OWNER's free time over, in seconds since the
 * round start: from the crisis's rendered second (`facts.t`, what
 * `facts.ownerCc` / `facts.ownerFreeS` are offsets from) to the end of the
 * response window. One definition for the owner gate and for the fact it
 * prints (I05, user ruling 2026-10-11): the gate needs REACTION_WINDOW_S of
 * free time inside it, `facts.ownerFreeS` is the free time inside it.
 * "Spent" keeps its own, wider window — a press up to `RESPONSE_PRE_MS`
 * before the crossing still answers it.
 */
export function ownerFreeSpan(tSec: number): { fromS: number; toS: number } {
  return { fromS: toRenderSecond(tSec), toS: tSec + CD_HOARD_RESPONSE_S };
}

/**
 * cd-hoarded (2026-08-30 rewrite, GH #34, decision-point shaped): "a
 * teammate (or you) hit a crisis while you had a usable major defensive CD
 * ready and you did not spend it within `CD_HOARD_RESPONSE_S`". Replaces
 * the retired `availableWindows`-shaped predicate ("a CD sat ready >=45s
 * while a friendly crossed <35%"), whose own intent-guard measurement found
 * 35.6% of its accusations wrong (the player DID press) — this version
 * anchors on the same `crisisDecisionPoints` moment `crisis-no-response`
 * already uses, so "was there a crisis" is one shared predicate instead of
 * a second HP-floor gate invented just for this type.
 *
 * Scope narrows on purpose versus the retired predicate: only
 * Defensive-tagged, non-throughput cooldowns count now (`readyDefensiveCds`'s
 * base gate) — the old version could cite ANY major CD, offensive or
 * defensive (Avenging Wrath was its own flagship example). The 3,000-match
 * outcome probe behind `CD_HOARDED_OUTCOME_REF` was run against this
 * narrower, Defensive-only shape, so widening back out would attach the
 * reference numbers to a candidate they were never measured against.
 *
 * `own` decides which help-gate applies at each source's points (GH #28's
 * lesson, carried into the rewrite): for the OWNER's own crisis, a
 * cooldown only counts if it is not a confirmed self-cast no-op
 * (`!SELF_CAST_NOOP_EXTERNAL_IDS.has`, e.g. Blessing of Sacrifice's
 * damage-redirect is a mechanical no-op when self-targeted) — the same
 * "does this help ME" predicate `findCheaperDefensiveAlternatives`
 * (cooldowns.ts) already uses in its own self-cast-context branch, reused
 * rather than re-derived from a curated membership list (a `bigDefensive
 * SpellIds`/`externalDefensiveSpellIds` membership check would silently
 * reject a real self-wall the two lists haven't caught up with yet — e.g.
 * Ultimate Penitence, a runtime-injected pure self-absorb that is in
 * NEITHER list; caught while writing `cdHoardedSelfOnly.test.ts`, see
 * CLAUDE.md's Curated-List Completeness Rule). For a TEAMMATE's crisis, a
 * cooldown only counts if `canHelpAnotherUnit` says it can reach somebody
 * other than the owner — the exact guard `cdHoardedSelfOnly.test.ts` exists
 * to pin (a self-only heal like Desperate Prayer can never answer a
 * teammate's crisis).
 *
 * "Spent" is a press of any of the owner's save cooldowns that can help
 * this crisis unit (`isSpendableDefensiveCd` + the same help gate), inside
 * `[tSec - RESPONSE_PRE_MS/1000, tSec + CD_HOARD_RESPONSE_S]` — a press
 * landing just before the sampled crossing still counts, the same convention
 * `crisisDecisionPoints`' own response window uses. Until 2026-09-24 the set
 * was "off cooldown at tSec", so a single-charge cooldown pressed in that
 * pre-window was already on cooldown at tSec and could never count
 * (a9bc48b5 @23: Ironbark on the crisis unit 0.9 s before the anchor was
 * accused as "held") — reliability audit A2.
 *
 * Severity/cap: sorted by the SAME danger order `crisisNoResponseEvents`
 * uses (enemyBurst, then attackers2s, then dmg2s — NEVER by outcome; this
 * function must not read `diedWithin10s`/`friendDiedWithin15s`, and
 * `ICdHoardedCrisisSource.points` is typed narrowly enough that it cannot),
 * capped at `CD_HOARD_CAP`, then re-sorted chronologically for display
 * (every sibling producer in `candidates/` reports in time order regardless
 * of how it selected the capped set — see `crisisNoResponseEvents`'s own
 * 2026-08-29 ruling).
 */
export function cdHoardedEvents(
  sources: ICdHoardedCrisisSource[],
  ownerCds: CdHoardCandidateCd[],
  owner: { id: string; name: string },
  overrides?: { cap?: number },
  /** Intent guard (BACKLOG #26 Task 2), unchanged in spirit from the
   * retired predicate: a CAST_FAILED hit on any READY cooldown inside the
   * same response window downgrades "hoarded" to "attempted but rejected"
   * (see `facts.attempted` and auditFindings.ts's matching severity
   * downgrade). */
  rawStreams?: RawStreams,
  /** #29 (2026-08-17): the owner's own successful-cast instants (seconds),
   * consumed only by `filterIntentGuardEvidence`'s gcd-locked exclusion —
   * same convention as every other guard-carrying builder in this file. */
  ownCastSuccessSeconds?: number[],
  /** Reliability round 2 W1a (2026-09-25): could the OWNER act at all during
   * `[fromS, toS]` (seconds since round start)? Built by the caller from
   * `buildCannotCastIntervals` + the owner's death — the same predicate
   * `evaluateSyncWindow` and cdTriggerPrior's opportunity set use. Asked over
   * `ownerFreeSpan` — from the crisis second on, the span `facts.ownerFreeS`
   * prints (I05, 2026-10-11). Absent ⇒ no owner gate (tests, callers without
   * a combat clock). */
  ownerCouldRespond?: (
    fromS: number,
    toS: number,
    /** asked for one cooldown: a lockout counts only on its school (FT-T10) */
    spellId?: string,
    /** the press would land on the owner (their own crisis) — with
     * `ownerActState`'s, what lets a school-limited purge count under a stun
     * (I05 c, `stunLetsPress`) */
    onSelf?: boolean,
  ) => boolean,
  /** User ruling 2026-09-26 (reliability leftovers item 3, fa5e): the crisis
   * counts as answered when the OWNER cast a control (a peel) or ANY friendly
   * pressed a team save (TEAM_HEAL_CD_IDS: Spirit Link, Barrier, Aura Mastery,
   * Revival …) inside the response window. Seconds since round start, built by
   * the caller; absent ⇒ presses of the owner's own save cooldowns only. */
  teamAnswers?: {
    ownerPeelCastSeconds: readonly number[];
    teamSaveCastSeconds: readonly number[];
    /** fact1215 R11: the owner's redirect-save presses for a unit
     * (`ownerRedirectSaveFor`) */
    ownerRedirectSaves?: (unitId: string) => readonly number[];
  },
  /** Triage 2026-09-29 H1: what the owner gate saw — `actWindowFor(...)
   * .stateIn` over the SAME inputs as `ownerCouldRespond`. The gate passes an
   * owner free for 1 s after the crisis second (ruling 2026-09-23/26; the
   * span since I05) even when CC'd for the rest; the facts then say so
   * (`ownerCc`, `ownerFreeS`) instead of the line reading "held". Absent ⇒
   * neither fact. */
  ownerActState?: (
    fromS: number,
    toS: number,
    anchorS: number,
    spellIds?: readonly string[],
    /** the press would land on the owner (their own crisis): what lets a
     * school-limited purge count under a stun (I05 c, `stunLetsPress`) */
    onSelf?: boolean,
  ) => ActWindowState | null,
  /** Triage 2026-09-29 F-H7 / F-H9 (user ruling 2026-09-30, R4 = B, R5 = B):
   * every friendly's own major-cooldown ledger. A save the crisis unit
   * pressed on itself (`crisisUnitSaved`) or another teammate pressed for it
   * (`teamAnswered`) inside the window is STATED, never counted as the
   * player's answer — the verdict is unchanged. Absent ⇒ neither fact. */
  teamLedgers?: ReadonlyArray<{
    unit: { id: string; name: string };
    cds: CdHoardCandidateCd[];
    /** Presses of this unit's saves the ledger does not carry — Alter
     *  Time's return, 342247 (work order 2026-10-14b fix 7: 138e632d's mage
     *  snapped back from 33 % to 68 % at +0.1 s and the row did not say so). */
    returns?: ReadonlyArray<{ atS: number; name: string }>;
    /** This unit's presses of the redirect saves (Roar of Sacrifice,
     *  Intervene …), on no ledger: when, what, and whom they went to
     *  (fact1215 R11, codex 20-F15-33). Stated, never credited, like the
     *  ledger saves. */
    redirects?: ReadonlyArray<{ atS: number; name: string; onUnitId: string }>;
    /** When the aura a press of `spellId` at `castS` put on this unit was
     *  broken (SPELL_AURA_BROKEN[_SPELL], seconds since round start), null
     *  when it was not (b12bfef4: a Greater Invisibility broken by a Moonfire
     *  0.54 s after the press read as a save that held). */
    brokenAtS?: (spellId: string, castS: number) => number | null;
  }>,
  /** Triage 2026-09-29 F-H6 (user ruling 2026-09-30, with res-readiness
   * R2 = A): could the owner pay this cooldown's mana at any sample in
   * [fromS, toS] (`affordableWithin`, the shared affordability predicate)?
   * `false` keeps it out of the ACCUSATION set; `null` (unknown) and an
   * absent callback do not gate. The response set is untouched. */
  ownerAffordable?: (
    spellId: string,
    fromS: number,
    toS: number,
  ) => boolean | null,
  /** Triage 2026-09-29 menu-coverage F-MC1 (user ruling 2026-09-30, A58;
   * executes the 2026-07-30 ruling "Darkness counts as 40 % but position
   * MUST be evaluated"): for a TEAMMATE's crisis, was the owner within the
   * positional wall's reach of the crisis unit at `tSec`? `false` — including
   * a missing position sample, which fails CLOSED here: a gap must not create
   * an accusation — keeps a `MITIGATION_TABLE` `positional` cooldown out of
   * the ACCUSATION set. An absent callback does not gate. The response set
   * is untouched. */
  reachesCrisisUnit?: (
    spellId: string,
    crisisUnitId: string,
    tSec: number,
  ) => boolean,
  /** Could Forbearance stop the owner pressing this cooldown at `tSec`
   * (`forbearanceBlocks` ∧ `selfForbearanceActiveAt` — the predicates the
   * `[DEATH]` "Unused:" gate reads)? `true` keeps it out of the ACCUSATION
   * set: a Divine Shield under Forbearance was not "ready" (review of
   * cd-hoarded F-W6, 2026-10-03: a Holy Paladin's unpressed Divine Shield,
   * owned on the spec baseline, named 10 s after a self Lay on Hands). The
   * caller checks the RECIPIENT (`forbearanceStopsPress`: the crisis unit
   * for an external such as Lay on Hands). Since FT F22 the caller asks
   * `lockoutDebuffStopsPress`, which also stops an Ice Block under
   * Hypothermia. An absent callback does not gate; the response set is
   * untouched. */
  ownerForbearanceBlocks?: (
    spellId: string,
    tSec: number,
    crisisUnitId: string,
  ) => boolean,
  /** Codex review of F-W6, round 6: could the owner press a defensive that
   * is cast ON AN ENEMY (`enemyTargetReaches`: Touch of Karma) at `tSec` —
   * a living enemy within its reach? `false` (a missing sample fails closed)
   * keeps it out of the ACCUSATION set, the own crisis included. An absent
   * callback does not gate; the response set is untouched. */
  ownerReachesEnemyTarget?: (spellId: string, tSec: number) => boolean,
): CandidateEvent[] {
  const cap = overrides?.cap ?? CD_HOARD_CAP;
  const candidates: Array<{
    crisisUnit: { id: string; name: string };
    own: boolean;
    point: ICdHoardedCrisisSource["points"][number];
    ready: CdHoardCandidateCd[];
  }> = [];
  // GH #96 D6 decision trace: every crisis point is an opportunity, recorded
  // before emission (inert unless an eval harness installed a sink).
  const tracing = isDecisionTraceActive();
  const trace: DecisionRecord[] = [];
  const opportunity = (
    crisisUnitId: string,
    p: ICdHoardedCrisisSource["points"][number],
  ) => `cd-hoarded:${owner.id}:${crisisUnitId}:${toRenderSecond(p.tSec)}`;
  const pointFacts = (
    own: boolean,
    p: ICdHoardedCrisisSource["points"][number],
    ready?: CdHoardCandidateCd[],
  ) => ({
    own,
    tSec: toRenderSecond(p.tSec),
    hpPct: p.hpPct,
    dmg2s: p.dmg2s,
    dangerous: p.dangerous,
    inCC: p.inCC,
    ...(ready ? { readyCds: ready.map((cd) => cd.spellId) } : {}),
  });
  for (const src of sources) {
    for (const p of src.points) {
      // "only dangerous && !inCC points" (spec 2026-08-30): dangerous is
      // gate 5 (a real damage floor), inCC is gate 1 — both describe the
      // CRISIS UNIT's own state. Deliberately NOT `p.feasible` (which also
      // requires !diedInWindow and hasTool): a crisis unit who died within
      // the response window is exactly the case this type exists to catch,
      // and `hasTool` answers a different question (could the crisis unit
      // help THEMSELF) than the one this predicate asks (did the OWNER have
      // a ready cooldown for THEM).
      if (!p.dangerous || p.inCC) {
        if (tracing)
          trace.push({
            type: "cd-hoarded",
            opportunityId: opportunity(src.crisisUnit.id, p),
            ownerId: owner.id,
            verdict: "ineligible",
            reason: !p.dangerous ? "not-dangerous" : "crisis-unit-in-cc",
            facts: pointFacts(src.own, p),
            candidateIds: [],
          });
        continue;
      }
      // Reliability round 2 W1a: `p.inCC` is the CRISIS UNIT's state. For a
      // teammate's crisis nothing checked the owner, and for the owner's own
      // crisis only hard CC (not silence or a kick lockout) was checked — the
      // accusation fired on a silenced / stunned / kicked owner (6fcb Garrote
      // 58.5–61.5 at a 1:00 teammate crisis; 138e Skull Bash lockout then
      // Incapacitating Roar). The owner must be able to act for at least
      // REACTION_WINDOW_S of `ownerFreeSpan` — from the crisis second on.
      // I05 (user ruling 2026-10-11, option b): until then the gate read the
      // whole window "spent" counts presses in, 1.5 s before the crossing
      // included, while `facts.ownerFreeS` counts from `t` — so an owner free
      // only BEFORE the crisis passed and the row printed `ownerFreeS=0.0`
      // (30846f8e @82: a Frost Mage's Ice Block, Frost locked by Counterspell
      // from −0.4 s; 3b56ac97 r4 @79: Hammer of Justice from +0.8 s to +5.8 s,
      // `ownerFreeS=0.8`). Nobody is asked to answer a crisis before it
      // exists; a press before it still ANSWERS it (`spent` below keeps its
      // own window).
      // FT-T10 (user ruling 2026-10-10): asked per cooldown below — a kick
      // lockout stops only the spells of the school it locked. Unasked for a
      // spell, the gate is the old one (every lockout locks everything).
      const free = ownerFreeSpan(p.tSec);
      const traceOwnerCouldNotAct = () => {
        if (tracing)
          trace.push({
            type: "cd-hoarded",
            opportunityId: opportunity(src.crisisUnit.id, p),
            ownerId: owner.id,
            verdict: "ineligible",
            reason: "owner-could-not-act",
            facts: pointFacts(src.own, p),
            candidateIds: [],
          });
      };
      // Two sets on purpose (reaction window, user ruling 2026-09-23): the
      // ACCUSATION names only cooldowns ready by t − REACTION_WINDOW_S
      // (`cdReadyInTimeAt`), but "did they respond" (`spent` below) counts a
      // press of any save cooldown that helps this unit (since 2026-09-24 not
      // even required to be off cooldown at t — reliability audit A2). With one strict set, a
      // cooldown that came back 0.4 s before the crisis and WAS pressed fell
      // out of `spent`, and the other unpressed wall became a new accusation
      // against a player who had answered — 8 new accusations on the S2
      // archive every-30 before the split, 0 after (the 1 remaining addition is a
      // CD_HOARD_CAP substitution).
      const helps = (cd: CdHoardCandidateCd) =>
        src.own
          ? !SELF_CAST_NOOP_EXTERNAL_IDS.has(cd.spellId)
          : cdCanHelpAnotherUnit(cd);
      const offCooldown = readyDefensiveCds(ownerCds, p.tSec, helps);
      // The ACCUSATION set: a response-only save (Barkskin / Frenzied
      // Regeneration, user ruling 2026-09-25 「不指控」) is never named as
      // "ready" — it still answers the crisis through `spent` below.
      // W1e (reliability round 2): a save that only blocks some schools
      // (Blessing of Protection physical, Spellwarding / Cloak of Shadows
      // magic — `MITIGATION_TABLE`'s official school mask; Anti-Magic Shell
      // magic via its DB2 absorb mask, F-H20 — `saveSchoolMask`) is named only when
      // it covers at least SCHOOL_SAVE_MIN_SHARE of the 2 s of damage that
      // made this a crisis. The response set below is untouched.
      // F-H6: a cooldown the owner could not pay for at any mana sample in
      // [t, t + CD_HOARD_RESPONSE_S] is not "ready" to accuse (7f67e778 @378:
      // Restoral costs 11,482 while the owner held 1,398).
      const readyButForOwner = offCooldown.filter(
        (cd) =>
          !cd.responseOnly &&
          cdReadyInTimeAt(cd, p.tSec) &&
          coversCrisisSchool(cd.spellId, p) &&
          ownerAffordable?.(
            cd.spellId,
            p.tSec,
            p.tSec + CD_HOARD_RESPONSE_S,
          ) !== false &&
          // F-MC1: a positional wall (Darkness' 8 yd zone) is "ready" for a
          // teammate only when the owner stood within its reach of them
          (src.own ||
            !MITIGATION_TABLE[cd.spellId]?.positional ||
            reachesCrisisUnit?.(cd.spellId, src.crisisUnit.id, p.tSec) !==
              false) &&
          ownerForbearanceBlocks?.(cd.spellId, p.tSec, src.crisisUnit.id) !==
            true &&
          ownerReachesEnemyTarget?.(cd.spellId, p.tSec) !== false,
      );
      // the owner could press THIS cooldown: free of CC, and of a lockout on
      // its school, for REACTION_WINDOW_S of `ownerFreeSpan`. I05 (c): a stun
      // is no CC for a cooldown the game lets a stunned player press — the
      // reading `facts.ownerFreeS` has, so the gate and the fact agree per
      // cooldown (an owner stunned through the span with Icebound Fortitude
      // in hand is named for it; with Anti-Magic Shell alone, not)
      const ready = readyButForOwner.filter(
        (cd) =>
          ownerCouldRespond?.(free.fromS, free.toS, cd.spellId, src.own) !==
          false,
      );
      // the trace keeps its two reasons: the owner could not act (for any
      // ready cooldown, or — with none ready — at all), else nothing ready
      if (
        ready.length === 0 &&
        (readyButForOwner.length > 0 ||
          (!!ownerCouldRespond && !ownerCouldRespond(free.fromS, free.toS)))
      ) {
        traceOwnerCouldNotAct();
        continue;
      }
      if (ready.length === 0) {
        if (tracing)
          trace.push({
            type: "cd-hoarded",
            opportunityId: opportunity(src.crisisUnit.id, p),
            ownerId: owner.id,
            verdict: "suppressed",
            reason: "no-ready-cd",
            facts: pointFacts(src.own, p, ready),
            candidateIds: [],
          });
        continue;
      }
      // BACKLOG #43, user ruling 2026-09-17 「可以免,如果人没死的话」: a low-HP
      // talent proc / cheat-death fired for the crisis unit AND they were still
      // alive CD_HOARD_RESPONSE_S later — the proc did the job, holding the
      // cooldown is not hoarding. If they died anyway the accusation stands.
      const procAnswered =
        !!(p.responses?.proc || p.responses?.cheatDeath) &&
        !(src.deathSeconds ?? []).some(
          (d) => d > p.tSec && d <= p.tSec + CD_HOARD_RESPONSE_S,
        );
      if (procAnswered) {
        if (tracing)
          trace.push({
            type: "cd-hoarded",
            opportunityId: opportunity(src.crisisUnit.id, p),
            ownerId: owner.id,
            verdict: "suppressed",
            reason: "proc-answered-survived",
            facts: pointFacts(src.own, p, ready),
            candidateIds: [],
          });
        continue;
      }
      // A2 (user ruling 2026-09-19, codex astra debate 2026-09-24): a major
      // wall already up on the crisis unit at the crossing — whoever cast it —
      // means this line cannot say the owner left them unprotected. Abstain;
      // it is NOT recorded as a response and NOT as "enough protection".
      const wall = (src.majorWalls ?? []).find(
        (w) => w.fromS <= p.tSec && p.tSec < w.toS,
      );
      if (wall) {
        if (tracing)
          trace.push({
            type: "cd-hoarded",
            opportunityId: opportunity(src.crisisUnit.id, p),
            ownerId: owner.id,
            verdict: "suppressed",
            reason: "wall-active",
            facts: pointFacts(src.own, p, ready),
            candidateIds: [],
          });
        continue;
      }
      // Response set (A2): every save cooldown that could help this unit,
      // pressed in the window — NOT only the ones off cooldown at tSec (see the
      // "Spent" paragraph above). The accusation set `ready` is unchanged.
      // A2 (i b, user ruling 2026-09-24 "加"): a press only answers THIS
      // crisis when it went to this unit. A cast the log names a target for
      // must name the crisis unit (Blessing of Protection on the other
      // teammate does not answer this one's crisis; nor does an external on
      // a teammate answer the owner's own). A cast with no named target is a
      // self or group effect (Divine Shield, Aura Mastery, Tranquility) and
      // still counts — `helps` already kept only cooldowns that can reach
      // this unit.
      //
      // Only for cooldowns that CAN go to someone else (`canHelpAnotherUnit`).
      // A self-only wall always lands on the caster, and the log's cast
      // target for it is whatever the player had selected — usually an enemy
      // (Obsidian Scales → the Devastation Evoker's target, Touch of Karma →
      // the Monk's): the first corpus run read those as "given to someone
      // else" and produced 11 new false accusations out of 35. For those the
      // recipient is the caster, which `helps` already restricted to the
      // owner's own crisis.
      const reachedThisUnit = (
        cd: CdHoardCandidateCd,
        c: { targetName?: string },
      ) =>
        !cdCanHelpAnotherUnit(cd) ||
        c.targetName === undefined ||
        c.targetName === src.crisisUnit.name ||
        // a talent-shared wall put on an ally lands on its caster too (the
        // log: an APPLIED on each, one instant — `MITIGATION_TABLE`'s
        // `pctOnOthers` note), so it answers the caster's own crisis
        // (fact4 D57 preview, 149-4-936 @129: Obsidian Scales on a teammate
        // 2.2 s after the evoker's own crossing read "held")
        (src.own && isAllyCopyWallId(cd.spellId));
      const inWindow = (t: number) =>
        t >= p.tSec - RESPONSE_PRE_MS / 1000 &&
        t <= p.tSec + CD_HOARD_RESPONSE_S;
      const spent =
        ownerCds
          .filter((cd) => isSpendableDefensiveCd(cd) && helps(cd))
          .some((cd) =>
            cd.casts.some(
              (c) => inWindow(c.timeSeconds) && reachedThisUnit(cd, c),
            ),
          ) ||
        // fact2 C1 (user ruling 4, 2026-10-20): the owner's own self wall
        // whose copy the log shows on THIS teammate answered it (Flameshaper
        // Obsidian Scales — `allyCopyOn`, the same reading the teammates'
        // answered set takes; 94e93f63 @110: the copy landed on the crisis
        // unit 2.2 s after t and the event read "no save spent")
        (!src.own &&
          ownerCds
            .filter((cd) => isSpendableDefensiveCd(cd))
            .some((cd) =>
              cd.casts.some(
                (c) =>
                  inWindow(c.timeSeconds) &&
                  c.allyCopyOn === src.crisisUnit.name,
              ),
            )) ||
        (teamAnswers?.ownerPeelCastSeconds ?? []).some(inWindow) ||
        (teamAnswers?.teamSaveCastSeconds ?? []).some(inWindow) ||
        // fact1215 R11 (5dd3d2d6 @86): a redirect save the owner pressed for
        // this unit — Roar of Sacrifice, Master's Call, Intervene, Leap of
        // Faith (`ownerRedirectSaves`). It is never accused (rulings A20 +
        // U3) and is outside the ledger, so the response set did not see it
        // either; keeping a save out of the accusation set must not take it
        // out of the answers.
        (teamAnswers?.ownerRedirectSaves?.(src.crisisUnit.id) ?? []).some(
          inWindow,
        );
      if (spent) {
        if (tracing)
          trace.push({
            type: "cd-hoarded",
            opportunityId: opportunity(src.crisisUnit.id, p),
            ownerId: owner.id,
            verdict: "suppressed",
            reason: "ready-cd-spent",
            facts: pointFacts(src.own, p, ready),
            candidateIds: [],
          });
        continue;
      }
      candidates.push({
        crisisUnit: src.crisisUnit,
        own: src.own,
        point: p,
        ready,
      });
    }
  }
  const ranked = candidates.sort(
    (a, b) =>
      Number(b.point.enemyBurst) - Number(a.point.enemyBurst) ||
      b.point.attackers2s - a.point.attackers2s ||
      b.point.dmg2s - a.point.dmg2s,
  );
  const kept = ranked.slice(0, cap);
  if (tracing) {
    for (const c of ranked) {
      const isKept = kept.includes(c);
      trace.push({
        type: "cd-hoarded",
        opportunityId: opportunity(c.crisisUnit.id, c.point),
        ownerId: owner.id,
        verdict: isKept ? "emitted" : "suppressed",
        ...(isKept ? {} : { reason: "capped" }),
        facts: pointFacts(c.own, c.point, c.ready),
        candidateIds: isKept
          ? [
              `cd-hoarded:${owner.id}:${c.crisisUnit.id}:${toRenderSecond(c.point.tSec)}`,
            ]
          : [],
      });
    }
    trace.forEach(traceDecision);
  }
  return kept
    .map(({ crisisUnit, own, point, ready }) => {
      const t = toRenderSecond(point.tSec);
      const windowFromS = point.tSec - RESPONSE_PRE_MS / 1000;
      const windowToS = point.tSec + CD_HOARD_RESPONSE_S;
      // Intent guard: any of the READY cooldowns' own spellIds with a
      // rejected cast inside the same response window — merged across every
      // ready cooldown (not just one), since the accusation now names up to
      // three (`facts.readyCds`), not a single spell.
      const failedHits = rawStreams
        ? ready.flatMap((cd) =>
            filterIntentGuardEvidence(
              castFailedInWindow(
                rawStreams,
                owner.id,
                windowFromS,
                windowToS,
                Number(cd.spellId),
              ),
              // Feign Death's casts are its Survival Tactics 202748
              // activations (AURA_ONLY_ACTIVATION_IDS), so "cast later" sees
              // a feign that is never logged as a press
              cd.casts.map((c) => c.timeSeconds),
              // F-H12 (ruling 2026-09-30 C1): a GCD reject of a cooldown
              // ready at that press, never followed by its cast in the
              // window, counts as an attempt; the accusation is not waived
              {
                ownCastSuccessSeconds,
                keepGcdLockedUntilS: windowToS,
                // at the press itself: cdAvailableAt adds the rendered-
                // second slack, which here would admit a cooldown that
                // only came back up to 0.5 s after the reject (codex
                // review of F-H12)
                readyAt: (s) => cdAvailableAt(cd, s - CD_INSTANT_SLACK_S),
              },
            ),
          )
        : [];
      const attempted = formatAttemptedFact(failedHits);
      // F-H2 (ruling 2026-09-30, R1 = B): the rejected presses stay counted,
      // but the line says WHEN (offsets from t) and how long the owner could
      // still act after the last one — pressing once while stunned does not
      // excuse the rest of the window (95127ab4: six rejects in Leg Sweep
      // before t, then 5.2 s free with the cooldown in hand).
      const rejectAt = failedHits.map((h) => h.tSeconds).sort((a, b) => a - b);
      // A2 step 2 (user ruling 2026-09-25 「给别人也算回应不行」): a save the
      // owner pressed in this window on ANOTHER unit did not answer this
      // crisis — but it WAS pressed, so the line says where it went, or the
      // model reads "ready" as "held the whole time".
      // fact2 C1: a self wall's ally copy went where the log shows it
      // (`allyCopyOn`), not to the cast's named target
      const recipientOf = (
        cd: CdHoardCandidateCd,
        c: { targetName?: string; allyCopyOn?: string },
      ): string | undefined =>
        cdCanHelpAnotherUnit(cd) ? c.targetName : c.allyCopyOn;
      const spentElsewhere = ownerCds
        .filter(
          (cd) =>
            isSpendableDefensiveCd(cd) &&
            (cdCanHelpAnotherUnit(cd) || cd.casts.some((c) => c.allyCopyOn)),
        )
        .flatMap((cd) =>
          cd.casts
            .filter(
              (c) =>
                c.timeSeconds >= windowFromS &&
                c.timeSeconds <= windowToS &&
                recipientOf(cd, c) !== undefined &&
                recipientOf(cd, c) !== crisisUnit.name,
            )
            .map((c) => {
              const dt = c.timeSeconds - point.tSec;
              return {
                at: c.timeSeconds,
                text: `${cd.spellName} → ${recipientOf(cd, c)} ${dt >= 0 ? "+" : ""}${dt.toFixed(1)}s`,
              };
            }),
        )
        .sort((a, b) => a.at - b.at)
        .map((x) => x.text)
        .join("; ");
      // H1: the owner's cannot-cast intervals overlapping the response
      // window, offsets from the anchor second, and the free seconds after
      // it. Only when something blocked them — a free owner gets neither.
      // anchored on the rendered second `t` (facts.t), which the legend
      // measures the offsets and ownerFreeS from — `ownerFreeSpan`, the span
      // the owner gate passed on (I05), so ownerFreeS ≥ REACTION_WINDOW_S
      // FT-T10: free time is counted against the cooldowns the row names;
      // `ownerCc` still lists every interval on the owner, a lockout with
      // its school — the legend tells the reader a named cooldown was
      // outside it (deliberate; post-hoc review 45-FT-99)
      // I05 (c): and a stun is not counted against a cooldown the game lets
      // a stunned player press (`actWindowFor`'s `stunPressable`) — the
      // stun stays in `ownerCc`, the legend says why the time still counts
      const readySpellIds = ready.map((cd) => cd.spellId);
      const freeSpan = ownerFreeSpan(point.tSec);
      const act =
        ownerActState?.(
          windowFromS,
          freeSpan.toS,
          freeSpan.fromS,
          readySpellIds,
          own,
        ) ?? null;
      const off = (s: number) => {
        const d = s - t;
        return `${d >= 0 ? "+" : ""}${d.toFixed(1)}`;
      };
      const attemptedAt = rejectAt.length
        ? rejectAt.length === 1 || off(rejectAt[0]!) === off(rejectAt.at(-1)!)
          ? `${off(rejectAt[0]!)}s`
          : `${off(rejectAt[0]!)}…${off(rejectAt.at(-1)!)}s`
        : "";
      // WO3 #14 (r1008-79): a "not ready" reject of an on-GCD cooldown
      // inside the owner's own GCD is free only once that GCD ends
      // (`gcdLockedUntilS`, the guard's own test)
      const freeFromS = failedHits.reduce((m, h) => {
        const gcdEnd =
          ownCastSuccessSeconds &&
          NOT_READY_REASONS.has(h.reason) &&
          !OFF_GCD_SPELL_IDS.has(String(h.spellId))
            ? gcdLockedUntilS(ownCastSuccessSeconds, h.tSeconds)
            : undefined;
        return Math.max(m, gcdEnd ?? h.tSeconds);
      }, -Infinity);
      const afterReject =
        rejectAt.length && ownerActState
          ? ownerActState(
              windowFromS,
              windowToS,
              Math.min(freeFromS, windowToS),
              readySpellIds,
              own,
            )
          : null;
      // F-H5 (ruling 2026-09-30, R3 = A): the window really available after
      // t — cut at the owner's death or the round end, the gate's own cut —
      // stated only when shorter than CD_HOARD_RESPONSE_S.
      // (compared as rendered: 4.96 s would print "5.0", which says nothing)
      const windowRendered = act ? Math.max(0, act.endS - t).toFixed(1) : "";
      const windowS =
        act && Number(windowRendered) < CD_HOARD_RESPONSE_S
          ? windowRendered
          : "";
      // F-H7 / F-H9 (ruling 2026-09-30, R4 = B, R5 = B): saves pressed for
      // the crisis unit by someone other than the player — the unit itself,
      // or another teammate's ally-reaching save — stated, not credited.
      const pressedFor = (
        cds: CdHoardCandidateCd[],
        ally: boolean,
      ): Array<{ at: number; name: string; spellId: string }> =>
        cds
          .filter((cd) => isSpendableDefensiveCd(cd))
          .flatMap((cd) =>
            cd.casts
              .filter(
                (c) =>
                  c.timeSeconds >= windowFromS &&
                  c.timeSeconds <= windowToS &&
                  (cdCanHelpAnotherUnit(cd)
                    ? c.targetName === undefined ||
                      c.targetName === crisisUnit.name ||
                      c.allyCopyOn === crisisUnit.name ||
                      // the unit's own talent-shared wall given to an ally
                      // lands on it too (codex 20-F17-09 #1)
                      (!ally && isAllyCopyWallId(cd.spellId))
                    : // F15 C1: a self wall answers for a teammate only
                      // through the copy the log shows on that teammate
                      // (Flameshaper Obsidian Scales — `allyCopyOn`)
                      !ally || c.allyCopyOn === crisisUnit.name),
              )
              .map((c) => ({
                at: c.timeSeconds,
                name: cd.spellName,
                spellId: cd.spellId,
              })),
          );
      const crisisUnitSaved = own
        ? ""
        : (teamLedgers ?? [])
            .filter((l) => l.unit.id === crisisUnit.id)
            .flatMap((l) => [
              ...pressedFor(l.cds, false).map((x) => ({
                ...x,
                broken: l.brokenAtS?.(x.spellId, x.at) ?? null,
              })),
              ...(l.returns ?? [])
                .filter((r) => r.atS >= windowFromS && r.atS <= windowToS)
                .map((r) => ({ at: r.atS, name: r.name, broken: null })),
              ...(l.redirects ?? [])
                .filter(
                  (r) =>
                    r.onUnitId === crisisUnit.id &&
                    r.atS >= windowFromS &&
                    r.atS <= windowToS,
                )
                .map((r) => ({ at: r.atS, name: r.name, broken: null })),
            ])
            .sort((a, b) => a.at - b.at)
            .map(
              (x) =>
                `${x.name} ${off(x.at)}s${x.broken !== null ? ` (broken ${off(x.broken)}s)` : ""}`,
            )
            .join("; ");
      // Work order 2026-10-14b fix 11 (facts only): a listed ready cooldown
      // the player DID press in the next response window after this one —
      // late, not never (0068182d @152: Mass Invisibility reached the
      // crisis unit at +5.8 s, the row said nothing; 3 of 22 rows of the 51
      // had such a press). The first press in (window end, window end +
      // CD_HOARD_RESPONSE_S], with whom it was aimed at.
      const pressedLate = ready
        .slice(0, 3)
        .flatMap((cd) => {
          const c = cd.casts.find(
            (x) =>
              x.timeSeconds > windowToS &&
              x.timeSeconds <= windowToS + CD_HOARD_RESPONSE_S,
          );
          return c
            ? [
                `${cd.spellName}${c.targetName ? ` → ${c.targetName}` : ""} ${off(c.timeSeconds)}s`,
              ]
            : [];
        })
        .join("; ");
      const teamAnswered = (teamLedgers ?? [])
        .filter((l) => l.unit.id !== crisisUnit.id && l.unit.id !== owner.id)
        .flatMap((l) => [
          ...pressedFor(l.cds, true).map((x) => ({ ...x, who: l.unit.name })),
          ...(l.redirects ?? [])
            .filter(
              (r) =>
                r.onUnitId === crisisUnit.id &&
                r.atS >= windowFromS &&
                r.atS <= windowToS,
            )
            .map((r) => ({ at: r.atS, name: r.name, who: l.unit.name })),
        ])
        .sort((a, b) => a.at - b.at)
        .map((x) => `${x.name} (${x.who}) ${off(x.at)}s`)
        .join("; ");
      // B2-② (user ruling 2026-10-06; facts only — verdict and reference
      // unchanged): offensive cooldowns the player pressed in the
      // OWN_BURST_LEAD_S before the crisis reading — raw instants, and each
      // says how long BEFORE THE READING it was. Not an offset from `t` like
      // the line's other offsets: `t` is the reading's floored second, so a
      // press 0.5 s before a 29.8 s reading would print "+0.3s" — after `t`,
      // on a fact that says "before" (agy review of the batch). 537209d8 @29:
      // Power Infusion and Voidform 1–2 s before the 37 % reading with
      // Dispersion ready.
      const ownBurstPressed = ownerCds
        .filter((cd) => OFFENSIVE_CD_SPELL_IDS.has(String(cd.spellId)))
        .flatMap((cd) =>
          cd.casts
            .filter(
              (c) =>
                c.timeSeconds >= point.tSec - OWN_BURST_LEAD_S &&
                c.timeSeconds <= point.tSec,
            )
            .map((c) => ({ at: c.timeSeconds, name: cd.spellName })),
        )
        .sort((a, b) => a.at - b.at)
        .map((x) => `${x.name} ${(point.tSec - x.at).toFixed(1)}s before`)
        .join("; ");
      // B1 (user ruling 2026-10-07, variant B of the 605 scan; a fact — the
      // accusation is not waived): a defensive that would have helped here
      // and is NOT among the ready ones, pressed inside the response window
      // and rejected as not ready while the ledger says it was on its own
      // cooldown at that press. Only key repeats right after that same
      // spell's cast are left out; another cast's global cooldown is not
      // (14055cb2 @63: two Ice Barrier presses 0.5 and 0.7 s after an Ice
      // Storm cast, Ice Barrier itself on cooldown).
      const readyIds = new Set(ready.map((cd) => cd.spellId));
      const otherAttempts = rawStreams
        ? ownerCds
            .filter(
              (cd) =>
                isSpendableDefensiveCd(cd) &&
                (own || cdCanHelpAnotherUnit(cd)) &&
                !readyIds.has(cd.spellId),
            )
            .map((cd) => {
              const n = castFailedInWindow(
                rawStreams,
                owner.id,
                windowFromS,
                windowToS,
                Number(cd.spellId),
              ).filter(
                (h) =>
                  NOT_READY_REASONS.has(h.reason) &&
                  // at the press itself, without the rendered-second slack
                  // `cdAvailableAt` adds (the `attempted` guard above does
                  // the same): a reject 0.3 s before the cooldown came back
                  // was still a press into its own cooldown
                  !cdAvailableAt(cd, h.tSeconds - CD_INSTANT_SLACK_S) &&
                  !cd.casts.some(
                    (c) =>
                      h.tSeconds >= c.timeSeconds &&
                      h.tSeconds - c.timeSeconds <= INTENT_GUARD_GCD_S,
                  ),
              ).length;
              return n > 0 ? `${cd.spellName}${n > 1 ? ` ×${n}` : ""}` : "";
            })
            .filter(Boolean)
            .join("、")
        : "";
      const ownerCc = act?.blocks.length
        ? act.blocks
            .map(
              (b) =>
                `${getEnglishSpellName(b.spellId)}${b.lockout ? ` lockout${lockedSchoolsText(b.lockedSchoolMask)}` : ""} ${off(b.fromS)}…${Number.isFinite(b.toS) ? `${off(b.toS)}s` : "(no end logged)"}`,
            )
            .join("; ")
        : "";
      return {
        id: `cd-hoarded:${owner.id}:${crisisUnit.id}:${t}`,
        type: "cd-hoarded",
        t,
        unitNames: [owner.name, crisisUnit.name],
        // Presentation only (types.ts: "for a multi-spell event only the
        // first is taken") — `facts.readyCds` carries the full list.
        spell: ready[0]?.spellName,
        spellId: ready[0]?.spellId,
        facts: {
          t: String(t),
          crisisUnit: crisisUnit.name,
          crisisHpPct: String(point.hpPct),
          dmg2sPct: String(Math.round(point.dmg2s * 100)),
          readyCds: ready
            .slice(0, 3)
            .map((cd) => cd.spellName)
            .join("; "),
          own: own ? "yes" : "no",
          ...CD_HOARDED_OUTCOME_REF,
          ...(attempted ? { attempted } : {}),
          ...(attempted && attemptedAt ? { attemptedAt } : {}),
          // floored, not rounded: the legend compares the RENDERED value
          // with REACTION_WINDOW_S, so 0.96 s must read 0.9, never 1.0
          // (codex check of F-H2; CLAUDE.md render-grid rule)
          ...(attempted && afterReject
            ? {
                freeAfterAttemptS: (
                  Math.floor(afterReject.freeAfterS * 10 + 1e-9) / 10
                ).toFixed(1),
              }
            : {}),
          ...(windowS ? { windowS } : {}),
          ...(crisisUnitSaved ? { crisisUnitSaved } : {}),
          ...(teamAnswered ? { teamAnswered } : {}),
          ...(pressedLate ? { pressedLate } : {}),
          ...(spentElsewhere ? { spentElsewhere } : {}),
          ...(ownerCc && act
            ? { ownerCc, ownerFreeS: act.freeAfterS.toFixed(1) }
            : {}),
          ...(ownBurstPressed ? { ownBurstPressed } : {}),
          ...(otherAttempts ? { otherAttempts } : {}),
        },
      };
    })
    .sort((a, b) => a.t - b.t);
}

/** A single citable "crisis moment" inside a window: the worst HP% any
 * friendly reached, which friendly it was, and the rendered second it
 * happened on — cd-hoarded's fact needs a point to cite ("ally at 34% at
 * 6:30"), not just a floor value. */
export interface ICrisisMoment {
  t: number;
  unitName: string;
  hpPct: number;
}

/**
 * Worst HP% any friendly reached inside [fromSeconds, toSeconds], render-grid
 * sampled at every rendered second — the scan missed-sync-window's enemy
 * reading ran until 2026-10-14 (Task 2), on the owner's own team, carrying back
 * WHICH unit and WHICH render second produced the worst reading (cd-hoarded's
 * crisis fact needs a citable moment, not just a number). Render-grid
 * discipline (CLAUDE.md): the caller must pass already-`toRenderSecond`-floored
 * `fromSeconds`/`toSeconds` (cd-hoarded's own `readyT`/`castT`) so the scanned
 * range can never disagree with the window shown in facts; this function
 * floors again defensively but that must be a no-op on an already-floored
 * input, never load-bearing. Returns null only when NO sample anywhere in the
 * window succeeded (no advanced logging) — the caller must treat null as
 * "cannot confirm a crisis happened", never as "0%".
 */
export function friendlyCrisisMomentInWindow(
  friends: any[],
  combat: { startTime: number },
  fromSeconds: number,
  toSeconds: number,
  hpLookup: (
    unit: any,
    timestampMs: number,
    maxDtMs: number,
  ) => number | null = getUnitHpAtTimestamp,
  /** GH #28: restrict the scan to ONE unit. md-cyclone-window (the sole
   *  production caller since the 2026-08-30 cd-hoarded rewrite — see
   *  `CD_HOARD_CRISIS_HP_PCT`'s doc comment) passes this when a hoarded
   *  cooldown cannot help anybody else, so a teammate's dip can never become
   *  the crisis that a self-only tool is accused of ignoring. Absent = scan
   *  every friendly, the behaviour every other caller keeps. */
  onlyUnitName?: string,
): ICrisisMoment | null {
  const fromR = toRenderSecond(fromSeconds);
  const toR = toRenderSecond(toSeconds);
  const scanned =
    onlyUnitName === undefined
      ? friends
      : friends.filter((f) => f.name === onlyUnitName);
  let worst: ICrisisMoment | null = null;
  for (let t = fromR; t <= toR; t++) {
    for (const f of scanned) {
      const hp = hpLookup(f, combat.startTime + t * 1000, HP_SAMPLE_RADIUS_MS);
      if (hp === null) continue;
      if (worst === null || hp < worst.hpPct) {
        worst = { t, unitName: f.name, hpPct: hp };
      }
    }
  }
  return worst;
}

/** Per-match cap for cd-spent-idle. <标定定稿 2026-08-15,报告
 * p1p2-calibration.md>: confirmed at 2, unchanged — full-corpus scan
 * measured 场均条数(capped) only 0.14 (raw 0.15, essentially uncapped —
 * B6's red line already does almost all the limiting: 35.1% of rounds are
 * "low" threat and return `[]` before any cast is even probed), 发生率 just
 * 11.9%, the lowest of the four new types and well under every precedent.
 * 双向误差注: a lower cap has essentially no effect (raw already sits at
 * 0.15, nowhere near 2); a higher cap likewise has no effect for the same
 * reason — this type's volume is governed by the B6 threat gate, not by
 * this cap, so there is no evidence for moving it off the shared
 * per-round-cap default. */
const CD_SPENT_IDLE_CAP = 2; // <标定定稿 2026-08-15,报告 p1p2-calibration.md>;at-cap 体检 2026-08-26:21/83(25%)

/**
 * cd-spent-idle (P2 起爆-2, 2026-08-15, deep-dive-derived definition): a
 * defensive/survival major cooldown was cast at a moment with no active
 * enemy threat (圣佑/Blessing-of-Sanctuary blind-cast shape: pressing a
 * survival tool into dead air instead of holding it for the next real
 * window).
 *
 * "Defensive/survival CD" identification follows the exact filter this
 * file's own `slowDefensiveResponseEvents` wiring already uses in
 * `teamPlayEvents` (`DEFENSIVE_TAGS.has(cd.tag) && !cd.isThroughput` —
 * `DEFENSIVE_TAGS` = Defensive ∪ External spell tags, cooldowns.ts) rather
 * than inventing a second definition of "defensive".
 *
 * Threat gate is `threatAssessment.ts`'s single-source predicates, consumed
 * (never re-implemented) via injected probes:
 *  - per-cast gate: `probes.threatActiveAt(t)` false at the (render-floored)
 *    cast instant → candidate; true → no candidate.
 *  - **Red line B6** (non-negotiable, user-ruled): if `matchThreat` — the
 *    caller's already-computed `matchThreatLevel(...)` for the whole match —
 *    is `"low"`, this function returns `[]` before even looking at any cast,
 *    and `probes.threatActiveAt` is never invoked (pinned by a dedicated
 *    spy test: in a low-threat match, using CDs on cooldown is correct play,
 *    not a coaching point).
 *
 * Render-grid anchoring (CLAUDE.md): the cast instant is floored via
 * `toRenderSecond` BEFORE it is used for the threat gate or written into
 * facts — the same instant must decide both, or the fact could disagree
 * with the gate that produced it.
 *
 * Cost-norm guard (#25 precedent, same as `cdHoardedEvents` above): a
 * cost_norm ability spent into a lull still carries `costNorm` in facts so
 * the prompt can explain the "last resort only" caveat rather than reading
 * as a routine "you cast into nothing" callout.
 *
 * Severity/cap: sorted chronologically (earliest idle spend first — no
 * damage-value data is wired in here, mirroring `unsyncedBurstEvents`'
 * documented no-new-CD-logic constraint), capped at `CD_SPENT_IDLE_CAP`
 * (see that constant's own doc comment for the 2026-08-15 corpus
 * calibration).
 */
export function cdSpentIdleEvents(
  cds: Pick<
    IMajorCooldownInfo,
    "spellId" | "spellName" | "tag" | "isThroughput" | "casts"
  >[],
  owner: { id: string; name: string },
  matchThreat: MatchThreatLevel,
  probes: {
    /** Wired to threatAssessment.ts's threatActiveAt in production. */
    threatActiveAt: (tSeconds: number) => boolean;
  },
  // Calibration-only override, same rationale as cdHoardedEvents' — defaults
  // to the module constant, production call sites unaffected.
  overrides?: { cap?: number },
): CandidateEvent[] {
  if (matchThreat === "low") return []; // B6 red line — never even probes.
  const cap = overrides?.cap ?? CD_SPENT_IDLE_CAP;
  // GH #29 阶段 2b:这条指控是「你把**保命大 CD** 按在了没威胁的空气里」。
  // `!isThroughput` 只等于「不是 Offensive-tagged」,挡不住那些挂着 Defensive
  // 牌子、实为**治疗产出强化**的 CD —— 而产出 CD 本来就该在安全窗口 pump,
  // 那是正确操作,不是浪费。签字册 kind `throughput_role` 就是这一维的单源
  // (用户 2026-08-22 裁定:神圣显灵是治疗大技能;复仇十字军随专精,奶骑是
  // 主要治疗)。250 场 / 312 治疗轮实测:cd-spent-idle 46 → 43,去掉的 3 条
  // 全是复仇十字军;光环大师那 5 条**保留**(用户同日裁定 20% 全团减伤,
  // 已进 MITIGATION_OVERRIDES,它是真墙)。
  const defensiveCds = cds.filter(
    (cd) =>
      DEFENSIVE_TAGS.has(cd.tag) &&
      !cd.isThroughput &&
      // 空放/攥着不放都是「你当时的选择」,被动触发的能力没有这个选择。
      !cdIsProcOnly(cd) &&
      !THROUGHPUT_EMPOWER_DEFENSIVE_IDS.has(cd.spellId),
  );
  const candidates: Array<{ cd: (typeof cds)[number]; t: number }> = [];
  for (const cd of defensiveCds) {
    for (const cast of cd.casts) {
      const t = toRenderSecond(cast.timeSeconds);
      if (probes.threatActiveAt(t)) continue;
      candidates.push({ cd, t });
    }
  }
  return candidates
    .sort((a, b) => a.t - b.t)
    .slice(0, cap)
    .map(({ cd, t }) => {
      const costNorm = costNormPhrase(cd.spellId);
      return {
        id: `cd-spent-idle:${owner.id}:${cd.spellId}:${t}`,
        type: "cd-spent-idle",
        t,
        unitNames: [owner.name],
        spell: cd.spellName,
        spellId: cd.spellId,
        facts: {
          t: String(t),
          spell: cd.spellName,
          unit: owner.name,
          ...(costNorm ? { costNorm } : {}),
        },
      };
    });
}
