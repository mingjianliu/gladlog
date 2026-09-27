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

import type { IAoeCCEvent } from "../../utils/drAnalysis";
import type { BuildMatchTimelineParams } from "../matchTimeline";

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

  // ── derived values ──
  /** params.allUnits, or friends + enemies when absent */
  _allUnits: ICombatUnit[];

  // ── closure helpers ──
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
