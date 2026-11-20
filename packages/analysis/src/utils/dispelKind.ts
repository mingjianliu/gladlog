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

import { CHANNEL_TICK_DISPEL_IDS } from "../data/channelTickDispelsGenerated";
import { spellEffectData } from "../data/spellEffectData";

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
  /** `${destUnitId}|${spellName}` → the presses aimed at that unit (fact7
   * D18, `dispelPressedBy`) */
  aimedAt: Map<string, Array<{ srcUnitId: string; timestamp: number }>>;
  /** `${srcUnitId}|${pressSpellId}` → when a delayed-repeat debuff that
   * source put out ended (`DELAYED_REPEAT_DEBUFF_IDS`), on whichever unit
   * (pipeline T191, `dispelIsDelayedRepeat`) */
  repeatEnds: Map<string, number[]>;
  /** `${srcUnitId}|${pressSpellId}` → when a later press REFRESHED such a
   * debuff at its scheduled end instead of letting it end (review
   * 85-tk-CD-T191-1 #1): the earlier press's repeat fires just after */
  repeatRefreshes: Map<string, number[]>;
}

/**
 * Pipeline T191 (GH #173.45 / #221): debuffs a dispel press leaves whose END
 * makes the same press remove again, logged under the press's own spell.
 * Improved Spellsteal: the press applies 1270828 "Spellsteal" (DEBUFF) on the
 * target — on the mage himself when the target reflects it — and when it ends
 * ~4 s later a SPELL_STOLEN of Spellsteal (30449) from the mage lands at the
 * same ms (605: 169 re-steals, all within 14 ms of the REMOVED; its life is
 * 4.00–4.05 s). When the next press lands at that scheduled end it REFRESHES
 * the debuff — no REMOVED — and steals in the refresh's own ms; the earlier
 * press's repeat follows 12–23 ms later (605: 3 refreshes 3,991–4,003 ms after
 * the previous application). Keyed debuff id → the press's spell id, which
 * the repeat's row carries (605: 171 of 171 re-steal rows are 30449, in six
 * client languages) — not the name: Kleptomania's channel tick 1231112 is
 * also named Spellsteal (pipeline T215). Registered in curatedIdRegistry.
 */
export const DELAYED_REPEAT_DEBUFF_IDS: ReadonlyMap<string, string> = new Map([
  ["1270828", "30449"], // Improved Spellsteal's debuff → Spellsteal
]);

export function createCastMatchIndex(): CastMatchIndex {
  return {
    byId: new Map(),
    byName: new Map(),
    bySource: new Map(),
    aimedAt: new Map(),
    repeatEnds: new Map(),
    repeatRefreshes: new Map(),
  };
}

/** One delayed-repeat debuff's end (`DELAYED_REPEAT_DEBUFF_IDS`): its
 * source, the press spell it repeats, when. For a raw-row reader building its own index. */
export function addRepeatEndToIndex(
  index: CastMatchIndex,
  srcUnitId: string,
  pressSpellId: string,
  timestamp: number,
  /** a SPELL_AURA_REFRESH: the next press took over at the scheduled end */
  refreshed = false,
): void {
  const k = `${srcUnitId}|${pressSpellId}`;
  const map = refreshed ? index.repeatRefreshes : index.repeatEnds;
  const list = map.get(k) ?? [];
  if (!list.includes(timestamp)) list.push(timestamp);
  map.set(k, list);
}

/**
 * Pipeline T191: a removal at the instant (`DISPEL_RIDES_PRESS_MS`) one of
 * its source's delayed-repeat debuffs of this press spell ended — the earlier
 * press's delayed effect, never a press of its own, whatever its source
 * flags and whichever press lands near it (7686e97d r3 2:24: the re-steal
 * 0.67 s before the mage's next Spellsteal was read as that press, and
 * [MISSED PURGE] said the press took the re-steal's Renew). The #221 reading
 * stands: a repeated steal is `(passive)`. After a REFRESH the repeat is a
 * removal strictly after the refresh's ms (≤ `DISPEL_RIDES_PRESS_MS`): the
 * removal in the refresh's own ms is the refreshing press's (7a4d43c8: Mark of
 * the Wild at the refresh, the repeat's Rejuvenation 12 ms later). Two steals
 * in the refresh's own ms (47867c33, once on the 605) cannot be told apart by
 * time and both stay the press's.
 */
