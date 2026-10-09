import { ICombatUnit } from "@gladlog/parser-compat";

import { type BurstWindowDecisionPoint } from "../analysis/burstWindowDecisionPoints";
import type { CdPriorHoldEpisode } from "../analysis/cdTriggerPrior";
import type { StackedDefensivePair } from "../analysis/stackedDefensives";
import "../data/backlashCc";
import "../data/castEffectAuras";
import "../data/racialAbilities";
import {
  HIGH_VALUE_PURGEABLE_BUFFS,
  PURGE_WHITELIST_DATA_BLOCKED,
} from "../data/purgeWhitelist";
import "../data/spellEffectData";
import { ccSpellIds } from "../data/spellTags";
import "../utils/auraIntervals";
import "../utils/buffDuration";
import "../utils/cannotCastIntervals";
import "../utils/castCommitSpans";
import type { ICcBreakEvent } from "../utils/ccBreakAnalysis";
import {
  findBrokenCC,
  findBrokenDisarm,
  IPlayerCCTrinketSummary,
} from "../utils/ccTrinketAnalysis";
import {
  IFormInterval,
  ISpiritOfRedemptionInterval,
  IStasisEvent,
} from "../utils/combatStates";
import {
  IDamageBucket,
  IMajorCooldownInfo,
  isHealerSpec,
} from "../utils/cooldowns";
import { getDampeningPercentage } from "../utils/dampening";
import { IDispelSummary } from "../utils/dispelAnalysis";
import { IOutgoingCCChain } from "../utils/drAnalysis";
import { IEnemyCDTimeline } from "../utils/enemyCDs";
import "../utils/enemyDefensives";
import "../utils/enemyInterrupts";
import "../utils/externalDamage";
import { IHealingGap } from "../utils/healingGaps";
import "../utils/incomingPressure";
import "../utils/rosterSide";
import type { RawStreams } from "../utils/rawStreams";
import "./resUtilityCds";
import "./spellOutcomeLines";
import "../utils/resourceAt";
import "../utils/summonReachability";
import "./burstAnswered";
import "./cdPrior";
import {
  emitDmgSpikeEntries,
  emitEnemyDeathEntries,
  emitFriendlyDeathEntries,
  emitRotPressureEntries,
} from "./matchTimelineSections";
import {
  PEAK_SPIKE_MARKERS,
  peakSpikeMarker,
  type PeakSpikePlacement,
  peakSpikePlacement,
} from "./peakSpikePlacement";
import "./resLedgerPrune";
import "./stackedDefensives";
import "./unitLabel";
export {
  PEAK_SPIKE_MARKERS,
  peakSpikeMarker,
  type PeakSpikePlacement,
  peakSpikePlacement,
};
import "./resourceSnapshot";
import "./timelineHelpers";
import { prepareAoeCcFolding } from "./timelineSections/aoeCcFolding";
import { emitBuffFadedEntries } from "./timelineSections/buffFaded";
import { emitCcBrokenEntries } from "./timelineSections/ccBroken";
import { emitCcCastEntries } from "./timelineSections/ccCast";
import { emitCcOnEnemyEntries } from "./timelineSections/ccOnEnemy";
import { emitCleanseEntries } from "./timelineSections/cleanse";
import {
  DR_CLASH_LEGEND,
  emitContextFactEntries,
} from "./timelineSections/contextFacts";
import type { DeferredSnapshot } from "./timelineSections/ctx";
import { emitDampeningEntries } from "./timelineSections/dampening";
import { emitEnemyBuffEntries } from "./timelineSections/enemyBuff";
import { emitEnemyCdEntries } from "./timelineSections/enemyCd";
import { emitEnemyDefEntries } from "./timelineSections/enemyDef";
import { emitEnemyHardCastEntries } from "./timelineSections/enemyHardCast";
import { formatTimeline } from "./timelineSections/formatTimeline";
import { emitHealerCastGapFillerEntries } from "./timelineSections/healerCastGapFiller";
import { emitHealerInactivityEntries } from "./timelineSections/healerInactivity";
import { emitKickEntries } from "./timelineSections/kick";
import { emitManaContextEntries } from "./timelineSections/manaContext";
import { emitMinorDispelEntries } from "./timelineSections/minorDispels";
import { emitOffensiveWindowEntries } from "./timelineSections/offensiveWindow";
import { emitOwnerCdEntries } from "./timelineSections/ownerCd";
import { prepareOwnerCdContext } from "./timelineSections/ownerCdSetup";
import { foldMissedPurges } from "./timelineSections/purgeFolding";
import { emitPurgeEntries } from "./timelineSections/purges";
import { resolveDeferredSnapshots } from "./timelineSections/resolveSnapshots";
import { prepareTimelineSetup } from "./timelineSections/setup";
import { emitGripEntries } from "./timelineSections/grip";
import { emitSilenceEntries } from "./timelineSections/silence";
import { emitSpellOutcomeEntries } from "./timelineSections/spellOutcomes";
import { emitStasisEntries } from "./timelineSections/stasis";
import { emitStateEntries } from "./timelineSections/state";
import { prepareStateInputs } from "./timelineSections/stateInputs";
import { emitTeamCdEntries } from "./timelineSections/teamCd";
import { emitTrinketCcOnTeamEntries } from "./timelineSections/trinketCcOnTeam";
import { emitUnitDestroyedEntries } from "./timelineSections/unitDestroyed";
import "../utils/spellMechanics";

