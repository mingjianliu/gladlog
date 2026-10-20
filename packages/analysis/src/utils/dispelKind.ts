/**
 * Is a SPELL_DISPEL a *decision* (someone pressed a dispel), a passive proc
 * (Cleanse the Weak, Phantasm, Fire Breath, …) or a rider on a movement/form
 * action (Cat Form breaking a root)? — UI review 2026-08-21 #3.
 *
 * Measured on the full local library (1095 matches, 149,935 SPELL_DISPEL):
 * "same raw source GUID emitted SPELL_CAST_SUCCESS with the same spellId or
 * spellName within ±1 s" is near-bimodal — every cleanse/purge/steal spell
 * sits at 99–100 % cast-matched, every proc at 0 %; the only mixed spells are
 * form shifts / rider spells, which the small list below names explicitly.
 * Cleanse the Weak (199427): 5,036 events, 0 % matched.
 *
 * Source GUID, not merged owner: parser-compat's mergePetEvents folds only
 * damage/heal/absorb into the owner; a Felhunter's Devour Magic cast stays on
 * the pet unit and matches its own pet-sourced dispel (19505: 100 % matched).
 *
 * Name match is what closes the Mass Dispel edge: the cast is 32375, the
 * dispel effect is logged as 32592 (682 events) — same name, different id.
 *
 * Full-library run of the production predicate (2026-08-22,
 * packages/eval/scripts/dispelKindScan.ts): 72.4 % deliberate / 5.6 % proc /
 * 22.0 % rider; per-match passive share p50 0.25, p90 0.57; no stale list
 * ids. Known limitation: three spells whose dispels trail the cast by more
 * than the window — Master's Call 357148 (77 % matched), 治疗绷带 212640
 * (75 %), a totem pulse 383015 (24 %) — ~0.8 % of all events land in `proc`
 * although the *placement* was a decision. Left as is: the pulses themselves
 * are not decisions, and a per-spell trigger map would be another hand list.
 *
 * Shared predicate: analysis stamps `IDispelEvent.dispelKind` from it; the
 * desktop KPI chip / dispel dashboard / stats table read that field; eval's
 * coverageManifest imports MOVEMENT_ROOT_BREAK_DISPEL_IDS from here (it used
 * to own the list); eval's confidenceAudit --emit-table (the generator of
 * data/dispelObservedGenerated.ts, GH #32) builds the corpus-attested
 * dispellable set through `buildCastMatchIndex` + `classifyDispel`, so a
 * rider never opens the missed-cleanse / missed-purge corpus gate. Completeness of the list is checked both directions by
 * packages/eval/scripts/dispelKindScan.ts (Curated-List rule).
 */
import { LogEvent } from "@gladlog/parser-compat";

export type DispelKind = "deliberate" | "proc" | "rider";

/** ±window between the cast and the dispel it produced. Same-GCD in practice;
 * 1 s leaves room for the log's own ordering jitter. */
export const DISPEL_CAST_MATCH_WINDOW_MS = 1000;

/** Dispelling spell ids whose SPELL_DISPEL is a side effect of a movement /
 * form / offensive / defensive action, never a cleanse decision. Keyed by the
 * DISPELLING spell id. Frequencies in parens are from the 2026-07-14
 * 1245-match audit. Moved verbatim from
 * packages/eval/src/quality/coverageManifest.ts on 2026-08-21. */