export function dispelIsDelayedRepeat(
  index: CastMatchIndex,
  d: Pick<
    IDispelToClassify,
    "srcUnitId" | "spellId" | "spellName" | "timestamp"
  >,
): boolean {
  if (!d.spellId) return false;
  const k = `${d.srcUnitId}|${d.spellId}`;
  return (
    (index.repeatEnds.get(k) ?? []).some(
      (t) => Math.abs(t - d.timestamp) <= DISPEL_RIDES_PRESS_MS,
    ) ||
    (index.repeatRefreshes.get(k) ?? []).some(
      (t) => d.timestamp > t && d.timestamp - t <= DISPEL_RIDES_PRESS_MS,
    )
  );
}

export function addCastToIndex(
  index: CastMatchIndex,
  srcUnitId: string,
  spellId: string | null | undefined,
  spellName: string | null | undefined,
  timestamp: number,
  destUnitId?: string,
): void {
  if (destUnitId && spellName) {
    const k = `${destUnitId}|${spellName}`;
    const list = index.aimedAt.get(k) ?? [];
    list.push({ srcUnitId, timestamp });
    index.aimedAt.set(k, list);
  }
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
  d: Pick<
    IDispelToClassify,
    "srcUnitId" | "spellId" | "spellName" | "timestamp"
  >,
): boolean {
  // a delayed repeat is the earlier press's, whatever else the source
  // pressed at its instant (T191: b81efd46 r2 0:48 read "side effect of the
  // cast")
  if (dispelIsDelayedRepeat(index, d)) return false;
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
      destUnitId?: string;
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
    auraEvents?: ReadonlyArray<{
      logLine: { event: string };
      srcUnitId?: string;
      spellId?: string | null;
      spellName?: string | null;
      timestamp: number;
    }>;
  }>,
): CastMatchIndex {
  const index = createCastMatchIndex();
  for (const u of units) {
    for (const a of u.auraEvents ?? [])
      if (
        (a.logLine.event === LogEvent.SPELL_AURA_REMOVED ||
          a.logLine.event === LogEvent.SPELL_AURA_REFRESH) &&
        a.spellId &&
        DELAYED_REPEAT_DEBUFF_IDS.has(a.spellId) &&
        a.srcUnitId
      )
        addRepeatEndToIndex(
          index,
          a.srcUnitId,
          DELAYED_REPEAT_DEBUFF_IDS.get(a.spellId)!,
          a.timestamp,
          a.logLine.event === LogEvent.SPELL_AURA_REFRESH,
        );
    for (const c of u.spellCastEvents) {
      if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      addCastToIndex(
        index,
        c.srcUnitId || u.id,
        c.spellId,
        c.spellName,
        c.timestamp,
        c.destUnitId,
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
  /** a pet's owner: its command press (Command Demon's Singe Magic 119905,
   * the same name as the Imp's 89808) is the press that made the removal */
  srcOwnerId?: string;
  spellId: string | null | undefined;
  spellName: string | null | undefined;
  timestamp: number;
  /** the SPELL_DISPEL / SPELL_STOLEN row's own source flags (params[2]);
   * absent = not read */
  srcFlags?: number;
}

/** A row's source flags whose reaction is neither friendly nor hostile
 * (0x20, neutral): the recorder had not resolved the unit yet — in an arena
 * no player is neutral. 54251a4b r0 0:16: an enemy druid's two Nature's
 * Cure rows at 0x528, its auras re-broadcast at 0x548 33 ms later. */
export const isUnresolvedSourceFlags = (flags: number | undefined): boolean =>
  flags !== undefined && (flags & 0x70) === 0x20;

/**
 * Pipeline T130 (CXA13 D33): a dispel with no cast row of its own, logged
 * while its source was unresolved (`isUnresolvedSourceFlags`), of a spell
 * that source logged a SPELL_CAST_SUCCESS of elsewhere in the round (same id
 * or name) — a button it presses, whose cast row the recorder did not write
 * while the unit was unseen. A press, not a proc. A spell nobody casts
 * (Cleanse the Weak, Disentanglement Effect) stays a proc unresolved or not;
 * a resolved source's missing cast row means what it meant before (605: of
 * 15 unresolved proc rows, 11 were such buttons — Nature's Cure, Spellsteal,
 * Greater Purge, Purify).
 */
/** How far back a press of the same spell by the same source makes an
 * unresolved, cast-less removal that press's delayed effect rather than a
 * press of its own (`dispelOfUnseenPress`): Improved Spellsteal's 4 s repeat,
 * with a second of log slack. */
export const UNSEEN_PRESS_REPEAT_GUARD_MS = 5000;

export function dispelOfUnseenPress(
  index: CastMatchIndex,
  d: IDispelToClassify,
): boolean {
  if (!isUnresolvedSourceFlags(d.srcFlags)) return false;
  const casts = [
    ...(d.spellId ? (index.byId.get(`${d.srcUnitId}|${d.spellId}`) ?? []) : []),
    ...(d.spellName
      ? (index.byName.get(`${d.srcUnitId}|${d.spellName}`) ?? [])
      : []),
  ];
  if (casts.length === 0) return false;
  // a press of the same spell just before is the cause, not a hidden second
  // press: Improved Spellsteal repeats the steal 4 s after the cast, logged
  // with the mage's own GUID and 0x528 (codex T130-1: 081952f3 r1 +4.000 s,
  // f55b2412 r5 +4.018 s)
  return !casts.some(
    (t) => t < d.timestamp && d.timestamp - t <= UNSEEN_PRESS_REPEAT_GUARD_MS,
  );
}

/** Dispel spell id → the pressed auras whose periodic trigger casts it
 * (`CHANNEL_TICK_DISPEL_IDS`, official: SpellEffect aura 23), inverted. */
const CHANNELS_OF_TICK_DISPEL: ReadonlyMap<string, readonly string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [press, ticks] of CHANNEL_TICK_DISPEL_IDS)
    for (const tick of ticks) m.set(tick, [...(m.get(tick) ?? []), press]);
  return m;
})();

