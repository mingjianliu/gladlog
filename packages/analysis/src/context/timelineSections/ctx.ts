/**
 * TimelineCtx — the shared values and closure helpers that `buildMatchTimeline`
 * hands to its per-section emitters (GH #116: splitting the ~3,700-line
 * function into one module per section tag, byte-identical output).
 *
 * Each emitter takes `Pick<TimelineCtx, …>` of exactly what it uses, so its
 * signature documents its inputs. The closure helpers are the SAME function
 * objects `buildMatchTimeline` created — several of them consume shared state
 * (`consumedAoeEvents`, `consumedCcMisses`, the placeholder id counter), so an
 * emitter must be handed the original closure, never a re-created one.
 *
 * Fields grow one section at a time; a field is added when the first emitter
 * that needs it is extracted. `closureBindingAudit.ts` (packages/eval/scripts)
 * lists what a line range needs before it is cut.
 */
import type { ICombatUnit } from "@gladlog/parser-compat";

import type {
  findBrokenDisarm,
  IPlayerCCTrinketSummary,
} from "../../utils/ccTrinketAnalysis";
import type { IMissedPurgeWindow } from "../../utils/dispelAnalysis";
import type { IAoeCCEvent } from "../../utils/drAnalysis";
import type { IEnemyCDCast } from "../../utils/enemyCDs";
import type { buildRosterSides } from "../../utils/rosterSide";
import type { BuildMatchTimelineParams } from "../matchTimeline";
import type { buildResourceSnapshot } from "../resourceSnapshot";
import type { emitContextFactEntries } from "./contextFacts";
import type { emitEnemyCdEntries } from "./enemyCd";

import type {
  buildSummonOwnerNames,
  extractEnemyMajorBuffIntervals,
  extractOwnerCDBuffExpiry,
  IEnemyBuffInterval,
} from "../timelineHelpers";

/** A [STATE]/[RES] snapshot requested at a time; resolved after all sections
 * have run (it can be debounced away or forced full). */
export interface DeferredSnapshot {
  type: "resource_snapshot";
  timeSeconds: number;
  forceFull: boolean;
  bypassDebounce?: boolean;
  id: number;
}

/** Is this timeline entry line a deferred snapshot placeholder (as opposed
 * to a rendered string)? Moved here from matchTimeline.ts with the type it
 * guards (GH #116). */
export function isDeferredSnapshot(line: unknown): line is DeferredSnapshot {
  return !!(
    line &&
    typeof line === "object" &&
    "type" in line &&
    line.type === "resource_snapshot"
  );
}

type P = BuildMatchTimelineParams;
type ContextFacts = ReturnType<typeof emitContextFactEntries>;

export interface TimelineCtx {
  // ── params (as destructured by buildMatchTimeline) ──
  owner: P["owner"];
  ownerCDs: P["ownerCDs"];
  ccTrinketSummaries: P["ccTrinketSummaries"];
  dispelSummary: P["dispelSummary"];
  friendlyDeaths: P["friendlyDeaths"];
  matchStartMs: P["matchStartMs"];
  isHealer: P["isHealer"];
  /** defaulted to [] by the destructuring */
  stasisEvents: NonNullable<P["stasisEvents"]>;
  /** params.criticalWindowSeconds */
  criticalWindowSet: P["criticalWindowSeconds"];
  /** params.crisisUnfoldWindows, defaulted to [] */
  crisisUnfoldWindows: NonNullable<P["crisisUnfoldWindows"]>;
  enemyDispelSummary: P["enemyDispelSummary"];
  /** the whole params object — a few sections read a field of it directly
   * (`params.ccBreakEvents`) instead of the destructured name */
  params: P;
  teammateCDs: P["teammateCDs"];
  pressureWindows: P["pressureWindows"];
  enemies: P["enemies"];
  enemyCDTimeline: P["enemyCDTimeline"];
  bracket: P["bracket"];
  friends: P["friends"];
  /** params.allUnits as passed (may be undefined — see `_allUnits`) */
  allUnits: P["allUnits"];
  enemyCCSummaries: P["enemyCCSummaries"];
  matchEndMs: P["matchEndMs"];
  playerIdMap: P["playerIdMap"];
  enemyIdMap: P["enemyIdMap"];
  rawStreams: P["rawStreams"];
  ownerSpec: P["ownerSpec"];
  burstWindows: P["burstWindows"];
  cdPriorEpisodes: P["cdPriorEpisodes"];
  cdPriorCohort: P["cdPriorCohort"];
  stackedDefensives: P["stackedDefensives"];
  outgoingCCChains: P["outgoingCCChains"];
  enemyDeaths: P["enemyDeaths"];
  healingGaps: P["healingGaps"];
  /** defaulted to [] by the destructuring */
  shapeshiftIntervals: NonNullable<P["shapeshiftIntervals"]>;

