import {
  CombatUnitReaction,
  CombatUnitType,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { type BurstWindowDecisionPoint } from "../analysis/burstWindowDecisionPoints";
import type { CdPriorHoldEpisode } from "../analysis/cdTriggerPrior";
import type { StackedDefensivePair } from "../analysis/stackedDefensives";
import "../data/backlashCc";
import { castAndEffectIds } from "../data/castEffectAuras";
import "../data/racialAbilities";
import {
  HIGH_VALUE_PURGEABLE_BUFFS,
  PURGE_WHITELIST_DATA_BLOCKED,
} from "../data/purgeWhitelist";
import { getEnglishSpellName } from "../data/spellEffectData";
import { ccSpellIds } from "../data/spellTags";
import "../data/timelineLineFlags";
import "../utils/auraIntervals";
import { buffFullDurationForCaster } from "../utils/buffDuration";
import "../utils/cannotCastIntervals";
import {
  EMPOWER_PRESS_MATCH_MS,
  empowerSpans,
} from "../utils/castCommitSpans";
import type { ICcBreakEvent } from "../utils/ccBreakAnalysis";
import {
  CC_AVOIDANCE_BUFF_SPELLS,
  findBrokenCC,
  findBrokenDisarm,
  GROUNDING_TOTEM_SPELL_ID,
  GROUNDING_TOTEM_WINDOW_S,
  IPlayerCCTrinketSummary,
} from "../utils/ccTrinketAnalysis";
import {
  IFormInterval,
  ISpiritOfRedemptionInterval,
  IStasisEvent,
} from "../utils/combatStates";
import {
  getUnitHpAtTimestamp,
  HP_SAMPLE_RADIUS_MS,
  hpAtPress,
  IDamageBucket,
  IMajorCooldownInfo,
  isHealerSpec,
  isTeamHealCD,
  specToString,
} from "../utils/cooldowns";
import { getDampeningPercentage } from "../utils/dampening";
import {
  canRemoveFrom,
  IDispelSummary,
} from "../utils/dispelAnalysis";
import {
  extractAoeCCEvents,
  IOutgoingCCChain,
} from "../utils/drAnalysis";
import { IEnemyCDTimeline } from "../utils/enemyCDs";
import "../utils/enemyDefensives";
import "../utils/enemyInterrupts";
import "../utils/externalDamage";
import { IHealingGap } from "../utils/healingGaps";
import { sumIncomingPressure } from "../utils/incomingPressure";
import { buildRosterSides } from "../utils/rosterSide";
import "../utils/pvpTrinketUses";
import type { RawStreams } from "../utils/rawStreams";
import { ownerResUtilityCds } from "./resUtilityCds";
import "./spellOutcomeLines";
import { fmtTime, toRenderSecond } from "../utils/renderGrid";
import { resourceDeltaPct } from "../utils/resourceAt";
import "../utils/summonReachability";
import "../utils/talentBehaviors";
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
import { abbrevSpec } from "./unitLabel";
export {
  PEAK_SPIKE_MARKERS,
  peakSpikeMarker,
  type PeakSpikePlacement,
  peakSpikePlacement,
};
import { buildResourceSnapshot } from "./resourceSnapshot";
import {
  buildSummonOwnerNames,
  CRITICAL_NON_PLAYER_NPC_NAMES,
  DMG_SPIKE_THRESHOLD,
  extractEnemyMajorBuffIntervals,
  getNpcIdFromGuid,
  GROUNDING_TOTEM_NPC_ID,
  MANA_COOLDOWN_SPELL_IDS,
  resolveSummonOwner,
} from "./timelineHelpers";
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
import { emitKickEntries } from "./timelineSections/kick";
import { emitManaContextEntries } from "./timelineSections/manaContext";
import { emitMinorDispelEntries } from "./timelineSections/minorDispels";
import { emitOffensiveWindowEntries } from "./timelineSections/offensiveWindow";
import { emitOwnerCdEntries } from "./timelineSections/ownerCd";
import { prepareOwnerCdContext } from "./timelineSections/ownerCdSetup";
import { foldMissedPurges } from "./timelineSections/purgeFolding";
import { emitPurgeEntries } from "./timelineSections/purges";
import { resolveDeferredSnapshots } from "./timelineSections/resolveSnapshots";
import { emitSilenceEntries } from "./timelineSections/silence";
import { emitSpellOutcomeEntries } from "./timelineSections/spellOutcomes";
import { emitStasisEntries } from "./timelineSections/stasis";
import { emitStateEntries } from "./timelineSections/state";
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
    stasisEvents = [],
    shapeshiftIntervals = [],
    spiritOfRedemptionIntervals = [],
    criticalWindowSeconds: criticalWindowSet,
    crisisAnchorSeconds,
    counterfactualOf,
    burstWindows,
    cdPriorEpisodes,
    cdPriorCohort,
    stackedDefensives,
    rawStreams,
  } = params;
  const manaFallback = { rawStreams, matchStartMs };

  const matchDurationS = (matchEndMs - matchStartMs) / 1000;
  const enemyBuffIntervals = extractEnemyMajorBuffIntervals(
    enemies ?? [],
    matchStartMs,
    matchEndMs,
  );

  const _allUnits = allUnits ?? [...friends, ...(enemies ?? [])];
  // summon GUID → owner name: damage-source labels name a pet / guardian
  // through its owner (reliability round 3, f4da).
  const summonOwners = buildSummonOwnerNames(_allUnits);
  // unit GUID → roster side: "same team" is a roster fact, not the event's
  // reaction flags, which flip while someone is charmed (death-kill F-T1)
  const rosterSides = buildRosterSides(_allUnits);
  const unitNames = new Map(_allUnits.map((u) => [u.id, u.name]));

  // criticalWindowSet is built by the caller (buildMatchContext) via
  // buildCriticalWindowSet and passed in — deliberately not built here, or the
  // [CD] / death blocks would not share the same set.

  // F143: Pre-calculate Grounding Totem absorbs.
  // A SPELL_ABSORBED event's own spellId is the SHIELD (Grounding Totem
  // itself); the note used to print that, so once it rendered at all it read
  // `[ABSORBED: Grounding Totem]` on 277 of 298 lines (GH #100). The eaten
  // spell is the ATTACKER's, which the parser materialises as
  // `attackSpellId/Name` since 2026-09-20 (user: "even if we don't use it, we
  // should know what the totem ate"). Documents stored before that do not
  // carry it — the archive slimmer had cleared those params — so the note
  // falls back to naming the caster only. A totem killed by direct damage is a
  // different fact with its own `[UNIT DESTROYED]` line: a final blow is NOT
  // an eaten spell.
  const groundingAbsorbs: Array<{
    timeSeconds: number;
    attackerId: string;
    /** English name of the eaten spell; undefined on pre-2026-09-20 documents */
    spellName?: string;
    totemOwnerId: string;
  }> = [];
  if (allUnits) {
    for (const unit of allUnits) {
      const npcId = getNpcIdFromGuid(unit.id);
      if (
        (npcId === GROUNDING_TOTEM_NPC_ID ||
          unit.name.toLowerCase().includes("grounding totem")) &&
        unit.ownerId
      ) {
        for (const absorb of unit.absorbsIn) {
          if (!absorb.attackerId) continue;
          let spellName: string | undefined;
          if (absorb.attackSpellId) {
            const raw = getEnglishSpellName(
              absorb.attackSpellId,
              absorb.attackSpellName?.trim() || null,
            );
            spellName =
              raw.trim() ||
              absorb.attackSpellName?.trim() ||
              absorb.attackSpellId;
          } else if (absorb.attackSpellName?.trim()) {
            spellName = absorb.attackSpellName.trim();
          }
          groundingAbsorbs.push({
            timeSeconds: (absorb.timestamp - matchStartMs) / 1000,
            attackerId: absorb.attackerId,
            ...(spellName ? { spellName } : {}),
            totemOwnerId: unit.ownerId,
          });
        }
      }
    }
  }

  /**
   * A mana cooldown is answered with resource, not throughput. Innervate sat in
   * HEALING_AMPLIFIER_SPELL_IDS until 2026-08-23 and got the HPS/overheal
   * block, whose cast ranking (`overhealPct*1000 - maxBucketHps`) surfaced the
   * WORST-scoring cast — teaching the model that low HPS during Innervate is
   * the mistake, when low HPS is exactly when a healer drinks. Measured on 200
   * archive files: it ticks mana back (SPELL_PERIODIC_ENERGIZE, 258 hits) and
   * the target's mana rises in 55 of 58 windows (0 fell, median +9.5pp).
   *
   * Shared by BOTH emitters of `[YOU] [CD]`: the ownerCDs ledger loop and the
   * B38 promotion path further down. Innervate is normally ABSENT from
   * `extractMajorCooldowns`, so production renders it through the promotion
   * path — wiring only the ledger loop produced a line that passed its unit
   * test and never once appeared on a real match.
   */
  function manaCooldownNote(
    spellId: string,
    timeSeconds: number,
    targetName: string | undefined,
  ): string | null {
    if (!MANA_COOLDOWN_SPELL_IDS.has(spellId)) return null;
    // Caster-aware: the owner cast it, so their talents price its length.
    const duration = buffFullDurationForCaster(spellId, owner);
    if (!duration) return null;
    const target =
      (targetName
        ? allPlayers.find((u) => u.name === targetName)
        : undefined) ?? owner;
    const fromMs = matchStartMs + timeSeconds * 1000;
    const delta = resourceDeltaPct(
      target,
      fromMs,
      fromMs + duration * 1000,
      manaFallback,
    );
    const who = target.id === owner.id ? "self" : pid(target.name);
    return delta
      ? `      [MANA]       ${who}: ${delta.fromPct}% -> ${delta.toPct}% mana (${delta.deltaPct >= 0 ? "+" : ""}${delta.deltaPct}pp over ${duration}s)`
      : `      [MANA]       ${who}: no resource reading in this window`;
  }

  const groundingAbsorbNote = (
    spellId: string,
    spellName: string,
    totemOwnerId: string,
    castSeconds: number,
  ): string => {
    if (spellId !== GROUNDING_TOTEM_SPELL_ID && spellName !== "Grounding Totem")
      return "";
    const eaten = groundingAbsorbs.filter(
      (a) =>
        a.totemOwnerId === totemOwnerId &&
        a.timeSeconds >= castSeconds &&
        a.timeSeconds <= castSeconds + GROUNDING_TOTEM_WINDOW_S,
    );
    if (eaten.length === 0) return "";
    const ownerIsFriendly = friends.some((f) => f.id === totemOwnerId);
    const casterOf = (attackerId: string): string => {
      const attacker = allUnits?.find((u) => u.id === attackerId);
      return attacker
        ? actorLabel(
            attacker.name,
            ownerIsFriendly ? "enemy" : "friendly",
            attacker.id,
          )
        : "unknown";
    };
    // Every eaten spell is known → name them; otherwise (an older stored
    // document) say only who cast them. Never a mix that reads as complete.
    if (eaten.every((a) => Boolean(a.spellName?.trim())))
      return ` [ABSORBED: ${Array.from(
        new Set(eaten.map((a) => `${a.spellName} (${casterOf(a.attackerId)})`)),
      ).join(", ")}]`;
    return ` [ABSORBED spells from: ${Array.from(
      new Set(eaten.map((a) => casterOf(a.attackerId))),
    ).join(", ")}]`;
  };

  // A/B cycle-1 accuracy regression fix: bare numeric ids forced the responder
  // to map unit identity itself across thousands of tokens; blind review showed
  // fine-grained misattribution (pets / unit HP / dispel direction crossed).
  // Inline a compact spec tag at every reference; same-spec twins are still
  // disambiguated by id. abbrevSpec is shared with observedConsequences.ts.
  const nameSpecTag = new Map<string, string>(
    [...friends, ...(enemies ?? [])].map((u) => [
      u.name,
      abbrevSpec(specToString(u.spec)),
    ]),
  );
  function tagFor(name: string): string {
    const tag = nameSpecTag.get(name);
    return tag ? `(${tag})` : "";
  }

  /**
   * Returns the short numeric ID for a friendly player name, or the raw name
   * if no mapping exists.  Enemy names must be resolved via enemyPid() to avoid
   * ID collision when a friendly and enemy share a display name.
   */
  function pid(name: string): string {
    if (!playerIdMap) return name.split("-")[0];
    const id = playerIdMap.get(name) ?? playerIdMap.get(name.split("-")[0]);
    return id !== undefined ? `${id}${tagFor(name)}` : name.split("-")[0];
  }

  /** GH #103 A6: who provided the avoidance aura on a `[CC AVOIDED?]` line —
   * `(own)` for the CC'd player's own, `(from <pid>)` for a teammate's (the
   * responder wrote "your Grounding" for a totem the other shaman dropped).
   * Empty when unknown (mobility avoidance, aura up at log start). */
  function avoidanceSourceTag(
    sourceName: string | undefined,
    targetName: string,
  ): string {
    if (!sourceName) return "";
    return sourceName === targetName ? " (own)" : ` (from ${pid(sourceName)})`;
  }

  /** Returns the short numeric ID for an *enemy* player name, falling back to name. */
  /** crisis-external F-T1: the friendly player's pid, or undefined for a name
   * that is no friendly player (a pet, an NPC, an enemy) — `pid` falls back
   * to the raw name and cannot tell. `playerIdMap` holds the friendly
   * players, owner included. */
  function friendlyPid(name: string): string | undefined {
    if (!playerIdMap) return undefined;
    const id = playerIdMap.get(name) ?? playerIdMap.get(name.split("-")[0]);
    return id !== undefined ? `${id}${tagFor(name)}` : undefined;
  }

  function enemyPid(name: string): string {
    if (!enemyIdMap) return name.split("-")[0];
    const id = enemyIdMap.get(name) ?? enemyIdMap.get(name.split("-")[0]);
    return id !== undefined ? `${id}${tagFor(name)}` : name.split("-")[0];
  }

  /**
   * Caster label (used by the "(by X)" part of CC lines): player → pid/enemyPid;
   * pet → owner's label + "'s pet"; a localized name with no resolvable owner
   * (CJK pet names etc.) → "[pet]".
   * Same rule as resolveKicker on [KICK] lines — 2026-07-17 thousand-match fuzz:
   * hunter pet Intimidation leaked a CJK pet name in "(by …)" ×72.
   */
  function actorLabel(
    name: string,
    side: "friendly" | "enemy",
    sourceId?: string,
  ): string {
    const primary = side === "friendly" ? pid(name) : enemyPid(name);
    if (/^\d/.test(primary)) return primary; // hit the player map (player names never start with a digit)
    // GH #99: resolve the summon by the event's OWN source GUID. Matching on
    // the NAME collided whenever both teams fielded a same-named summon (two
    // shamans → two units called "Capacitor Totem"): `find` returned whichever
    // one the unit table held first, so 48 lines of the 2026-09-15 baseline
    // credited the wrong side — including `3(EShaman) ← Capacitor Totem (by
    // 3(EShaman)'s pet)`, a teammate rendered as stunning his own team. The id
    // is ground truth, so the owner it resolves to wins over the caller's
    // `side`; `side` now only narrows the name fallback used by documents that
    // carry no source id.
    const ownerUnit = resolveSummonOwner({
      allUnits,
      friends,
      enemies,
      name,
      sourceId,
      side,
    });
    if (ownerUnit) {
      const label = friends.some((f) => f.id === ownerUnit.id)
        ? pid(ownerUnit.name)
        : enemyPid(ownerUnit.name);
      return `${label}'s pet`;
    }
    const short = name.split("-")[0];
    return [...short].some((c) => c.charCodeAt(0) > 127) ? "[pet]" : short;
  }

  /**
   * Resolves a cast's destUnitName to a display label for [YOU] [CAST] entries.
   * Returns "self" for self-casts, a numeric ID for known players, or the raw name.
   * Returns "" when destUnitName is empty (AoE spells with no specific log target).
   */
  function resolveTarget(destUnitName: string | null | undefined): string {
    if (!destUnitName || destUnitName === "nil") return "";
    const cleanDest = destUnitName.split("-")[0];
    const cleanOwner = owner.name.split("-")[0];
    if (destUnitName === owner.name || cleanDest === cleanOwner) return "self";
    if (playerIdMap) {
      const id = playerIdMap.get(destUnitName) ?? playerIdMap.get(cleanDest);
      if (id !== undefined) return String(id);
    }
    if (enemyIdMap) {
      const id = enemyIdMap.get(destUnitName) ?? enemyIdMap.get(cleanDest);
      if (id !== undefined) return String(id);
    }
    // Unmapped target = totem/pet/NPC (not one of the arena players, who are all
    // pid-mapped above). Its name comes from the log in the client's locale — do
    // not leak a localized (e.g. Chinese) unit name into an English prompt. Cast
    // lines tag [totem/pet] separately, so suppress the name here; ASCII names
    // (rare English-locale NPCs) still pass through unchanged.
    const isLocalized = [...cleanDest].some((ch) => ch.charCodeAt(0) > 127);
    if (isLocalized) return "";
    return cleanDest;
  }

  /**
   * DR state of a CC the player cast, **at the moment it lands**, rendered as
   * `[DR: category level]` — exactly the same format as [CC ON TEAM] (class F:
   * previously only received CC carried DR, outgoing CC did not).
   *
   * DR itself is not recomputed: read the drInfo already annotated by
   * analyzeOutgoingCCChains, so no second DR judgement exists (single-source
   * predicate). Matching is by spellId + landing second, compared on the render
   * grid (atSeconds in the chain is fractional, and so is cast.timeSeconds, so
   * floor both before comparing).
   */
  function enemyCcDrTag(
    targetName: string,
    spellId: string,
    atSeconds: number,
    sourceId: string | undefined,
    sourceName: string,
  ): string {
    const src = friends.find((f) => f.id === sourceId);
    const unit = src ?? allUnits?.find((u) => u.id === sourceId);
    const ownerOf = unit?.ownerId
      ? friends.find((f) => f.id === unit.ownerId)
      : undefined;
    const caster = src?.name ?? ownerOf?.name ?? sourceName;
    const t = toRenderSecond(atSeconds);
    for (const chain of outgoingCCChains ?? []) {
      if (chain.targetName !== targetName) continue;
      for (const app of chain.applications)
        if (
          app.spellId === spellId &&
          app.casterName === caster &&
          app.drInfo &&
          toRenderSecond(app.atSeconds) === t
        )
          return ` [DR: ${app.drInfo.category} ${app.drInfo.level}]`;
    }
    return "";
  }

  function outgoingDrTag(
    spellId: string,
    cast: { timeSeconds: number },
  ): string {
    // cc-dr F-AO1: every application of this spell by the OWNER at the
    // line's render second (an AoE lands on several enemies at different DR
    // levels; any caster's same spell used to match). One level → as before;
    // several → per target, labelled with `enemyPid` (the chain's targets are
    // enemies — codex c2 10-02).
    const t = toRenderSecond(cast.timeSeconds);
    const hits: Array<{ target: string; category: string; level: string }> =
      [];
    for (const chain of outgoingCCChains ?? []) {
      for (const app of chain.applications) {
        if (app.spellId !== spellId) continue;
        if (toRenderSecond(app.atSeconds) !== t) continue;
        if (!app.drInfo || app.casterName !== owner.name) continue;
        hits.push({
          target: chain.targetName,
          category: app.drInfo.category,
          level: app.drInfo.level,
        });
      }
    }
    if (hits.length === 0) return "";
    if (new Set(hits.map((h) => h.level)).size === 1)
      return ` [DR: ${hits[0]!.category} ${hits[0]!.level}]`;
    return ` [DR: ${hits[0]!.category} — ${hits.map((h) => `${enemyPid(h.target)} ${h.level}`).join(", ")}]`;
  }

  /**
   * `[IMMUNE]` tag for the owner's CC casts that the game rejected outright —
   * `SPELL_MISSED` with `missType === "IMMUNE"` (readable since 2026-08-23; the
   * field was parsed away before). Without it a whiffed CC renders exactly like
   * a landed one: the cast line appears, no DR tag follows, and the model has
   * no way to tell "you opened with Fear" from "you threw Fear into Divine
   * Shield". S2 corpus: 4,602 immune CC casts / 1,200 rounds, 82% of rounds
   * carry at least one.
   *
   * The immunity's NAME is attached only when a listed CC-immunity aura
   * (CC_AVOIDANCE_BUFF_SPELLS — completeness-checked against these very IMMUNE
   * events, see immuneCcScan.ts) covered the target at impact. No known aura →
   * bare `[IMMUNE]`, never a guess.
   *
   * Matching: same spellId, miss at [cast, cast+2.5s] (instant CC misses on the
   * same instant; a Polymorph projectile lands up to ~1.5s later). Each miss
   * event is consumed once so chain-cast spam cannot re-attach one miss to
   * several cast lines.
   */
  // The owner's own SPELL_CAST_SUCCESS times per spell, for attributing a miss
  // to the cast that produced it (codex astra 2026-09-25: with only a window,
  // a Polymorph reflected at 31.55 s tagged the landed 30.0 s cast and left
  // the reflected 31.5 s cast bare).
  // Per CASTER (codex review of batch 3, 2026-09-26: a teammate's tag must
  // read the teammate's casts, not the owner's — otherwise the owner's
  // Polymorph at 31.52 s suppressed the teammate's 31.5 s tag and vice versa).
  const castMsBySpellByUnit = new Map<string, Map<string, number[]>>();
  function castMsBySpellOf(unit: ICombatUnit): Map<string, number[]> {
    let m = castMsBySpellByUnit.get(unit.id);
    if (m) return m;
    m = new Map<string, number[]>();
    for (const e of unit.spellCastEvents ?? []) {
      if (e.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS || !e.spellId)
        continue;
      const list = m.get(e.spellId) ?? [];
      list.push(e.timestamp);
      m.set(e.spellId, list);
    }
    castMsBySpellByUnit.set(unit.id, m);
    return m;
  }
  /** The miss falls in the cast's window AND no later cast of the same spell
   * by the same caster happened at or before it — it belongs to the latest
   * cast before it. */
  function missBelongsToCast(
    unit: ICombatUnit,
    spellId: string,
    castMs: number,
    missMs: number,
  ): boolean {
    if (missMs < castMs - 100 || missMs > castMs + 2500) return false;
    return !(castMsBySpellOf(unit).get(spellId) ?? []).some(
      (t) => t > castMs + 5 && t <= missMs + 100,
    );
  }

  const consumedImmuneMisses = new Set<unknown>();
  function ownerCcImmuneTag(
    spellId: string,
    castTimeSeconds: number,
    named?: ReadonlySet<string>,
  ): string {
    return ccImmuneTagFor(owner, spellId, castTimeSeconds, named);
  }
  // Reliability round 3 N10 (483f): a teammate's Storm Bolt the game rejected
  // as IMMUNE rendered as a plain [TEAM] [CC] cast — same predicate as the
  // owner's tag, read from that unit's own SPELL_MISSED stream.
  //
  // Triage 2026-09-29 G3:
  //  - enemy-def F-E25b: a miss is the cast's when its id is the cast's own or
  //    one of the cast's effect auras (`castAndEffectIds`, the one cast→effect
  //    table): Storm Bolt's IMMUNE is logged under its stun 132169, Freezing
  //    Trap's under 3355 / 203337, Maim's under 203123.
  //  - enemy-def F-E26: `named` = the unit names the line names (its target,
  //    plus an AoE fold's landed targets). On such a line a miss on a named
  //    target is the line's own `[IMMUNE]`; a miss on a PLAYER the line does
  //    not name is said with that player's label (`[IMMUNE: 6(UDKnight)]` —
  //    d692582c's Leg Sweep landed on the named priest and was immune only on
  //    the Death Knight); a miss on anything else says nothing (its
  //    Intimidating Shout was immune only on summons and a pet). Without
  //    `named` (a line that names no one) the rule is as before.
  function ccImmuneTagFor(
    unit: ICombatUnit,
    spellId: string,
    castTimeSeconds: number,
    named?: ReadonlySet<string>,
  ): string {
    const misses = unit.missesOut;
    if (!misses || misses.length === 0) return "";
    const castMs = matchStartMs + castTimeSeconds * 1000;
    // Whose immunity counts: a player's, or the unit the cast itself was
    // aimed at. An AoE CC (Psychic Scream, Leg Sweep) logs an IMMUNE miss for
    // every immune pet / totem it sweeps — ghouls, Army of the Dead, totems —
    // while the line names only the player targets; 2026-09-30 corpus
    // (605 files): 818 Psychic Scream lines carried a bare [IMMUNE] that way,
    // e.g. 5dc8b136 0:53 "[DR: Disorient Full] [IMMUNE]" with all three
    // player targets feared.
    const aimedAt = (unit.spellCastEvents ?? []).find(
      (e) =>
        e.logLine?.event === LogEvent.SPELL_CAST_SUCCESS &&
        e.spellId === spellId &&
        Math.abs(e.timestamp - castMs) <= 100,
    )?.destUnitId;
    const counts = (destId: string | undefined) =>
      !!destId &&
      (destId === aimedAt || allPlayers.some((p) => p.id === destId));
    const family = castAndEffectIds(spellId);
    const candidates = misses.filter(
      (m) =>
        m.missType === "IMMUNE" &&
        m.spellId !== undefined &&
        family.has(m.spellId) &&
        counts(m.destUnitId) &&
        !consumedImmuneMisses.has(m) &&
        missBelongsToCast(unit, spellId, castMs, m.timestamp),
    );
    let miss: (typeof candidates)[number] | undefined = candidates[0];
    let unnamedLabel = "";
    if (miss && named && named.size > 0) {
      // `named` holds the line's unit names and/or ids: a miss's dest name
      // need not spell the roster's (realm suffix), its id does
      const onNamed = candidates.find(
        (m) =>
          (!!m.destUnitName && named.has(m.destUnitName)) ||
          (!!m.destUnitId && named.has(m.destUnitId)),
      );
      const onPlayer = candidates.find((m) =>
        allPlayers.some((p) => p.id === m.destUnitId),
      );
      miss = onNamed ?? onPlayer;
      if (!onNamed && onPlayer) {
        // the roster label, resolved by id on the player's own side (a bare
        // character name never prints — 605: `[IMMUNE: Mashiyyds]`)
        const pl = allPlayers.find((p) => p.id === onPlayer.destUnitId)!;
        unnamedLabel =
          pl.reaction === CombatUnitReaction.Friendly
            ? pid(pl.name)
            : enemyPid(pl.name);
      }
    }
    if (!miss) return "";
    consumedImmuneMisses.add(miss);

    // Which listed immunity was up on the target at impact.
    let immunityName = "";
    const target =
      allUnits?.find((u) => u.id === miss.destUnitId) ??
      allPlayers.find((u) => u.id === miss.destUnitId);
    if (target) {
      const active = new Map<string, string>();
      for (const a of target.auraEvents) {
        if (a.timestamp > miss.timestamp) break;
        if (!a.spellId || !CC_AVOIDANCE_BUFF_SPELLS.has(a.spellId)) continue;
        const ev = a.logLine.event;
        if (
          ev === LogEvent.SPELL_AURA_APPLIED ||
          ev === LogEvent.SPELL_AURA_REFRESH
        ) {
          active.set(
            a.spellId,
            CC_AVOIDANCE_BUFF_SPELLS.get(a.spellId) ?? a.spellName,
          );
        } else if (ev === LogEvent.SPELL_AURA_REMOVED) {
          active.delete(a.spellId);
        }
      }
      immunityName = [...active.values()][0] ?? "";
    }
    const word = unnamedLabel ? `IMMUNE: ${unnamedLabel}` : "IMMUNE";
    return immunityName ? ` [${word} — ${immunityName} was up]` : ` [${word}]`;
  }

  /**
   * The other ways an owner CC fails to land on a unit (2026-09-25): the game
   * reports MISS, REFLECT, PARRY, DODGE, EVADE or DEFLECT in the same
   * `SPELL_MISSED` stream as IMMUNE, and without a tag the cast line reads
   * exactly like a landed CC — "Intimidating Shout → 5(HPaladin)" when the
   * Shout missed the paladin (MISS, AOE), next to a [CC BOOKMARK] saying the
   * healer was not CC'd. Season sample (1 file in 60): MISS 397, REFLECT 60,
   * PARRY/DODGE 17 against IMMUNE 1,866. ABSORB alone does not establish a
   * failed control (it reports the CC's damage part) and is ignored.
   * Each miss names its unit — an AoE CC can miss one target and land on
   * another — and is consumed once. Attributed like the IMMUNE tag
   * (`missBelongsToCast`). Ground truth, same sample: after a MISS / REFLECT /
   * PARRY / DODGE the caster's CC aura appeared on that target within 0.5 s
   * 0 / 474 times; after an ABSORB, 957 / 1,072 (89 %).
   */
  const OWNER_CC_MISS_WORD: Record<string, string> = {
    MISS: "MISSED",
    REFLECT: "REFLECTED by",
    PARRY: "PARRIED by",
    DODGE: "DODGED by",
    EVADE: "EVADED by",
    DEFLECT: "DEFLECTED by",
  };
  const consumedCcMisses = new Set<unknown>();
  function ownerCcMissTag(spellId: string, castTimeSeconds: number): string {
    return ccMissTagFor(owner, spellId, castTimeSeconds);
  }
  // cc-dr F-NE1 (codex 35-CD-07: one helper for both owner-CC emitters —
  // the cooldown ledger (ownerCd) and the cast gap-filler): the owner and
  // the owner's summons (a Hunter's pet applies
  // Intimidation's stun) — whose aura on the target counts as the cast's
  const ownCcSources = new Set<string>([
    owner.id,
    ...(allUnits ?? []).filter((u) => u.ownerId === owner.id).map((u) => u.id),
  ]);
  function ownerNoCcAuraTag(spellId: string, castTimeSeconds: number): string {
    const castMs = matchStartMs + castTimeSeconds * 1000;
    const ev = owner.spellCastEvents.find(
      (e) =>
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        e.spellId === spellId &&
        Math.abs(e.logLine.timestamp - castMs) <= 1,
    );
    // an aimed cast at an enemy player only — a ground / untargeted cast has
    // no unit to read
    const dest = ev && (enemies ?? []).find((u) => u.id === ev.destUnitId);
    if (!ev || !dest) return "";
    const t0 = ev.logLine.timestamp;
    const inWindow = (ms: number) => ms >= t0 - 100 && ms <= t0 + 2500;
    const own = castAndEffectIds(spellId);
    const landed = (dest.auraEvents ?? []).some(
      (x) =>
        ownCcSources.has(x.srcUnitId) &&
        x.spellId !== undefined &&
        (ccSpellIds.has(x.spellId) || own.has(x.spellId)) &&
        (x.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
          x.logLine.event === LogEvent.SPELL_AURA_REFRESH) &&
        inWindow(x.timestamp),
    );
    if (landed) return "";
    const missed = (owner.missesOut ?? []).some(
      (m) => m.destUnitId === dest.id && inWindow(m.timestamp),
    );
    return missed ? "" : " [no CC aura logged]";
  }

  // cc-dr F-TM1 (ruling A53, 2026-09-30): the same tag on a teammate's
  // `[TEAM] [CC]` line, from that unit's own SPELL_MISSED stream, with the
  // cause looked up for that caster. A miss's id is the cast's own or one of
  // its effect auras (F-E25b: Maim's MISS logged under its stun 203123).
  // IMMUNE never comes here — `ccImmuneTagFor` owns it.
  function ccMissTagFor(
    unit: ICombatUnit,
    spellId: string,
    castTimeSeconds: number,
  ): string {
    const misses = unit.missesOut;
    if (!misses || misses.length === 0) return "";
    const castMs = matchStartMs + castTimeSeconds * 1000;
    const family = castAndEffectIds(spellId);
    const parts: string[] = [];
    for (const m of misses) {
      const word = m.missType ? OWNER_CC_MISS_WORD[m.missType] : undefined;
      if (
        !word ||
        m.spellId === undefined ||
        !family.has(m.spellId) ||
        consumedCcMisses.has(m) ||
        !missBelongsToCast(unit, spellId, castMs, m.timestamp)
      )
        continue;
      consumedCcMisses.add(m);
      // By GUID: a pet target renders as "X's pet" / "[pet]", never its raw
      // (possibly localized) name (codex astra: `[MISSED on 恶魔卫士]`).
      const who = actorLabel(m.destUnitName, "enemy", m.destUnitId);
      // The cause, when the shared avoidance sweep found one for THIS cast
      // (the enemy summary's ccAvoidedInstances — the predicate behind
      // [CC AVOIDED?]): same caster, same spell, same cast time. 105 of 204
      // tags on the 605-file slice were Holy Priests (Phase Shift).
      const avoided = enemyCCSummaries
        ?.find((x) => x.playerName === m.destUnitName)
        ?.ccAvoidedInstances?.find(
          (a) =>
            a.sourceName === unit.name &&
            a.spellId === spellId &&
            Math.abs(a.atSeconds - castTimeSeconds) < 0.01,
        );
      const cause = avoided ? ` — ${avoided.avoidanceSpellName} was up` : "";
      parts.push(
        word === "MISSED"
          ? ` [MISSED on ${who}${cause}]`
          : ` [${word} ${who}${cause}]`,
      );
    }
    // one cast can log the same failure twice — under its cast id and its
    // effect id (95127ab4: Maim 22570 and its stun 203123, 4 ms apart): say
    // it once
    return [...new Set(parts)].join("");
  }

  /**
   * `[EMPOWER L?]` on the owner's empowered casts (Evoker). The release level
   * is the whole difference between a tap and a full charge — Dream Breath in
   * the S2 archive releases at L1 87% of the time (774 L1 / 20 L2 / 104 L3) —
   * and without this tag every release renders identically, so the model
   * cannot connect "the big AoE heal did nothing" to "it was tapped at L1".
   * The tag states the fact only; whether L1 was right (Flameshaper tap-spam
   * is a real style) is the model's call, not an accusation baked in here.
   *
   * The END is matched to the press by spellId within ±1.5s, each END
   * consumed once. KNOWN GAP (docs/predicate-index.md "Not yet unified"): the
   * press's SPELL_CAST_SUCCESS is logged when the hold STARTS, the END when it
   * is released, so this window reaches a tap and misses a full charge held
   * longer than 1.5 s.
   *
   * `[EMPOWER not released — cut short after Ns]` (triage other F-O6): a hold
   * that ended in SPELL_EMPOWER_INTERRUPT released nothing, yet its
   * SPELL_CAST_SUCCESS — the press, logged at SPELL_EMPOWER_START — rendered
   * exactly like a release. The tag does NOT say "interrupted": the log writes
   * that event for every hold that did not release, and on the 60-file library
   * only 20 of 35 coincide with an enemy CC or kick (the rest: moved, or let
   * go before the first rank). The cause, when there is one, is on the
   * timeline's own [CC ON TEAM] / kick line at that second.
   * Read from `empowerSpans` (the predicate occupancyWithin counts
   * the hold with), matched on the START instant and checked BEFORE the END
   * lookup: an interrupted press followed by a quick re-press must not take
   * the second press's END.
   */
  const consumedEmpowerEnds = new Set<unknown>();
  const ownerInterruptedEmpowers = (empowerSpans(owner) ?? []).filter(
    (s) => s.interrupted,
  );
  const consumedEmpowerInterrupts = new Set<unknown>();
  function ownerEmpowerTag(spellId: string, castTimeSeconds: number): string {
    const ends = owner.empowerEnds;
    const castMs = matchStartMs + castTimeSeconds * 1000;
    const cut = ownerInterruptedEmpowers.find(
      (s) =>
        s.spellId === spellId &&
        !consumedEmpowerInterrupts.has(s) &&
        Math.abs(s.startMs - castMs) <= EMPOWER_PRESS_MATCH_MS,
    );
    if (cut) {
      consumedEmpowerInterrupts.add(cut);
      return ` [EMPOWER not released — cut short after ${((cut.endMs - cut.startMs) / 1000).toFixed(1)}s]`;
    }
    if (!ends || ends.length === 0) return "";
    const end = ends.find(
      (e) =>
        e.spellId === spellId &&
        !consumedEmpowerEnds.has(e) &&
        Math.abs(e.timestamp - castMs) <= 1500,
    );
    if (!end) return "";
    consumedEmpowerEnds.add(end);
    return ` [EMPOWER L${end.level}]`;
  }

  function getCDTargetAndVelocityPart(
    spellId: string,
    rawTimeSeconds: number,
    targetName: string | undefined,
    forceSelf = false,
  ): string {
    // HP on a press line is the HP AT THE PRESS (`hpAtPress`), just before the
    // press's own heal — user ruling 2026-09-30 (triage A21, hp-state F-R8),
    // the signed exception to the whole-second grid: the `[STATE]` tick of the
    // displayed second can read differently, the legend says so and the gate
    // exempts `PRESS_HP_LINE_TAGS`. Every number this helper prints (HP,
    // velocity, the 2 s DPS window) is anchored on that one instant, so a line
    // never mixes two.
    const castMs = matchStartMs + Math.round(rawTimeSeconds * 1000);
    const press = { spellId, srcUnitId: owner.id };
    // B112/B127: self-only defensives (Obsidian Scales, Divine Shield, Ice Block, …) log whatever
    // unit the caster was targeting — often an enemy — as their "target". forceSelf overrides that so
    // the line renders (self) with the caster's own HP, never "→ <enemy>" with that enemy's HP.
    const isSelf =
      forceSelf ||
      !targetName ||
      targetName === "nil" ||
      targetName === owner.name ||
      targetName.split("-")[0] === owner.name.split("-")[0];
    // F139: no owner fallback — it printed the CASTER's own HP as if it were the target's
    // whenever the dest unit wasn't found by exact name.
    const targetUnit = isSelf
      ? owner
      : _allUnits.find((u) => u.name === targetName);

    // H9: the HP-velocity / incoming-DPS trajectory is defensive context (was this ally
    // dying?). It is meaningless — and misleading — for an offensive CD cast on an enemy
    // (e.g. Maim, which is not in ccSpellIds), so skip it when the target is hostile.
    const targetIsEnemy =
      !isSelf && targetUnit?.reaction === CombatUnitReaction.Hostile;

    let velocityStr = "";
    if (targetUnit && !targetIsEnemy && !ccSpellIds.has(spellId)) {
      const hpNow = hpAtPress(targetUnit, castMs, press);
      const hpBefore = getUnitHpAtTimestamp(
        targetUnit,
        castMs - 2000,
        HP_SAMPLE_RADIUS_MS,
      );

      // Preceding 2-second lookback window for incoming DPS
      const fromMs = castMs - 2000;
      const toMs = castMs;
      const incomingDpsK = Math.round(
        sumIncomingPressure(targetUnit, fromMs, toMs, rosterSides) / 2 / 1000,
      );

      if (hpNow !== null && hpBefore !== null) {
        const perSec = (hpNow - hpBefore) / 2;
        const sign = perSec > 0 ? "+" : "";
        velocityStr = `, ${sign}${perSec.toFixed(0)}%/s, ${incomingDpsK}k DPS`;
      } else {
        velocityStr = `, ${incomingDpsK}k DPS`;
      }
    }

    let targetPart = "";
    if (isTeamHealCD(spellId) && (isSelf || targetIsEnemy)) {
      // B136: team-wide healing CDs (Divine Hymn, Restoral, Rewind, Tranquility, …) have no single
      // target, so this line would otherwise render the CASTER's own HP — usually ~100%, which the
      // model reads as a "premature" cast. Show the lowest-HP ally at cast time instead: that is the
      // context these CDs are judged on.
      let lowUnit: ICombatUnit | undefined;
      let lowHp = Infinity;
      for (const u of _allUnits) {
        if (
          u.type !== CombatUnitType.Player ||
          u.reaction !== CombatUnitReaction.Friendly
        )
          continue;
        const hp = hpAtPress(u, castMs, press);
        if (hp !== null && hp < lowHp) {
          lowHp = hp;
          lowUnit = u;
        }
      }
      if (lowUnit) {
        targetPart = ` (team; lowest ally ${lowHp.toFixed(0)}% HP on ${pid(lowUnit.name)})`;
      } else {
        const hpNow = hpAtPress(owner, castMs, press);
        if (hpNow !== null)
          targetPart = ` (self: ${hpNow.toFixed(0)}% HP${velocityStr})`;
      }
    } else if (!isSelf && targetName !== undefined) {
      // F139: resolve by the target's actual reaction — pid() only knows friendlies, so an
      // offensive CD/CC target (an enemy) rendered as a raw name, or as the WRONG friendly id
      // when both teams had a player with the same display name.
      const shortTarget = targetName.split("-")[0];
      const resolved = targetUnit
        ? targetUnit.reaction === CombatUnitReaction.Hostile
          ? enemyPid(targetName)
          : pid(targetName)
        : shortTarget;
      // Totem/pet/NPC targets resolve through the pid fallback to their log
      // name, which is client-localized (localized Grounding Totem leak, locale audit). Known
      // critical NPCs get their English name via npcId; anything else
      // non-ASCII is suppressed. ASCII English names still pass through.
      const npcEnglish = targetUnit
        ? CRITICAL_NON_PLAYER_NPC_NAMES[getNpcIdFromGuid(targetUnit.id) ?? ""]
        : undefined;
      const targetLabel = [...resolved].some((c) => c.charCodeAt(0) > 127)
        ? (npcEnglish ?? "[pet/NPC]")
        : resolved;
      targetPart = ` → ${targetLabel}`;
      const hpPct = targetUnit
        ? hpAtPress(targetUnit, castMs, press)?.toFixed(0)
        : undefined;
      if (hpPct !== undefined || velocityStr !== "") {
        targetPart += ` (${hpPct ?? "?"}% HP${velocityStr})`;
      }
    } else if (velocityStr !== "") {
      const hpNow = hpAtPress(owner, castMs, press);
      if (hpNow !== null) {
        targetPart = ` (self: ${hpNow.toFixed(0)}% HP${velocityStr})`;
      }
    }
    return targetPart;
  }

  const snapshotFn = buildResourceSnapshot;
  // [RES] only (user ruling 2026-09-26, round 3 N14): the owner's kick (own
  // or pet) and Death Grip sit under MIN_CD_SECONDS and never entered the
  // ledger; they join the [RES] line and nothing else (resUtilityCds.ts).
  const resOwnerCDs = [...ownerCDs, ...ownerResUtilityCds(owner, matchStartMs)];

  const matchEndSeconds = (matchEndMs - matchStartMs) / 1000;
  // GH #119: the round the aura-evidenced bursts are read over (the same
  // bounds reconstructEnemyCDTimeline uses)
  const roundBounds = { startTime: matchStartMs, endTime: matchEndMs };

  let nextPlaceholderId = 0;
  function requestSnapshotPlaceholder(
    timeSeconds: number,
    forceFull = false,
    bypassDebounce = false,
  ): DeferredSnapshot {
    return {
      type: "resource_snapshot",
      timeSeconds,
      forceFull,
      bypassDebounce,
      id: nextPlaceholderId++,
    };
  }

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
  const allPlayers = friends.concat(enemies ?? []);
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
  const trinketBrokenDisarm = (
    summary: IPlayerCCTrinketSummary,
    t: number,
  ) => {
    const rawCastMs = matchStartMs + Math.round(t * 1000);
    return findBrokenCC(summary.ccInstances, matchStartMs, rawCastMs)
      ? undefined
      : findBrokenDisarm(summary.disarmInstances, matchStartMs, rawCastMs);
  };
  let disarmLineCount = 0;
  ({ disarmLineCount } = emitTrinketCcOnTeamEntries({
    ccTrinketSummaries,
    trinketBrokenDisarm,
    actorLabel,
    addEntry,
    pid,
    disarmLineCount,
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

  if (isHealer) {
    for (const gap of healingGaps) {
      addEntry(
        gap.fromSeconds,
        `${fmtTime(gap.fromSeconds)}  [INACTIVITY]   ${pid(owner.name)} inactive ${gap.durationSeconds.toFixed(1)}s (${gap.freeCastSeconds.toFixed(1)}s of it un-CC'd/free to cast) while ${pid(gap.mostDamagedName)} under pressure`,
      );
    }
  }

  // Compile key moment seconds where major events occur
  const keyMomentSeconds = new Set<number>();
  for (const d of friendlyDeaths) keyMomentSeconds.add(Math.floor(d.atSeconds));
  for (const d of enemyDeaths) keyMomentSeconds.add(Math.floor(d.atSeconds));
  for (const cd of ownerCDs) {
    for (const cast of cd.casts)
      keyMomentSeconds.add(Math.floor(cast.timeSeconds));
  }
  for (const { cds } of teammateCDs) {
    for (const cd of cds) {
      for (const cast of cd.casts)
        keyMomentSeconds.add(Math.floor(cast.timeSeconds));
    }
  }
  for (const player of enemyCDTimeline.players) {
    for (const cd of player.offensiveCDs)
      keyMomentSeconds.add(Math.floor(cd.castTimeSeconds));
  }
  for (const summary of ccTrinketSummaries) {
    for (const cc of summary.ccInstances) {
      if (cc.durationSeconds > 0)
        keyMomentSeconds.add(Math.floor(cc.atSeconds));
    }
    for (const t of summary.trinketUseTimes)
      keyMomentSeconds.add(Math.floor(t));
  }
  for (const pw of pressureWindows) {
    if (pw.totalDamage >= DMG_SPIKE_THRESHOLD)
      keyMomentSeconds.add(Math.floor(pw.fromSeconds));
  }
  for (const miss of dispelSummary.missedCleanseWindows) {
    if (
      canRemoveFrom(owner, miss.dispelType, miss.targetCharmed, miss.targetName)
    )
      keyMomentSeconds.add(Math.floor(miss.timeSeconds));
  }
  for (const cleanse of dispelSummary.allyCleanse) {
    keyMomentSeconds.add(Math.floor(cleanse.timeSeconds));
  }
  if (outgoingCCChains && outgoingCCChains.length > 0) {
    for (const event of extractAoeCCEvents(outgoingCCChains)) {
      keyMomentSeconds.add(Math.floor(event.atSeconds));
    }
  }

  // HP ticks use the single radius HP_SAMPLE_RADIUS_MS throughout. A former
  // narrowing to ±1.5s inside critical windows has been removed — see the note
  // under HP_SAMPLE_RADIUS_MS in cooldowns.ts (in short: it did not fix the
  // problem it claimed to fix, it was redundant with the STATE emission gate,
  // and it actively dropped coverage inside critical windows).

  // B106: when a numeric ID map is present, sort HP tokens by player ID so the model
  // can align HP readings with class labels listed elsewhere in player-ID order.
  // Owner is always assigned ID 1 in buildPlayerLoadout, so sorting by ID also satisfies
  // the "owner first" property; fall back to owner-first ordering when no map is provided.
  const friendlyOrdered: ICombatUnit[] = playerIdMap
    ? [...friends].sort((a, b) => {
        const aId = playerIdMap.get(a.name);
        const bId = playerIdMap.get(b.name);
        if (aId === undefined && bId === undefined) return 0;
        if (aId === undefined) return 1;
        if (bId === undefined) return -1;
        return aId - bId;
      })
    : [
        ...friends.filter((u) => u.name === owner.name),
        ...friends.filter((u) => u.name !== owner.name),
      ];

  const friendlyHpUnits: Array<{
    unit: ICombatUnit;
    label: (name: string) => string;
  }> = friendlyOrdered.map((u) => ({
    unit: u,
    label: (name: string) => pid(name),
  }));

  const enemiesOrdered: ICombatUnit[] = enemyIdMap
    ? [...(enemies ?? [])].sort((a, b) => {
        const aId = enemyIdMap.get(a.name);
        const bId = enemyIdMap.get(b.name);
        if (aId === undefined && bId === undefined) return 0;
        if (aId === undefined) return 1;
        if (bId === undefined) return -1;
        return aId - bId;
      })
    : [...(enemies ?? [])];

  const enemyHpUnits: Array<{
    unit: ICombatUnit;
    label: (name: string) => string;
  }> = enemiesOrdered.map((u) => ({
    unit: u,
    label: (name: string) => enemyPid(name),
  }));

  // B42: [STATE] ticks show :dead instead of silently omitting dead players.
  // The [STATE] loop's own predicate is `isDeadAtRenderSecond`
  // (utils/cooldowns.ts), shared with analysis/crisisDecisionPoints.ts's
  // render-grid anchor so the two sides cannot drift apart on "was this unit
  // alive at second s". These name-keyed maps remain for the mana-marker
  // block below (emitManaMarkerEntries), which takes names, not units.
  const friendlyDeathAtByName = new Map<string, number>(
    friendlyDeaths.map((d) => [d.name, d.atSeconds]),
  );
  const enemyDeathAtByName = new Map<string, number>(
    enemyDeaths.map((d) => [d.name, d.atSeconds]),
  );

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
  resolveDeferredSnapshots({
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