/**
 * Pipeline T215 (round-14 D31, ae1d0895 r0): the press a periodic removal is
 * a tick of — the source's last cast, at or before the removal, of a spell
 * whose aura fires this dispel spell on a period
 * (`CHANNEL_TICK_DISPEL_IDS`: Kleptomania 198100 → Spellsteal 1231112, every
 * 0.5 s for 4 s), no longer ago than that aura's official duration plus the
 * cast-match window. The log writes one SPELL_STOLEN per tick and no cast
 * row of the tick's own id, so the same-id / same-name match saw ten
 * removals of three pressed channels as eight procs and two riders. Haste
 * and an interrupt only shorten the aura: the official duration is the upper
 * bound. Undefined for every other dispel spell.
 */
export function channelPressOfTickDispel(
  /** the source's SPELL_CAST_SUCCESS timestamps (epoch ms) of a spell id */
  castsOf: (spellId: string) => readonly number[] | undefined,
  dispelSpellId: string | null | undefined,
  atMs: number,
): number | undefined {
  if (!dispelSpellId) return undefined;
  let found: number | undefined;
  for (const press of CHANNELS_OF_TICK_DISPEL.get(dispelSpellId) ?? []) {
    const lastsMs = (spellEffectData[press]?.durationSeconds ?? 0) * 1000;
    for (const t of castsOf(press) ?? []) {
      if (t > atMs + DISPEL_RIDES_PRESS_MS) continue;
      if (atMs - t > lastsMs + DISPEL_CAST_MATCH_WINDOW_MS) continue;
      if (found === undefined || t > found) found = t;
    }
  }
  return found;
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
  // fact5 retest r3 2fd86b1f 2:18 / 3:35: the warlock's Singe Magic
  // command 1 ms before the Imp's removal read `(passive)`
  const owner =
    d.srcOwnerId && !/^0+$/.test(d.srcOwnerId) ? d.srcOwnerId : undefined;
  const ownerHit =
    !!owner &&
    !!d.spellName &&
    within(index.byName.get(`${owner}|${d.spellName}`), d.timestamp);
  // a tick of a channel the source pressed (T215)
  const channelHit =
    channelPressOfTickDispel(
      (id) => index.byId.get(`${d.srcUnitId}|${id}`),
      d.spellId,
      d.timestamp,
    ) !== undefined;
  return idHit || nameHit || ownerHit || channelHit;
}