  // ── what earlier emitters report back (read by the legends) ──
  enemyCdRender: ReturnType<typeof emitEnemyCdEntries>;
  burstAnsweredEntries: ContextFacts["burstAnsweredEntries"];
  cdPriorEntries: ContextFacts["cdPriorEntries"];
  stackedDefensiveEntries: ContextFacts["stackedDefensiveEntries"];
  drClashEntries: ContextFacts["drClashEntries"];
  /** [SILENCE] lines rendered; the legend needs > 0 */
  silenceLineCount: number;
  crisisAnchorSeconds: P["crisisAnchorSeconds"];
  /** defaulted to [] by the destructuring */
  spiritOfRedemptionIntervals: NonNullable<P["spiritOfRedemptionIntervals"]>;

  // ── the entries every emitter feeds; the snapshot pass rewrites them in place ──
  entries: Array<{
    timeSeconds: number;
    lines: (string | DeferredSnapshot)[];
  }>;

  // ── derived values ──
  /** (matchEndMs − matchStartMs) / 1000 */
  matchDurationS: number;
  /** power-sample fallback for stored matches without power samples */
  manaFallback: { rawStreams: P["rawStreams"]; matchStartMs: number };
  /** the [RES] snapshot builder (buildResourceSnapshot) */
  snapshotFn: typeof buildResourceSnapshot;
  /** ownerCDs plus the owner's kick / Death Grip, for the [RES] line only */
  resOwnerCDs: P["ownerCDs"];
  /** whole seconds where a major event happens — [STATE] always renders there */
  keyMomentSeconds: Set<number>;
  /** the HP tokens of [STATE], in player-id order */
  friendlyHpUnits: Array<{
    unit: ICombatUnit;
    label: (name: string) => string;
  }>;
  enemyHpUnits: Array<{ unit: ICombatUnit; label: (name: string) => string }>;
  /** death time by name (mana markers take names, not units) */
  friendlyDeathAtByName: Map<string, number>;
  enemyDeathAtByName: Map<string, number>;
  /** summon GUID -> owner name (a pet / guardian is named through its owner) */
  summonOwners: ReturnType<typeof buildSummonOwnerNames>;
  /** unit GUID -> name, over `_allUnits` */
  unitNames: Map<string, string>;
  /** unit GUID -> roster side (a roster fact, not the event's reaction flags) */
  rosterSides: ReturnType<typeof buildRosterSides>;
  /** (matchEndMs − matchStartMs) / 1000 */
  matchEndSeconds: number;
  /** the round, as reconstructEnemyCDTimeline reads it (GH #119) */
  roundBounds: { startTime: number; endTime: number };
  /** the owner's CC spell ids that already have a [YOU] [CC] cast line */
  ownerRenderedCcIds: Set<string>;
  /** params.allUnits, or friends + enemies when absent */
  _allUnits: ICombatUnit[];
  /** friends + enemies (dampening, rot pressure) */
  allPlayers: ICombatUnit[];
  /** AoE CC casts from outgoingCCChains; [] when there are none */
  aoeCCEvents: IAoeCCEvent[];
  /** AoE CC events already folded into a cast line (shared: owner casts,
   * teammate casts and the remaining [CC CAST] lines all consume it) */
  consumedAoeEvents: Set<IAoeCCEvent>;
  /** F114: per amplifier spell, the cast times that get a [HEALING] block */
  healingEmissionTimes: Map<string, Set<number>>;
  /** the owner's cooldown buffs fading ([BUFF FADED]); also read by [YOU] [CD] */
  cdExpiryEvents: ReturnType<typeof extractOwnerCDBuffExpiry>;
  /** the owner's own CC / trinket summary, if any */
  ownerCCSummary: IPlayerCCTrinketSummary | undefined;
  /** enemies' major buff intervals by enemy name ([ENEMY BUFF]) */
  enemyBuffIntervals: ReturnType<typeof extractEnemyMajorBuffIntervals>;
  /** GH #99 Rules B & C: enemy buff intervals folded away into a cast line */
  droppedBuffIntervals: Set<IEnemyBuffInterval>;
  /** GH #99 Rules B & C: missed-purge notes attached to an enemy buff line */
  buffPurgeAnnotations: Map<IEnemyBuffInterval, string>;
  /** GH #99 Rules B & C: missed-purge notes attached to an enemy CD cast line */
  cdPurgeAnnotations: Map<IEnemyCDCast, string>;
  /** the owner's missed purges worth naming (high-value buff or a scoped
   * immunity tool) — GH #99 folds some into lines, the rest render alone */
  qualifyingMissedPurges: IMissedPurgeWindow[];
  /** GH #99 Rules B & C: missed purges already folded into a line */
  consumedMissedPurges: Set<IMissedPurgeWindow>;