export const MOVEMENT_ROOT_BREAK_DISPEL_IDS: ReadonlySet<string> = new Set([
  "5487", // Bear Form
  "768", // Cat Form
  "165961", // Travel Form
  "781", // Disengage (Posthaste)
  "114239", // Phantasm
  "378076", // Thunderous Paws
  "409293", // Burrow
  "462820", // Jet Stream
  "159535", // Ride the Wind
  "365080", // Windwalking
  "6940", // Blessing of Sacrifice
  "33891", // Incarnation: Tree of Life
  // B3 (2026-07-14 full-scale audit): more rider-dispels found at 1245-match scale —
  // SPELL_DISPEL fired as a side effect of a movement/form/offense/defense action,
  // not a cleanse decision. Frequencies from the audit corpus in parens.
  // Deliberate cleanses stay out of this list (Naturalize, Cauterizing Flame,
  // Master's Call, Tiger's Lust, Tranq Shot, Fire Breath/Scouring Flame, …).
  "24858", // Moonkin Form — form-shift root-break (459)
  "48020", // Demonic Circle: Teleport — movement rider (390)
  "370665", // Rescue — Evoker reposition; root-removal rider (405)
  "357210", // Deep Breath — movement/damage rider (245)
  "384784", // Wilderness Medicine — passive Mend Pet cleanse rider (237)
  "227847", // Bladestorm — self snare-removal rider on an offensive CD (187)
  "20589", // Escape Artist — self root-break utility, same family as Disengage (181)
  "115203", // Fortifying Brew — defensive CD rider (153)
]);

export interface CastMatchIndex {
  /** `${srcUnitId}|${spellId}` → timestamps (insertion order) */
  byId: Map<string, number[]>;
  /** `${srcUnitId}|${spellName}` → timestamps (insertion order) */
  byName: Map<string, number[]>;
  /** `srcUnitId` → every press's timestamp, any spell (fact2 C5) */
  bySource: Map<string, number[]>;
}

export function createCastMatchIndex(): CastMatchIndex {
  return { byId: new Map(), byName: new Map(), bySource: new Map() };
}

export function addCastToIndex(
  index: CastMatchIndex,
  srcUnitId: string,
  spellId: string | null | undefined,
  spellName: string | null | undefined,
  timestamp: number,
): void {
  if (spellId) {
    const k = `${srcUnitId}|${spellId}`;
    const list = index.byId.get(k) ?? [];
    list.push(timestamp);
    index.byId.set(k, list);
  }
  if (spellName) {
    const k = `${srcUnitId}|${spellName}`;
    const list = index.byName.get(k) ?? [];
    list.push(timestamp);
    index.byName.set(k, list);
  }
  const bySrc = index.bySource.get(srcUnitId) ?? [];
  bySrc.push(timestamp);
  index.bySource.set(srcUnitId, bySrc);
}

/** A press and a removal it caused share their instant; the log can split
 * them by a few ms (the [MINOR DISPELS] fold's one-cast merge,
 * `MINOR_DISPEL_CAST_MERGE_S`, is the same 50 ms). */
export const DISPEL_RIDES_PRESS_MS = 50;

/**
 * fact2 C5 (2026-10-20): did the dispel's source press ANY spell at the
 * removal — a talent's dispel riding a differently named button (Phantasm
 * 114239 on Fade 586, Spreading the Word: Freedom 199508 on Blessing of
 * Freedom 1044; 0deb726b 0:06 / 0:39). The [MINOR DISPELS] fold calls such a
 * removal a side effect of the cast, not `(passive)`: a press made it.
 * Says nothing about the dispel kind (`classifyDispel` is unchanged).
 */
export function dispelRodeOwnPress(
  index: CastMatchIndex,
  d: Pick<IDispelToClassify, "srcUnitId" | "timestamp">,
): boolean {
  return (index.bySource.get(d.srcUnitId) ?? []).some(
    (t) => Math.abs(t - d.timestamp) <= DISPEL_RIDES_PRESS_MS,
  );
}

/**
 * Build the cast index over every unit's SPELL_CAST_SUCCESS, keyed on the RAW
 * source GUID (pets index their own casts — see the header). Single source
 * for the two consumers of `classifyDispel`: `reconstructDispelSummary`
 * (product) and eval's `confidenceAudit --emit-table` (the generator of
 * `dispelObservedGenerated.ts`, GH #32) — the corpus gate must be built under
 * the same kind predicate the product stamps on `IDispelEvent.dispelKind`.
 */