// ── buildMatchTimeline ─────────────────────────────────────────────────────

// [DR CLASH] legend: moved to timelineSections/contextFacts.ts with its section
// (GH #116); re-exported here for existing importers.
export { DR_CLASH_LEGEND };

export interface BuildMatchTimelineParams {
  owner: ICombatUnit;
  ownerSpec: string;
  ownerCDs: IMajorCooldownInfo[];
  teammateCDs: Array<{
    player: ICombatUnit;
    spec: string;
    cds: IMajorCooldownInfo[];
  }>;
  enemyCDTimeline: IEnemyCDTimeline;
  ccTrinketSummaries: IPlayerCCTrinketSummary[];
  dispelSummary: IDispelSummary;
  /** Enemy-side dispels (them cleansing their own teammates — our CC/dots removed; 2026-07-18 coverage fix). */
  enemyDispelSummary?: IDispelSummary;
  /** Per-enemy CC-received summaries (our CC landing on enemies; the owner's already have cast lines, skipped at render). */
  enemyCCSummaries?: IPlayerCCTrinketSummary[];
  /** Owner CC instances whose [CC ON ENEMY] line is kept even when the spell
   * has a [YOU] [CC] cast line — the QUICK FOLLOW-UPS evidence (GH #69). */
  keepOwnerCcOnEnemy?: ReadonlyArray<{
    targetName: string;
    spellId: string;
    ccAtS: number;
  }>;
  /** BACKLOG #36(e): our side's squandered CC breaks (our damage broke CC we
   * had landed on an enemy, with meaningful time remaining). Source:
   * `analyzeCcBreaks(...).friendlySquander` — already filtered by
   * CC_BREAK_REPORT_MIN_REMAINING_S, so every entry here is worth a line. */
  ccBreakEvents?: ICcBreakEvent[];
  friendlyDeaths: Array<{
    spec: string;
    name: string;
    atSeconds: number;
    note?: string;
  }>;
  enemyDeaths: Array<{ spec: string; name: string; atSeconds: number }>;
  pressureWindows: IDamageBucket[];
  healingGaps: IHealingGap[];
  friends: ICombatUnit[];
  /**
   * Enemy player units. When provided, their HP is included in [STATE] ticks
   * alongside friendly HP, referenced by enemyPid() numeric ID.
   */
  enemies?: ICombatUnit[];
  matchStartMs: number;
  matchEndMs: number;
  isHealer: boolean;
  /**
   * Arena bracket string (e.g. '3v3', '2v2'). When provided, final dampening %
   * is included in the [MATCH END] block.
   */
  bracket?: string;
  /**
   * Friendly player name → numeric ID mapping from buildPlayerLoadout.
   * When provided, friendly names are compressed to short IDs in the timeline.
   */
  playerIdMap?: Map<string, number>;
  /**
   * Enemy player name → numeric ID mapping from buildPlayerLoadout.
   * Required alongside playerIdMap to avoid collision when a friendly and enemy
   * share the same display name.
   */
  enemyIdMap?: Map<string, number>;
  /**
   * AoE CC chains cast by friendly players on enemies. When provided,
   * AoE targets fold into the friendly cast line, or [CC CAST] events
   * are emitted if no matching cast line exists.
   */
  outgoingCCChains?: IOutgoingCCChain[];
  /** The round's raw.txt pass — the mana fallback for units whose advanced
   * samples carry no powers (documents stored before 2026-08-23; reliability
   * audit D2). Absent → advanced samples only. */
  rawStreams?: RawStreams;
  allUnits?: ICombatUnit[];
  /** Arena zone id — the line-of-sight check of `summonReach` needs the map. */
  zoneId?: string;
  stasisEvents?: IStasisEvent[];
  shapeshiftIntervals?: Array<{
    player: ICombatUnit;
    intervals: IFormInterval[];
  }>;
  spiritOfRedemptionIntervals?: Array<{
    player: ICombatUnit;
    intervals: ISpiritOfRedemptionInterval[];
  }>;
  /**
   * Critical-window second set — built by buildMatchContext via buildCriticalWindowSet and passed in.
   * **Required and deliberately not built here**: every HP consumer (STATE / DMG SPIKE / CD / death blocks)
   * must share the same set to get the same sampling radius; see criticalWindows.ts.
   */
  criticalWindowSeconds: ReadonlySet<number>;
  /**
   * Triage 2026-09-29 H18: every friendly's `crisisDecisionPoints` anchor
   * second (the second a cd-hoarded / crisis-no-response line cites, built by
   * buildMatchContext from the same function). A [STATE] tick is always
   * emitted there — outside a critical window too, and exempt from the gap
   * and 10-point rules like any key moment — so the cited `crisisHpPct` has
   * its own tick (it is the same `gridHpPct` reading by construction).
   * Before: 16 of 28 cd-hoarded lines in the 60 HEAD prompts (14 of 28 on
   * re-parsed data) had no same-second [STATE].
   */
  crisisAnchorSeconds?: ReadonlySet<number>;
  /**
   * Triage 2026-09-29 H19: the windows a cd-hoarded line judges
   * ([t, t + CD_HOARD_RESPONSE_S] on each dangerous, not-CC'd crisis point,
   * built by buildMatchContext). The healer gap-filler never folds the
   * owner's casts on that unit inside them — up to DEATH_WINDOW_UNFOLD_CAP per
   * window, the friendly-death unfold's budget — so "held" cannot read as
   * "did nothing for them" when the heals went there.
   */
  crisisUnfoldWindows?: ReadonlyArray<{
    unitName: string;
    fromSeconds: number;
    toSeconds: number;
  }>;
  /**
   * Mitigation audit / counterfactual (#17b Task4): passed through verbatim to
   * emitFriendlyDeathEntries — wired by buildMatchContext, which consumes the three
   * functions from Task1 counterfactual.ts and formats the wording. Optional; emits no
   * lines when absent. **Must take atSeconds** — looking up by victimName alone would
   * render both deaths of a twice-dying player with the first death's numbers.
   */
  counterfactualOf?: (
    victimName: string,
    atSeconds: number,
  ) => {
    auditLines: string[];
    decisiveLines: string[];
  };
  /**
   * Bounded enemy burst windows (`burstWindowDecisionPoints`), passed in by
   * buildMatchContext rather than derived here — this file has no `combat`,
   * and re-deriving them would fork the definition of "a burst window" away
   * from the one the `slow-defensive-response` candidate and the corpus
   * reference table share. Feeds the `[BURST ANSWERED]` context lines
   * (`context/burstAnswered.ts`); absent ⇒ no such lines and no legend.
   */
  burstWindows?: BurstWindowDecisionPoint[];
  /** [CD PRIOR] hold episodes (context/cdPrior.ts) + the cohort they were
   * looked up under; computed in buildMatchContext (it has `combat`), rendered
   * here so the lines share the time-sorted stream. */
  cdPriorEpisodes?: CdPriorHoldEpisode[];
  cdPriorCohort?: { spec: string; heroTree: string };
  /** [STACKED DEFENSIVES] pairs (context/stackedDefensives.ts, GH #95) —
   * computed in buildMatchContext, rendered here into the time-sorted
   * stream; absent ⇒ no such lines and no legend. */
  stackedDefensives?: StackedDefensivePair[];
}