  // ── threaded (in / out) ──
  /** set when any owner / teammate proc-only activation rendered as [PROC];
   * the legend line for the tag is emitted only then. Emitters that set it
   * take the current value and return the new one. */
  procLinesEmitted: boolean;
  /** enemy trinket lines rendered; the [ENEMY TRINKET] legend needs > 0 */
  enemyTrinketCount: number;
  /** [DISARM] tail lines rendered; the [DISARM] legend needs > 0 */
  disarmLineCount: number;
  /** `trinket: ON CD (…; last used m:ss …)` notes rendered (B4a); their
   * legend line needs > 0 */
  trinketLastUsedCount: number;
  /** [GRIP] lines rendered (B17b-U8); the [GRIP] legend needs > 0 */
  gripLineCount: number;

  // ── closure helpers ──
  /** GH #103 A6: who provided the avoidance aura on a `[CC AVOIDED?]` line */
  avoidanceSourceTag: (
    sourceName: string | undefined,
    targetName: string,
  ) => string;
  /** enemy-def F-E18: the disarm a trinket press at `t` broke, when no CC took it */
  trinketBrokenDisarm: (
    summary: IPlayerCCTrinketSummary,
    t: number,
  ) => ReturnType<typeof findBrokenDisarm> | undefined;
  /** caster label for "(by X)": player -> pid / enemyPid, pet / totem -> its owner */
  actorLabel: (
    name: string,
    side: "friendly" | "enemy",
    sourceId?: string,
  ) => string;
  /** the DR tag on our CC landing on an enemy */
  enemyCcDrTag: (
    targetName: string,
    spellId: string,
    atSeconds: number,
    sourceId: string | undefined,
    sourceName: string,
  ) => string;
  /** friendly player name -> short id (+ spec tag) */
  pid: (name: string) => string;
  /** friendly player name -> short id (+ spec tag); undefined for a name that
   * is no friendly player (crisis-external F-T1) */
  friendlyPid: (name: string) => string | undefined;
  /** enemy player name -> short id (+ spec tag) */
  enemyPid: (name: string) => string;
  outgoingDrTag: (spellId: string, cast: { timeSeconds: number }) => string;
  /** `named`: the unit names the line names (enemy-def F-E26) */
  ccImmuneTagFor: (
    unit: ICombatUnit,
    spellId: string,
    castTimeSeconds: number,
    named?: ReadonlySet<string>,
  ) => string;
  /** cc-dr F-TM1: MISS / REFLECT / … on that caster's CC cast */
  ccMissTagFor: (
    unit: ICombatUnit,
    spellId: string,
    castTimeSeconds: number,
  ) => string;
  ownerInterruptImmuneReasonAt: (timeSeconds: number) => string | undefined;
  /** false when the entry was dropped (past match end, B103) — a legend that
   * counts lines counts only the ones that print */
  addEntry: (
    timeSeconds: number,
    ...lines: (string | DeferredSnapshot)[]
  ) => boolean;
  manaCooldownNote: (
    spellId: string,
    timeSeconds: number,
    targetName: string | undefined,
  ) => string | null;
  groundingAbsorbNote: (
    spellId: string,
    spellName: string,
    totemOwnerId: string,
    castSeconds: number,
  ) => string;
  resolveTarget: (destUnitName: string | null | undefined) => string;
  ownerCcImmuneTag: (
    spellId: string,
    castTimeSeconds: number,
    named?: ReadonlySet<string>,
  ) => string;
  ownerCcMissTag: (spellId: string, castTimeSeconds: number) => string;
  /** cc-dr F-NE1: ` [no CC aura logged]` for an aimed owner CC with no aura
   * and no miss on its target (shared by both owner-CC emitters) */
  ownerNoCcAuraTag: (spellId: string, castTimeSeconds: number) => string;
  ownerEmpowerTag: (spellId: string, castTimeSeconds: number) => string;
  getCDTargetAndVelocityPart: (
    spellId: string,
    rawTimeSeconds: number,
    targetName: string | undefined,
    forceSelf?: boolean,
  ) => string;
  requestSnapshotPlaceholder: (
    timeSeconds: number,
    forceFull?: boolean,
    bypassDebounce?: boolean,
  ) => DeferredSnapshot;
  findAndConsumeAoeCC: (
    castTimeSeconds: number,
    casterName: string,
    spellName: string,
    isOwnerCast: boolean,
  ) => IAoeCCEvent | undefined;
  formatAoeTargetPart: (aoe: IAoeCCEvent, existingTargetPart: string) => string;
  ownerHardCcTagAt: (timeSeconds: number) => string;
  /** The owner was stunned at this cast: strictly inside a stun, or the cast
   * is the one that ended it (triage enemy-def F-E20). */
  ownerStunnedAtCast: (timeSeconds: number) => boolean;
  /** The stun auras behind `ownerStunnedAtCast` (empty when it is false). */
  ownerStunIdsAtCast: (timeSeconds: number) => string[];
}