/**
 * Who pressed a dispel whose SPELL_DISPEL rows name its RECIPIENT as source:
 * the unit whose same-named cast was aimed at that source inside the match
 * window, when the source itself logged none. Mending Bandage writes its
 * cast row from the hunter and its dispel rows self → self on the unit it was
 * put on (d2e6e70b 0:26, fact7 D18: the warlock's "passive"). Undefined for
 * every other dispel. The caller checks the presser is on the source's team.
 */
export function dispelPressedBy(
  index: CastMatchIndex,
  d: IDispelToClassify,
): string | undefined {
  if (!d.spellName || dispelCameWithOwnCast(index, d)) return undefined;
  return index.aimedAt
    .get(`${d.srcUnitId}|${d.spellName}`)
    ?.find(
      (c) =>
        c.srcUnitId !== d.srcUnitId &&
        Math.abs(c.timestamp - d.timestamp) <= DISPEL_CAST_MATCH_WINDOW_MS,
    )?.srcUnitId;
}

/**
 * A logged SPELL_DISPEL as its presser's: the actor rewrite
 * (`dispelPressedBy`, kept only for a presser on the logged source's team),
 * then the kind of the rewritten row. The one reading of "whose dispel, and
 * was it pressed" — `reconstructDispelSummary` stamps its lines with it, and
 * the audit readers (`confidenceAudit.ts`, `dispelKindScan.ts`) count kinds
 * with it (GH #173 item 22: they carried a copy of the rewrite, held equal by
 * a test).
 */
export function dispelAsPressed<D extends IDispelToClassify>(
  index: CastMatchIndex,
  logged: D,
  /** is this presser on the logged source's team */
  onSourceTeam: (presserId: string) => boolean,
): { dispel: D; presserId?: string; kind: DispelKind } {
  const found = dispelPressedBy(index, logged);
  const presserId =
    found !== undefined && onSourceTeam(found) ? found : undefined;
  const dispel =
    presserId === undefined ? logged : { ...logged, srcUnitId: presserId };
  return {
    dispel,
    ...(presserId === undefined ? {} : { presserId }),
    kind: classifyDispel(index, dispel),
  };
}

export function classifyDispel(
  index: CastMatchIndex,
  d: IDispelToClassify,
): DispelKind {
  // The list wins over the cast match: a form shift IS a cast, but its dispel
  // is a root-break rider, not a cleanse decision.
  if (d.spellId && MOVEMENT_ROOT_BREAK_DISPEL_IDS.has(d.spellId))
    return "rider";
  if (dispelIsDelayedRepeat(index, d)) return "proc";
  return dispelCameWithOwnCast(index, d) || dispelOfUnseenPress(index, d)
    ? "deliberate"
    : "proc";
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
