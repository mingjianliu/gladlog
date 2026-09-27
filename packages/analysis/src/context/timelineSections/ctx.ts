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

import type { IPlayerCCTrinketSummary } from "../../utils/ccTrinketAnalysis";
import type { IAoeCCEvent } from "../../utils/drAnalysis";
import type { BuildMatchTimelineParams } from "../matchTimeline";
import type { extractOwnerCDBuffExpiry } from "../timelineHelpers";

/** A [STATE]/[RES] snapshot requested at a time; resolved after all sections
 * have run (it can be debounced away or forced full). */
export interface DeferredSnapshot {
  type: "resource_snapshot";
  timeSeconds: number;
  forceFull: boolean;
  bypassDebounce?: boolean;
  id: number;
}

type P = BuildMatchTimelineParams;

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
  enemyDispelSummary: P["enemyDispelSummary"];
  /** the whole params object — a few sections read a field of it directly
   * (`params.ccBreakEvents`) instead of the destructured name */
  params: P;
  teammateCDs: P["teammateCDs"];
  pressureWindows: P["pressureWindows"];
  enemies: P["enemies"];

  // ── derived values ──
  /** params.allUnits, or friends + enemies when absent */
  _allUnits: ICombatUnit[];
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

  // ── threaded (in / out) ──
  /** set when any owner / teammate proc-only activation rendered as [PROC];
   * the legend line for the tag is emitted only then. Emitters that set it
   * take the current value and return the new one. */
  procLinesEmitted: boolean;

  // ── closure helpers ──
  /** friendly player name -> short id (+ spec tag) */
  pid: (name: string) => string;
  /** enemy player name -> short id (+ spec tag) */
  enemyPid: (name: string) => string;
  outgoingDrTag: (spellId: string, cast: { timeSeconds: number }) => string;
  ccImmuneTagFor: (
    unit: ICombatUnit,
    spellId: string,
    castTimeSeconds: number,
  ) => string;
  ownerInterruptImmuneReasonAt: (timeSeconds: number) => string | undefined;
  addEntry: (
    timeSeconds: number,
    ...lines: (string | DeferredSnapshot)[]
  ) => void;
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
  ownerCcImmuneTag: (spellId: string, castTimeSeconds: number) => string;
  ownerCcMissTag: (spellId: string, castTimeSeconds: number) => string;
  ownerEmpowerTag: (spellId: string, castTimeSeconds: number) => string;
  getCDTargetAndVelocityPart: (
    spellId: string,
    rawTimeSeconds: number,
    targetName: string | undefined,
    overrideHpPct?: number,
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
}