// The purge whitelist and its data-blocked twin live in data/purgeWhitelist.ts
// (GH #116); re-exported here for existing importers.
export { HIGH_VALUE_PURGEABLE_BUFFS, PURGE_WHITELIST_DATA_BLOCKED };

export function buildMatchTimeline(params: BuildMatchTimelineParams): string {
  const {
    owner,
    ownerSpec,
    ownerCDs,
    teammateCDs,
    enemyCDTimeline,
    ccTrinketSummaries,
    dispelSummary,
    enemyDispelSummary,
    enemyCCSummaries,
    friendlyDeaths,
    enemyDeaths,
    pressureWindows,
    healingGaps,
    friends,
    enemies,
    allUnits,
    matchStartMs,
    matchEndMs,
    isHealer,
    playerIdMap,
    enemyIdMap,
    outgoingCCChains,
    bracket,
    stasisEvents,
    shapeshiftIntervals,
    spiritOfRedemptionIntervals,
    criticalWindowSet,
    crisisAnchorSeconds,
    counterfactualOf,
    burstWindows,
    cdPriorEpisodes,
    cdPriorCohort,
    stackedDefensives,
    rawStreams,
    allPlayers,
    manaFallback,
    matchDurationS,
    enemyBuffIntervals,
    _allUnits,
    summonOwners,
    rosterSides,
    unitNames,
    manaCooldownNote,
    groundingAbsorbNote,
    pid,
    avoidanceSourceTag,
    friendlyPid,
    enemyPid,
    actorLabel,
    resolveTarget,
    enemyCcDrTag,
    outgoingDrTag,
    ownerCcImmuneTag,
    ccImmuneTagFor,
    ownerCcMissTag,
    ownerNoCcAuraTag,
    ccMissTagFor,
    ownerEmpowerTag,
    getCDTargetAndVelocityPart,
    snapshotFn,
    resOwnerCDs,
    matchEndSeconds,
    roundBounds,
    requestSnapshotPlaceholder,
  } = prepareTimelineSetup({
    params,
  });

  // ── GH #99 item 3 (Rule A): AoE CC folding into friendly cast lines ─────────
  const {
    aoeCCEvents,
    consumedAoeEvents,
    findAndConsumeAoeCC,
    formatAoeTargetPart,
  } = prepareAoeCcFolding({
    outgoingCCChains,
    owner,
    pid,
    enemyPid,
  });

  const entries: Array<{
    timeSeconds: number;
    lines: (string | DeferredSnapshot)[];
  }> = [];

  /** Adds a timeline entry; false when it was skipped (past the match
   * end), so a legend counter counts only lines that print. */
  function addEntry(
    timeSeconds: number,
    ...lines: (string | DeferredSnapshot)[]
  ): boolean {
    // B103: skip events that fall past match end — they're irrelevant post-game
    // and would appear with timestamps after [MATCH END] confusing the timeline.
    if (timeSeconds > matchEndSeconds) return false;

    entries.push({ timeSeconds, lines: lines.filter(Boolean) });
    return true;
  }

  // ── Dampening Milestone Alerts (F149) ──────────────────────────────────────
  emitDampeningEntries({
    bracket,
    allPlayers,
    matchStartMs,
    addEntry,
  });

  // ── Rot Pressure Detection (F147) ──────────────────────────────────────────
  emitRotPressureEntries({
    allPlayers,
    matchStartMs,
    matchEndMs,
    matchDurationS,
    pid,
    addEntry,
  });

  // ── [OFFENSIVE WINDOW] synthesized headers ─────────────────────────────────

  emitOffensiveWindowEntries({
    enemyCDTimeline,
    pressureWindows,
    addEntry,
    pid,
    requestSnapshotPlaceholder,
  });

  // ── [DEATH] events ────────────────────────────────────────────────────────

  const unitsByName = new Map(
    [...friends, ...(enemies ?? [])].map((u) => [u.name, u]),
  );

  emitFriendlyDeathEntries({
    friendlyDeaths,
    unitsByName,
    ccTrinketSummaries,
    owner,
    ownerCDs,
    teammateCDs,
    enemies: enemies ?? [],
    matchStartMs,
    pid,
    playerIdMap,
    enemyIdMap,
    summonOwners,
    unitNames,
    rosterSides,
    counterfactualOf,
    dampeningAt: (atSeconds) =>
      getDampeningPercentage(
        params.bracket ?? "3v3",
        _allUnits,
        matchStartMs + atSeconds * 1000,
      ),
    requestSnapshotPlaceholder,
    addEntry,
  });

  emitEnemyDeathEntries({
    enemyDeaths,
    unitsByName,
    matchStartMs,
    enemyPid,
    playerIdMap,
    enemyIdMap,
    summonOwners,
    unitNames,
    rosterSides,
    dampeningAt: (atSeconds) =>
      getDampeningPercentage(
        params.bracket ?? "3v3",
        _allUnits,
        matchStartMs + atSeconds * 1000,
      ),
    requestSnapshotPlaceholder,
    addEntry,
  });

  // ── [UNIT DESTROYED] Non-Player Deaths ────────────────────────────────────

  // Keyed on nonPlayerUnitKill, not on deathRecords: 12.x logs write no
  // UNIT_DIED for totems/guardians, so the deathRecords form of this block
  // rendered 24 lines in 3,520 prompts — every one Xuen or Darkglare, zero
  // totems (GH #100; user ruling 2026-09-20: restore it, Grounding included).
  emitUnitDestroyedEntries({
    allUnits,
    matchEndMs,
    matchStartMs,
    enemyPid,
    friends,
    pid,
    enemies,
    params,
    addEntry,
    playerIdMap,
    enemyIdMap,
    summonOwners,
    unitNames,
    rosterSides,
  });

  // ── [YOU] [CD] events ───────────────────────────────────────────────────────
  // Set when any owner / teammate proc-only activation was rendered as [PROC];
  // the legend line explaining the tag is emitted only then.
  let procLinesEmitted = false;

  const {
    healingEmissionTimes,
    cdExpiryEvents,
    ownerCCSummary,
    ownerHardCcTagAt,
    ownerStunnedAtCast,
    ownerStunIdsAtCast,
    ownerInterruptImmuneReasonAt,
  } = prepareOwnerCdContext({
    ownerCDs,
    owner,
    matchStartMs,
    friends,
    ccTrinketSummaries,
    matchEndMs,
  });

  ({ procLinesEmitted } = emitOwnerCdEntries({
    ownerCDs,
    procLinesEmitted,
    getCDTargetAndVelocityPart,
    requestSnapshotPlaceholder,
    healingEmissionTimes,
    owner,
    matchStartMs,
    manaCooldownNote,
    findAndConsumeAoeCC,
    formatAoeTargetPart,
    outgoingDrTag,
    ownerCcImmuneTag,
    ownerCcMissTag,
    ownerNoCcAuraTag,
    ownerEmpowerTag,
    groundingAbsorbNote,
    params,
    _allUnits,
    pressureWindows,
    pid,
    cdExpiryEvents,
    ownerCCSummary,
    enemies,
    friends,
    summonOwners,
    ownerInterruptImmuneReasonAt,
    addEntry,
    ownerHardCcTagAt,
    ownerStunnedAtCast,
    ownerStunIdsAtCast,
  }));

  // ── [BUFF FADED] events (F70, B31: renamed from [CD EXPIRED]) ──────────────
  emitBuffFadedEntries({
    cdExpiryEvents,
    addEntry,
    actorLabel,
  });

  // ── [YOU] [CAST] healer gap-filler (F61) ────────────────────────────────────

  if (isHealer)
    emitHealerCastGapFillerEntries({
      ownerCDs,
      matchStartMs,
      ccTrinketSummaries,
      owner,
      dispelSummary,
      addEntry,
      friendlyDeaths,
      _allUnits,
      stasisEvents,
      resolveTarget,
      ownerEmpowerTag,
      findAndConsumeAoeCC,
      formatAoeTargetPart,
      ownerCcImmuneTag,
      ownerCcMissTag,
      ownerNoCcAuraTag,
      requestSnapshotPlaceholder,
      getCDTargetAndVelocityPart,
      manaCooldownNote,
      groundingAbsorbNote,
      ownerHardCcTagAt,
      criticalWindowSet,
      crisisUnfoldWindows: params.crisisUnfoldWindows ?? [],
    });

  // ── [TEAM] [CD] events ────────────────────────────────────────────────────

  ({ procLinesEmitted } = emitTeamCdEntries({
    teammateCDs,
    procLinesEmitted,
    groundingAbsorbNote,
    enemyPid,
    findAndConsumeAoeCC,
    formatAoeTargetPart,
    pid,
    friendlyPid,
    ccImmuneTagFor,
    ccMissTagFor,
    addEntry,
    requestSnapshotPlaceholder,
    matchStartMs,
  }));

  // ── [CC CAST] events — AoE CC cast by friendly players on enemies ──────────

  emitCcCastEntries({
    aoeCCEvents,
    consumedAoeEvents,
    pid,
    enemyPid,
    addEntry,
  });

  // ── GH #99 item 3 (Rules B & C): ENEMY BUFF, ENEMY CD, and MISSED PURGE folding ──

  const {
    qualifyingMissedPurges,
    droppedBuffIntervals,
    buffPurgeAnnotations,
    cdPurgeAnnotations,
    consumedMissedPurges,
  } = foldMissedPurges({
    enemyPid,
    owner,
    dispelSummary,
    enemyBuffIntervals,
    enemyCDTimeline,
  });

  // ── [ENEMY BUFF] / [ENEMY BUFF END] events (F67b) ─────────────────────────

  emitEnemyBuffEntries({
    enemyBuffIntervals,
    droppedBuffIntervals,
    buffPurgeAnnotations,
    addEntry,
    enemyPid,
  });

  // ── [ENEMY CD] events ──────────────────────────────────────────────────────
  // B107: annotate each cast with a per-spell sequence index (e.g. `Bestial Wrath [2/4]`)
  // so the model can't collapse short-interval repeats of the same CD into one window.

  const enemyCdRender = emitEnemyCdEntries({
    enemyCDTimeline,
    cdPurgeAnnotations,
    addEntry,
    enemyPid,
    enemies,
    matchStartMs,
  });

  // ── [ENEMY DEF] events (GH #97, 2026-09-15) ────────────────────────────────
  // Enemy defensives used to exist only in the KILL ATTEMPTS summary
  // ("FAILED: popped Barkskin"), with no timestamped line — 13/50 Opus-
  // baseline judges, and the main reason sufficiency stopped at 4. The set is
  // the one killAttempts.ts attributes with (enemyDefensives.ts), the
  // duration is the OBSERVED aura interval (a static tooltip duration is
  // falsified by every dispel; agy round 1), and `— removed early` is the
  // coaching pivot. Separate tag on purpose: [ENEMY CD] feeds the burst-window
  // builder, and a wall must never read as an opener there.
  emitEnemyDefEntries({
    matchStartMs,
    matchEndSeconds,
    enemies,
    enemyPid,
    friends,
    roundBounds,
    pid,
    addEntry,
    _allUnits,
  });

  // ── F170: [ENEMY HARD CAST] — hard-cast kill spells (Chaos Bolt, Pyroblast) ─
  emitEnemyHardCastEntries({
    enemies,
    matchStartMs,
    matchEndSeconds,
    pid,
    addEntry,
    enemyPid,
  });

  // ── [CC BROKEN] — our damage breaking our own CC (#36(e)) ──────────────────
  // Corpus baseline (ccBreakAnalysis header): 6.14 breaks/round, and the
  // squander quadrant is ~48% of them — CC discipline is coachable, but the
  // prompt used to show the CC landing and then silently ending, so the model
  // could not tell "the sheep ran its course" from "your teammate cleaved it".
  emitCcBrokenEntries({
    params,
    addEntry,
    pid,
    enemyPid,
  });

  // ── [TRINKET] and [CC ON TEAM] events ──────────────────────────────────────

  // enemy-def F-E18: a press that broke a disarm (a loss of control the CC
  // windows do not hold) — the CC binder, asked of the disarm windows only
  // when no CC took the press (a CC-bound press says so on its [CC ON TEAM]
  // line). One reading for the [TRINKET] line and the [DISARM] tail (F-DA1).
  const trinketBrokenDisarm = (summary: IPlayerCCTrinketSummary, t: number) => {
    const rawCastMs = matchStartMs + Math.round(t * 1000);
    return findBrokenCC(summary.ccInstances, matchStartMs, rawCastMs)
      ? undefined
      : findBrokenDisarm(summary.disarmInstances, matchStartMs, rawCastMs);
  };
  let disarmLineCount = 0;
  let trinketLastUsedCount = 0;
  ({ disarmLineCount, trinketLastUsedCount } = emitTrinketCcOnTeamEntries({
    ccTrinketSummaries,
    trinketBrokenDisarm,
    actorLabel,
    addEntry,
    pid,
    disarmLineCount,
    trinketLastUsedCount,
    dispelSummary,
    matchStartMs,
    friends,
    avoidanceSourceTag,
  }));

  // ── [SILENCE]: silences on players (reliability round 2 W1b, 2026-09-25) ───
  // Garrote - Silence / Strangulate / Spider Venom are cast-blocking auras
  // (buildCannotCastIntervals already locks the unit for them) but not
  // `ccSpellIds`, so no [CC ON …] line ever showed them: 4 of 24 audited
  // matches had the log owner silenced with nothing in the prompt, and the
  // coach read the healer as free. Same predicate (`silenceIntervals`), both
  // sides; a PvP trinket pressed inside the silence that ended it is stated the
  // way the CC lines state it.
  // ── [GRIP]: an enemy Death Grip on our team (timelineSections/grip.ts) ────
  let gripLineCount = 0;
  ({ gripLineCount } = emitGripEntries({
    friends,
    enemies,
    matchStartMs,
    pid,
    actorLabel,
    addEntry,
    gripLineCount,
  }));

  let silenceLineCount = 0;
  ({ silenceLineCount } = emitSilenceEntries({
    allUnits,
    friends,
    enemies,
    ccTrinketSummaries,
    matchStartMs,
    matchEndMs,
    pid,
    enemyPid,
    actorLabel,
    addEntry,
    silenceLineCount,
  }));

  // ── [CC ON ENEMY]: our CC landing on enemies (2026-07-18 coverage fix) ─────
  // The owner's CC is skipped only when it already has a [YOU] [CC] cast line
  // (i.e. it is in the tracked-CD catalog) — CC with no tracked CD (Sap /
  // Cheap Shot / Gouge / Polymorph, …) rendered on neither path, which produced
  // a tail of 11 DPS-baseline matches with <80% CC coverage. Teammate/pet
  // sources are filled in as usual.
  const ownerRenderedCcIds = new Set(
    ownerCDs.filter((cd) => ccSpellIds.has(cd.spellId)).map((cd) => cd.spellId),
  );
  let enemyTrinketCount = 0;
  ({ enemyTrinketCount } = emitCcOnEnemyEntries({
    enemyCCSummaries,
    enemies,
    friends,
    matchStartMs,
    actorLabel,
    roundBounds,
    addEntry,
    enemyPid,
    enemyTrinketCount,
    matchEndSeconds,
    enemyDispelSummary,
    params,
    owner,
    ownerRenderedCcIds,
    enemyCcDrTag,
  }));

  // ── Spell outcomes the log records and the timeline did not state ─────────
  // User ruling 2026-09-26 (reliability round 3 N10 / N18, ASK-batch10 with
  // real examples): a control eaten by a Grounding Totem, a reflected spell
  // (controls always; damage spells only when they came back for real
  // damage), a control removed by Blessing of Sanctuary, and the owner's own
  // repeated rejections outside CC. Builders: spellOutcomeLines.ts.
  emitSpellOutcomeEntries({
    actorLabel,
    owner,
    _allUnits,
    matchEndSeconds,
    matchStartMs,
    friends,
    enemies,
    pid,
    enemyPid,
    addEntry,
    rawStreams,
  });

  // ── [UNCLEANSED DEBUFF] and [CLEANSE] events ──────────────────────────────────

  emitCleanseEntries({
    dispelSummary,
    owner,
    addEntry,
    pid,
    qualifyingMissedPurges,
    consumedMissedPurges,
    enemyPid,
    enemies,
    matchStartMs,
  });

  // ── [PURGE] / [ENEMY PURGE] events (T5 dispel coverage) ───────────────────
  // Teammates' offensive purges and enemies stripping our buffs were previously
  // invisible; same F163 de-noising as [CLEANSE] (Critical/High only) and the
  // same B14 same-second same-source merge. The owner's own purges already
  // annotated on a healer owner's cast line ([removed: …]) are not repeated
  // (F-P1: only those).
  emitPurgeEntries({
    dispelSummary,
    owner,
    enemyPid,
    addEntry,
    pid,
    enemyDispelSummary,
    isHealer,
    matchStartMs,
  });

  // ── [MINOR DISPELS] folded lines (T5 dispel coverage) ─────────────────────
  // low/medium dispels filtered out by F163 do not get one timeline line each,
  // but are folded by (source, dispel spell) into a single counted line — the
  // dispel workload and the spells used stay visible to the coach at a token
  // cost of O(number of distinct spells).
  emitMinorDispelEntries({
    dispelSummary,
    pid,
    enemyPid,
    enemyDispelSummary,
    addEntry,
  });

  // ── [KICK] events ───────────────────────────────────────────────────────────
  // F20 pilot: landed SPELL_INTERRUPT events from either team. Availability notes
  // ("enemy interrupts UP") tell the model what *could* be kicked, but without
  // these lines every successful kick — including ones that decided a death — is
  // invisible in the timeline.
  emitKickEntries({
    friends,
    enemies,
    pid,
    enemyPid,
    allUnits,
    matchStartMs,
    addEntry,
    _allUnits,
    matchEndMs,
    owner,
  });

  // ── [DMG SPIKE] events ─────────────────────────────────────────────────────

  emitDmgSpikeEntries({
    pressureWindows,
    friends,
    matchStartMs,
    pid,
    playerIdMap,
    enemyIdMap,
    summonOwners,
    unitNames,
    rosterSides,
    // 敌方 CC 掩护标注的数据源 —— 与本文件 [CC ON TEAM] 行同一个数组对象
    ccTrinketSummaries,
    ownerName: owner.name,
    healerNames: friends.filter((f) => isHealerSpec(f.spec)).map((f) => f.name),
    addEntry,
  });

  // ── Context fact lines ([BURST ANSWERED], [CD PRIOR], [STACKED DEFENSIVES], [DR CLASH])
  const {
    burstAnsweredEntries,
    cdPriorEntries,
    stackedDefensiveEntries,
    drClashEntries,
  } = emitContextFactEntries({
    burstWindows,
    matchEndSeconds,
    addEntry,
    cdPriorCohort,
    cdPriorEpisodes,
    stackedDefensives,
    outgoingCCChains,
    matchStartMs,
    owner,
    pid,
  });

  // ── [HEALER INACTIVITY] events (healer only) ────────────────────────────────────

  emitHealerInactivityEntries({
    isHealer,
    healingGaps,
    addEntry,
    pid,
    owner,
  });

  const {
    keyMomentSeconds,
    friendlyHpUnits,
    enemyHpUnits,
    friendlyDeathAtByName,
    enemyDeathAtByName,
  } = prepareStateInputs({
    friendlyDeaths,
    enemyDeaths,
    ownerCDs,
    teammateCDs,
    enemyCDTimeline,
    ccTrinketSummaries,
    pressureWindows,
    dispelSummary,
    owner,
    outgoingCCChains,
    playerIdMap,
    friends,
    pid,
    enemyIdMap,
    enemies,
    enemyPid,
  });

  emitStateEntries({
    matchDurationS,
    matchStartMs,
    friendlyHpUnits,
    spiritOfRedemptionIntervals,
    criticalWindowSet,
    enemyHpUnits,
    crisisAnchorSeconds,
    keyMomentSeconds,
    addEntry,
  });

  // 8.5 Add Mana Context for long matches (F144)
  emitManaContextEntries({
    matchDurationS,
    owner,
    friends,
    enemies,
    matchStartMs,
    friendlyDeathAtByName,
    enemyDeathAtByName,
    pid,
    enemyPid,
    addEntry,
    manaFallback,
  });

  // 10. Process Stasis Events
  emitStasisEntries({
    stasisEvents,
    addEntry,
  });

  // Precompute snapshots chronologically, then mutate entries in-place
  const { resOutOfReachRows } = resolveDeferredSnapshots({
    entries,
    teammateCDs,
    playerIdMap,
    matchStartMs,
    owner,
    resOwnerCDs,
    snapshotFn,
    ownerSpec,
    ccTrinketSummaries,
    enemyCDTimeline,
    rosterSides,
    manaFallback,
    roundBounds,
  });

  // ── Sort and format (timelineSections/formatTimeline.ts) ─────────────────
  return formatTimeline({
    entries,
    shapeshiftIntervals,
    owner,
    pid,
    silenceLineCount,
    disarmLineCount,
    trinketLastUsedCount,
    gripLineCount,
    resOutOfReachRows,
    enemyTrinketCount,
    enemyCdRender,
    isHealer,
    burstAnsweredEntries,
    cdPriorEntries,
    stackedDefensiveEntries,
    drClashEntries,
    procLinesEmitted,
    ownerSpec,
    matchStartMs,
    matchEndSeconds,
    friends,
    enemies,
    ownerCDs,
    teammateCDs,
    enemyCDTimeline,
    ccTrinketSummaries,
    friendlyDeaths,
    enemyDeaths,
    actorLabel,
    playerIdMap,
    enemyIdMap,
    summonOwners,
    unitNames,
    rosterSides,
    allUnits,
    matchEndMs,
    bracket,
    enemyPid,
  });
}