export function buildCastMatchIndex(
  units: Iterable<{
    id: string;
    spellCastEvents: ReadonlyArray<{
      logLine: { event: string };
      srcUnitId?: string;
      spellId?: string | null;
      spellName?: string | null;
      timestamp: number;
    }>;
    empowerEnds?: ReadonlyArray<{
      srcUnitId?: string;
      spellId?: string | null;
      spellName?: string | null;
      timestamp: number;
    }>;
  }>,
): CastMatchIndex {
  const index = createCastMatchIndex();
  for (const u of units) {
    for (const c of u.spellCastEvents) {
      if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      addCastToIndex(
        index,
        c.srcUnitId || u.id,
        c.spellId,
        c.spellName,
        c.timestamp,
      );
    }
    // an empowered cast logs its SUCCESS when the hold starts and acts at
    // the release (SPELL_EMPOWER_END): its dispel comes with the release
    // (fact1215 R11, 34204ef9: Fire Breath held 1.1 s and 1.3 s, six of
    // its dispels read as `(passive)`)
    for (const r of u.empowerEnds ?? [])
      addCastToIndex(
        index,
        r.srcUnitId || u.id,
        r.spellId,
        r.spellName,
        r.timestamp,
      );
  }
  return index;
}

const within = (list: number[] | undefined, t: number): boolean =>
  !!list && list.some((c) => Math.abs(c - t) <= DISPEL_CAST_MATCH_WINDOW_MS);

interface IDispelToClassify {
  srcUnitId: string;
  spellId: string | null | undefined;
  spellName: string | null | undefined;
  timestamp: number;
}

/**
 * Did the dispel's own source log a cast of the dispelling spell (same id or
 * same name) inside `DISPEL_CAST_MATCH_WINDOW_MS` — the cast-match half of
 * `classifyDispel`, on its own for a RIDER (F11): the list makes a Demonic
 * Circle: Teleport's snare removal a rider whether or not the teleport was
 * cast, and the [MINOR DISPELS] fold printed every rider as `(passive)` — on
 * the 60 re-eval prompts the only mention of seven warlocks' teleports. A
 * rider with its cast on the log is a side effect of a press; one without
 * (Incarnation: Tree of Life's removal when the druid LEAVES the form, or
 * enters it on a Reforestation proc) is not.
 */
export function dispelCameWithOwnCast(
  index: CastMatchIndex,
  d: IDispelToClassify,
): boolean {
  const idHit = d.spellId
    ? within(index.byId.get(`${d.srcUnitId}|${d.spellId}`), d.timestamp)
    : false;
  const nameHit = d.spellName
    ? within(index.byName.get(`${d.srcUnitId}|${d.spellName}`), d.timestamp)
    : false;
  return idHit || nameHit;
}

export function classifyDispel(
  index: CastMatchIndex,
  d: IDispelToClassify,
): DispelKind {
  // The list wins over the cast match: a form shift IS a cast, but its dispel
  // is a root-break rider, not a cleanse decision.
  if (d.spellId && MOVEMENT_ROOT_BREAK_DISPEL_IDS.has(d.spellId))
    return "rider";
  return dispelCameWithOwnCast(index, d) ? "deliberate" : "proc";
}

/** A removal that is a side effect of a form / movement / defensive action
 * (`MOVEMENT_ROOT_BREAK_DISPEL_IDS`) — no cleanse, purge or steal decision.
 * The one test of every reader that lists dispels as such: the friendly
 * [CLEANSE] (D1, 2026-09-25), `wasRemovedByAllyDispel`, and since fact2
 * (2026-10-20) the [ENEMY CLEANSE] / [PURGE] / [ENEMY PURGE] lines
 * (08acb188 1:24: `cleansed The Hunt off 5(FWarrior) (Escape Artist)`;
 * 179b83ac: a Travel Form root break as an enemy cleanse). */
export const isRiderDispel = (d: { dispelKind?: DispelKind }): boolean =>
  d.dispelKind === "rider";

export const isDeliberateDispel = (k: DispelKind): boolean =>
  k === "deliberate";
