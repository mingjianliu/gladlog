import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import {
  castsOfTalentEffectAura,
  effectAurasOfCast,
} from "../data/castEffectAuras";
import {
  effectiveCooldownSeconds,
  getEnglishSpellName,
} from "../data/spellEffectData";
import { auraStandsForPressAt } from "./auraActivationEra";
import { buildAuraIntervals } from "./auraIntervals";
import {
  auraLifeLastPress,
  auraSurelyUpEndMs,
  auraSurelyUpUntilMs,
  otherEffectAurasOf,
} from "./auraSurelyUp";
import {
  buffDurationOfApplication,
  buffFullDurationForCaster,
} from "./buffDuration";
import { registerMemoInput } from "./combatMemo";
// call-time only (cooldowns reads this module's table the same way)
import {
  canonicalSpellId,
  isEnemyCdWindowSpell,
  offensiveCdOfAura,
} from "./cooldowns";
import { relistedRunAt } from "./hiddenPress";
import { logInstantOf } from "./logEra";
import { isResyncBatchAt } from "./resyncBatch";
import { roundEndMs } from "./roundEnd";
import { offensiveDangerWeight } from "./spellDanger";
import { talentOwnershipOf } from "./talentOwnership";

/**
 * GH #119 — offensive-cooldown effects whose only evidence is an AURA.
 *
 * Two effects in the corpus never (or rarely) log the button press, so the
 * cast-based enemy burst timeline (`reconstructEnemyCDTimeline`) never saw
 * them (`offensiveEffectGapScan`, 605 archive files, 2026-09-26):
 *
 *  - Havoc Metamorphosis. The 191427 button never logs a cast; the press
 *    shows as the leap landing 200166, logged 0.3–1 s after the 162264 aura
 *    goes up (258 of 266). The same aura also comes from **Demonic** 213410
 *    (official tooltip: Eye Beam puts you in demon form for 5 s; a DB2 dummy
 *    aura, no trigger row): 815 of 1,093 applications have an Eye Beam 198013
 *    cast by the same player at −4…+0.3 s. 12 have neither.
 *  - Doom Winds 466772 (Enhancement, 8 s). Granted by a 384352 press (27
 *    logged) and by Ascendance 114051 (171); 73 more carry neither but are
 *    followed by the 469270 storm pulses — an unlogged 384352 press (DB2 says
 *    only those two spells trigger it; the owner ledger's
 *    AURA_ONLY_ACTIVATION_IDS reads the same buff the same way). That is the
 *    12.1.0 reading; from 12.1.5 the press logs and such a buff is a proc
 *    (`auraStandsForPressAt`, utils/auraActivationEra.ts — fact11 D7).
 *
 * User rulings (2026-09-26): both Metamorphosis populations count (「算」);
 * a Doom Winds without a logged press is an ordinary Doom Winds occurrence
 * (「有时候算 可能爆发质量不高 要根据情况看」 — its 60 s weight 0.69 opens no
 * window alone); an Ascendance-granted Doom Winds is ONE burst, Ascendance's
 * (「一次呀」). The weight of the Demonic form is `OFFENSIVE_AURA_FLAGS.demonic`.
 *
 * Every occurrence is built from `buildAuraIntervals` on the ROUND-BOUNDED,
 * self-sourced aura events (the builder clamps timestamps, it does not drop
 * them — codex astra), so the observed removal is the end whenever there is
 * one. Registered in `data/curatedIdRegistry.ts`.
 */

/** The aura ids this module answers for. `hasOffensiveSpellActive` skips
 * exactly these in its raw open-ended loop and asks `auraOffensiveActiveAt`
 * instead — one interval interpretation (agy review: only the auras this
 * module extracts, never the cast ids). */
export const OFFENSIVE_AURA_EVIDENCE: ReadonlyMap<
  string,
  { cooldownId: string; name: string; twin?: true }
> = new Map([
  ["162264", { cooldownId: "191427", name: "Metamorphosis" }],
  ["466772", { cooldownId: "384352", name: "Doom Winds" }],
  // AURA TWINS of canonical casts (GH #119 follow-up, user 2026-09-27
  // 「都做了吧」): the cast id is in OFFENSIVE_CD_SPELL_IDS, the aura id never
  // was, so aura consumers could not see the effect. 605 files: every
  // aura application follows its cast by the same unit (Infernal 207 / 209,
  // gap ≈ 1.0 s — DB2 1122 triggers 111685; Arcane Surge 203 / 203 and
  // Ascendance 146 / 146 at the same ms — both casts are DB2 dummies whose
  // script applies the aura). Cast-backed lifetimes 30 / 15 / 15 s. The
  // timeline priced Summon Infernal at DB2's 0.25 s cast row until now.
  ["111685", { cooldownId: "1122", name: "Summon Infernal", twin: true }],
  ["365362", { cooldownId: "365350", name: "Arcane Surge", twin: true }],
  ["1219480", { cooldownId: "114050", name: "Ascendance", twin: true }],
  // F15 / fact1215 C5 (2026-10-18): Radiant Glory's Avenging Wrath. The log
  // writes most activations as a 454351 SPELL_CAST_SUCCESS in the ms of a
  // Wake of Ashes (the enemy timeline's `proc k of N`); the Holy-Power-spend
  // proc puts the 454351 aura up with no cast at all (519781fd 5:56.596 →
  // 6:05.600, no [ENEMY CD] line, no `enemy:` column at 6:01). A cast-backed
  // aura folds into its cast as for the other twins; one with none is the
  // `(no press)` occurrence — weight 0, never a window on its own.
  ["454351", { cooldownId: "454351", name: "Avenging Wrath", twin: true }],
]);
/**
 * fact7 class 3 (D69): offensive forms a press enters that the log never
 * writes as a press — a timeline fact, never a burst (`burstRole: "fact"`,
 * the `offensiveFacts` line; DB2 has no cooldown for it).
 * Void Metamorphosis 1217607 is a button (pipeline T291): SpecializationSpells
 * 7141 gives the Devourer 1217605, overriding Metamorphosis 191427, which
 * "Requires" the 1225789 stacks. Its SPELL_CAST_SUCCESS is never logged — 0
 * rows beside 145 entries (605) and 176 (12.1.5 files) — but the recorder's
 * own refused presses are (70 SPELL_CAST_FAILED 1217605 on the 605: "Not
 * yet recovered", "Can't do that while disoriented"), and the entry comes
 * 0.4–29 s after the stack that filled the bar (median 2.8 / 3.0 s), never
 * with it: a press, not the stacks. So the line names a press (the enemy
 * line without `(no press)`; the friendly one `emitFriendlyFormEntries`'
 * `[CD]` with `UNLOGGED_PRESS_SUFFIX`, GH #193's wording). Registered in
 * `curatedIdRegistry.ts`.
 */
export const OFFENSIVE_FORM_FACT_AURAS: ReadonlyMap<string, string> = new Map([
  ["1217607", "Void Metamorphosis"],
]);

/** A twin's cast is logged at most this long before its aura (Infernal:
 * ≈ 1.0 s, the summon landing — p90 1.02 s on 207 pairs) or 0.5 s after
 * (log order). Not widened for lag: the only cast-less applications in 605
 * files lasted 0.4–10.3 s, i.e. short procs, not late-landing presses. */
export const TWIN_CAST_BEFORE_S = 3;
export const TWIN_CAST_AFTER_S = 0.5;

/**
 * fact5 D16 class (F18; user ruling 2026-10-25, 「通用规则」): every other
 * enemy offensive cooldown's own aura that goes up with no press of it —
 * a talent proc, read off the log the way the twins' cast-less branch reads
 * Radiant Glory's Avenging Wrath (C5). 605 capture: 292 such applications,
 * none on the timeline. The triggers, from the official tooltips:
 * Recklessness ← Enduring Rage 411764 (PvP: 「受到失控效果影响有一定几率
 * 使你获得鲁莽」), Malevolence ← 1266805 (「枯萎的周期性伤害有几率使你获得
 * 怨毒」), Avatar ← Odyn's Fury (Titan's Torment). The cooldown an aura is the
 * effect of is `offensiveCdOfAura` (the enemy-CD window test included); an
 * application within `TWIN_CAST_BEFORE_S` / `TWIN_CAST_AFTER_S` of a press of
 * the same-named spell, or of a cast whose own effect it is (Ascendance →
 * Doom Winds: one burst, Ascendance's — ruling 2026-09-26), is that press's;
 * an interval whose start the log did not see is no new application.
 * Undefined for the ids `OFFENSIVE_AURA_EVIDENCE` answers for.
 */
/** The words an occurrence no press backs closes on. */
export const NO_PRESS_SUFFIX = " (no press)";

/** A press of the same cooldown up to this long after a cast-less
 * application is that press: the two print in one rendered second, and the
 * log can write the aura half a second before its press row (605 s2/38-3
 * 0:14: Recklessness 14.224 s, pressed with Avatar at 14.725 s — the
 * `(no press)` line and the press line stood side by side, corpusFactScan2
 * duplicateLine). */
export const GENERIC_PRESS_AFTER_MS = 1000;

/** A press row at most this many lines of the file after the aura row is
 * that aura's press whatever the two stamps say: with over
 * `GENERIC_PRESS_AFTER_MS` between them the file wrote at most one row in
 * that time — a log-write stall, the press row stamped when the batch was
 * flushed (fact14 D13, 6df8aae6 0:13: Army of the Dead's aura row at
 * 13.465 s, the file's next row 1.568 s later, the press row one line
 * after that; the aura ran its exact 30.003 s from its own row). Two lines
 * is how a press and its own aura stand in the file: 6,186 of 6,841
 * same-name pairs on 16 archives (scan5/t186 `pressRowDistance`), the
 * audited pair among them. 605: no `(no press)` occurrence has such a
 * press (0 of 619; the 67 a later press follows have 68–1,030 rows
 * between). */
export const PRESS_ROW_ADJACENT_LINES = 2;

function genericCdOfAura(
  auraSpellId: string,
  /** the unit's spec: its own buff, so the caster's (GH #184 part B) */
  spec?: unknown,
): string | undefined {
  if (OFFENSIVE_AURA_EVIDENCE.has(auraSpellId)) return undefined;
  // a talent aura a press's effect runs on (Divine Resonance) is that
  // press's span, read from the press (`talentEffectAuraAtPress`) — never an
  // occurrence of its own: the press pairing below knows a same-named press
  // or a cast whose own effect the aura is, and neither holds (pipeline T155)
  if (castsOfTalentEffectAura(auraSpellId).length > 0) return undefined;
  const cd = offensiveCdOfAura(auraSpellId, spec);
  // the enemy-CD window test on the resolved id too: a table id with no
  // cooldown is no cooldown tracker's (codex 20-F18-02 #2: Archangel 81700)
  return cd !== undefined && isEnemyCdWindowSpell(cd, spec) ? cd : undefined;
}

/** Cast ids read as evidence (registered with the table above). */
/** The leap landing: how a Metamorphosis press shows up, logged after the
 * form went up — the one cast row `metamorphosisPressActivationMs` dates. */
export const METAMORPHOSIS_LANDING_ID = "200166";
export const METAMORPHOSIS_PRESS_CAST_IDS: ReadonlySet<string> = new Set([
  // the button — no SUCCESS row of it on the 605 files (2026-11-08), kept
  // for safety; a logged one is its own press instant on both sides (the
  // enemy side keeps a logged cast's own start, codex T05-2b)
  "191427",
  METAMORPHOSIS_LANDING_ID,
]);
export const EYE_BEAM_ID = "198013";
/** Annihilation and Death Sweep — what Chaos Strike and Blade Dance become
 * in demon form and only there (162264's own aura text: "Chaos Strike and
 * Blade Dance upgraded to Annihilation and Death Sweep"): a logged cast of
 * either is the form up at that instant (T212). */
export const METAMORPHOSIS_FORM_CAST_IDS: ReadonlySet<string> = new Set([
  "201427",
  "210152",
]);
export const DOOM_WINDS_PRESS_ID = "384352";
export const ASCENDANCE_ENH_ID = "114051";

/** Demonic's official duration (213410: dummy aura, 5000 ms) — the inferred
 * end of a Demonic form whose removal was never logged. */
export const DEMONIC_FORM_SECONDS = 5;
/** A Metamorphosis press is logged by its landing 0.3–1 s after the aura
 * goes up (258 of 266 in 605 files; 3 at 1–3 s). A press later than this
 * after the interval start is a press INTO a form Demonic already opened:
 * the interval is split there, and the press occurrence starts at the press
 * (agy review: never anchor a later commitment at the earlier start). */
export const PRESS_LANDING_LAG_S = 1.5;
/** Demonic (213410): the talent that makes Eye Beam open a demon form. */
export const DEMONIC_TALENT_ID = "213410";
/**
 * When a Metamorphosis press went up: the press's OWN 162264 row — an
 * APPLIED (the press opened the form) or a REFRESH (a press into a form
 * already up) by the unit on itself, the EARLIEST within
 * `PRESS_LANDING_LAG_S` before the press's 200166 landing row of the form
 * instance still up at the landing (no REMOVED between the row and the
 * landing) — else the landing row itself.
 *
 * A row an Eye Beam explains is that Eye Beam's Demonic form, not this press
 * (codex B11 #2: Demonic up at 32.885 s, the round over at 33.744 s, a press
 * REFRESHing it at 34.000 s with its landing at 34.200 s went up after the
 * round): the first form row whose [row − `EYE_BEAM_BEFORE_S`, row +
 * `EYE_BEAM_AFTER_S`] holds an Eye Beam cast, the window the enemy side names
 * a Demonic form by; one Eye Beam explains one row. Only for a unit that may
 * hold Demonic (`talentOwnershipOf` not "no"): without the talent an Eye Beam
 * opens no form, and a press 2.4 s after one is the press's own row (codex
 * T05-2 #1). A Demonic holder whose Demonic row was never logged stays
 * indistinguishable from a press inside the window — that one reads as the
 * landing (the window is 0.4 s wide: 0 of 263 landings in 605 files had an
 * Eye Beam row within the landing lag).
 *
 * T05 (fact12 A6 / B7 / C19, 52a97230 r0): the aura went up at 0:32.885,
 * the round-ending death came at 0:33.744 and the 200166 landing at
 * 0:33.809; the friendly ledger read the landing and the kit said
 * `[UNUSED]`. Every reader dates the press here: the friendly ledger
 * (`cooldowns.ts` `buildCooldownEntry`: the round cut, the readiness at an
 * instant, the press line) and the enemy occurrence below (its start when the
 * press split a form, and `availableAgainAtMs`, codex T05-2 #2); scan5 `t05`
 * reads the same.
 */
export function metamorphosisPressActivationMs(
  unit: Pick<ICombatUnit, "id" | "auraEvents" | "spellCastEvents" | "spec"> & {
    info?: ICombatUnit["info"];
  },
  rowMs: number,
): number {
  const own = (unit.auraEvents ?? []).filter(
    (a) =>
      a.spellId === "162264" &&
      a.srcUnitId === unit.id &&
      (a.destUnitId === undefined || a.destUnitId === unit.id),
  );
  /** the unit's own 162264 APPLIED / REFRESH rows, in time order */
  const rows = own
    .filter(
      (a) =>
        a.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
        a.logLine.event === LogEvent.SPELL_AURA_REFRESH,
    )
    .map((a) => a.logLine.timestamp)
    .sort((x, y) => x - y);
  const removals = own
    .filter((a) => a.logLine.event === LogEvent.SPELL_AURA_REMOVED)
    .map((a) => a.logLine.timestamp);
  // one Eye Beam explains one form row: the first in its window
  const explained = new Set<number>();
  if (talentOwnershipOf(unit, DEMONIC_TALENT_ID) !== "no")
    for (const c of unit.spellCastEvents ?? []) {
      if (
        c.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS ||
        c.spellId !== EYE_BEAM_ID
      )
        continue;
      const e = c.logLine.timestamp;
      const i = rows.findIndex(
        (t, k) =>
          !explained.has(k) &&
          e >= t - EYE_BEAM_BEFORE_S * 1000 &&
          e <= t + EYE_BEAM_AFTER_S * 1000,
      );
      if (i >= 0) explained.add(i);
    }
  const k = rows.findIndex(
    (t, i) =>
      !explained.has(i) &&
      t <= rowMs &&
      t >= rowMs - PRESS_LANDING_LAG_S * 1000 &&
      !removals.some((r) => r > t && r < rowMs),
  );
  return k >= 0 ? rows[k]! : rowMs;
}

/**
 * The instant a logged cast row of `spellId` stands for: a Metamorphosis
 * landing row (`METAMORPHOSIS_LANDING_ID`) at its activation
 * (`metamorphosisPressActivationMs`), every other row — a logged 191427
 * button row included (codex T05-2b) — at its own instant. The friendly
 * ledger (`cooldowns.ts` `buildCooldownEntry`) and scan5 `t05` read this
 * one selection (B19 assembly review: the scan's generic fallback backdated
 * a 191427 row the ledger kept).
 */
export function castRowActivationMs(
  unit: Parameters<typeof metamorphosisPressActivationMs>[0],
  spellId: string,
  rowMs: number,
): number {
  return spellId === METAMORPHOSIS_LANDING_ID
    ? metamorphosisPressActivationMs(unit, rowMs)
    : rowMs;
}

/** Evidence tolerance around an aura start (cast ↔ aura association). */
export const AURA_EVIDENCE_WINDOW_S = 3;
/** Eye Beam cast window relative to the Demonic aura: the cast is logged up
 * to 0.3 s AFTER the aura it grants, never before it. Measured on 605 files
 * (T05 a2, 2026-11-08): of 816 Eye Beams followed by a form row within 6 s,
 * 815 had the row 0–86 ms BEFORE the cast, 1 came 5.4 s later (outside any
 * window); 281 opened no form. The old 4 s before-slack had no support and
 * let an Eye Beam claim a press's own row 2.4 s later (codex T05-2 #1). */
const EYE_BEAM_BEFORE_S = 0.1;
const EYE_BEAM_AFTER_S = 0.3;

/** How a Demonic (Eye Beam) Metamorphosis form counts. User ruling
 * 2026-09-26 (GH #119): 「算小爆发」 → "minor": a burst everywhere (burst
 * fields, crisis bursts, the aura-path "offensive active" check, the count of
 * cooldowns aligned in a window) priced by what produces it — Eye Beam's 30 s
 * cooldown, `offensiveDangerWeight(198013)` = 0 — so it never opens a window
 * on its own. Not `[friendly offensive CD active]`: that tag reads spent
 * cooldowns only (`friendlyOffensiveCdActiveAt` filters with
 * `isEnemyCdWindowSpell`, which a Demonic occurrence, 162264 with no
 * Metamorphosis press, fails) — user ruling 2026-11-09 (pipeline T30). The
 * two alternatives measured on 605 files before the ruling
 * stay selectable for re-measurement: "burst" = weighted like the pressed
 * Metamorphosis (≈ 200 extra windows, named in 92 kick-eaten burst fields);
 * "fact" = shown on the timeline only, never a burst. */
export const OFFENSIVE_AURA_FLAGS: { demonic: "burst" | "minor" | "fact" } = {
  demonic: "minor",
};
// a reading kept per round (combatMemo.ts) is the one this setting produced
registerMemoInput("OFFENSIVE_AURA_FLAGS", () => OFFENSIVE_AURA_FLAGS.demonic);

export type AuraOccurrenceProvenance =
  "press-logged" | "press-inferred" | "proc" | "unresolved";

export interface IAuraOffensiveOccurrence {
  /** the id the timeline shows / keys on */
  spellId: string;
  spellName: string;
  startMs: number;
  endMs: number;
  endObserved: boolean;
  /** where the effect was due to end had nothing cut it — the aura's own
   * official length (this caster's talents) from its own start, Demonic's
   * 5 s from its last evidence; undefined when no length is known (a short
   * talent proc). A death-cut observed end keeps it for "time left" (GH
   * #167, codex 20-G167-06). */
  officialEndMs?: number;
  /** 0 when no cooldown was spent (a proc / unresolved form) */
  cooldownSeconds: number;
  /** when the cooldown comes back; null = no button (proc) */
  availableAgainAtMs: number | null;
  /** true when nothing tells whether a cooldown was spent */
  availabilityUnknown: boolean;
  dangerWeight: number;
  burstRole: "burst" | "fact";
  provenance: AuraOccurrenceProvenance;
  /** a cast-less application of a cooldown outside `OFFENSIVE_AURA_EVIDENCE`
   * (`genericCdOfAura`) — the timeline drops it beside a press it already
   * has (an unseen press re-stated by the log) */
  generic?: true;
}

export interface IAuraOccurrenceResult {
  occurrences: IAuraOffensiveOccurrence[];
  /** logged Doom Winds presses whose buff end was observed: cast ms → end ms
   * (the timeline overwrites that cast's estimated buff end) */
  observedEndOfCast: Map<number, number>;
  /** …and where each was due to end (the aura's own official length from
   * its start, `officialEndMs`) */
  officialEndOfCast: Map<number, number>;
  /** aura intervals that belong to a LOGGED press (the timeline already has
   * the cast) — the aura path still needs them as "active" */
  castCovered: Array<{ spellId: string; startMs: number; endMs: number }>;
}

type Bounds = { startTime: number; endTime: number };

function castTimes(unit: ICombatUnit, ids: ReadonlySet<string>): number[] {
  const out: number[] = [];
  for (const c of unit.spellCastEvents ?? []) {
    if (c.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    if (c.spellId && ids.has(c.spellId)) out.push(c.logLine.timestamp);
  }
  return out.sort((a, b) => a - b);
}

/** a row written with no source (`0000000000000000` / empty) */
function isSourceless(srcUnitId: string | undefined): boolean {
  return !srcUnitId || srcUnitId === "0000000000000000";
}
const CLOSING_EVENTS: ReadonlySet<string> = new Set([
  LogEvent.SPELL_AURA_REMOVED,
  LogEvent.SPELL_AURA_BROKEN,
  LogEvent.SPELL_AURA_BROKEN_SPELL,
]);

const cache = new WeakMap<object, Map<string, IAuraOccurrenceResult>>();
const boundsCache = new WeakMap<object, Bounds | null>();

/**
 * The aura-evidenced offensive occurrences of one unit inside `bounds`.
 * Cached per unit + bounds (hasOffensiveSpellActive asks once per second).
 */
export function auraOffensiveOccurrences(
  unit: ICombatUnit,
  bounds: Bounds,
): IAuraOccurrenceResult {
  // T308: an aura shown still up past its cap runs to the round's end —
  // read only when `bounds` is the combat itself (its units: a Solo Shuffle
  // round's ending death). A synthetic window (a reader's own start / end)
  // knows no round end and would read a strike after the round's ending
  // death as evidence (codex 85-tk-L5-T308-1 #3); it keeps the official
  // end. Part of the key: the same start / end come both ways.
  const roundEnd =
    (bounds as { units?: unknown }).units !== undefined
      ? roundEndMs(bounds)
      : undefined;
  // …and the rows the evidence is read from: a unit whose damage / heal
  // rows, casts (its next press), deaths or aura rows grew since is read
  // again (codex 85-tk-L5-T308-1b #10, 1c #8, 1d #6)
  const key = `${bounds.startTime}:${bounds.endTime}:${roundEnd ?? "-"}:${unit.damageOut?.length ?? 0}:${unit.healOut?.length ?? 0}:${unit.spellCastEvents?.length ?? 0}:${unit.deathRecords?.length ?? 0}:${unit.auraEvents?.length ?? 0}:${OFFENSIVE_AURA_FLAGS.demonic}`;
  let byKey = cache.get(unit);
  if (!byKey) {
    byKey = new Map();
    cache.set(unit, byKey);
  }
  const hit = byKey.get(key);
  if (hit) return hit;

  const result: IAuraOccurrenceResult = {
    occurrences: [],
    observedEndOfCast: new Map(),
    officialEndOfCast: new Map(),
    castCovered: [],
  };
  const events = (unit.auraEvents ?? []).filter(
    (a) =>
      a.spellId !== undefined &&
      (OFFENSIVE_AURA_EVIDENCE.has(a.spellId) ||
        OFFENSIVE_FORM_FACT_AURAS.has(a.spellId) ||
        // a generic one: the unit's own buff on itself
        (a.destUnitId === unit.id &&
          genericCdOfAura(a.spellId, unit.spec) !== undefined)) &&
      // …and a REMOVED written with no source of an aura on the unit: the
      // interval builder closes the oldest open life of the spell with it,
      // as the timeline does (codex 85-tk-L5-T308-1c #2: dropped here, the
      // life ran on to the round's end)
      (a.srcUnitId === unit.id ||
        (isSourceless(a.srcUnitId) &&
          a.destUnitId === unit.id &&
          CLOSING_EVENTS.has(a.logLine.event))) &&
      a.logLine.timestamp >= bounds.startTime &&
      a.logLine.timestamp <= bounds.endTime,
  );
  if (events.length === 0) {
    byKey.set(key, result);
    return result;
  }
  const intervals = buildAuraIntervals(
    { ...unit, auraEvents: events } as ICombatUnit,
    bounds,
    new Map([[unit.id, unit]]),
    unit.auraEvents,
  );
  const pressCasts = castTimes(unit, METAMORPHOSIS_PRESS_CAST_IDS);
  const landings = new Set(
    castTimes(unit, new Set([METAMORPHOSIS_LANDING_ID])),
  );
  const pressIsLanding = (ms: number) => landings.has(ms);
  const eyeBeams = castTimes(unit, new Set([EYE_BEAM_ID]));
  const formCasts = castTimes(unit, METAMORPHOSIS_FORM_CAST_IDS);
  const doomWindsPresses = castTimes(unit, new Set([DOOM_WINDS_PRESS_ID]));
  const ascendances = castTimes(unit, new Set([ASCENDANCE_ENH_ID]));
  const W = AURA_EVIDENCE_WINDOW_S * 1000;
  const near = (list: number[], t: number, lo: number, hi: number) =>
    list.find((x) => x - t >= lo && x - t <= hi);
  /** the latest APPLIED / REFRESH / DOSE of `spellId` in [fromMs, toMs] */
  const lastEvidenceMs = (spellId: string, fromMs: number, toMs: number) => {
    let last = fromMs;
    for (const a of events) {
      const ev = a.logLine.event;
      if (
        a.spellId === spellId &&
        (ev === LogEvent.SPELL_AURA_APPLIED ||
          ev === LogEvent.SPELL_AURA_REFRESH ||
          ev === LogEvent.SPELL_AURA_APPLIED_DOSE) &&
        a.logLine.timestamp >= fromMs &&
        a.logLine.timestamp <= toMs &&
        a.logLine.timestamp > last
      )
        last = a.logLine.timestamp;
    }
    return last;
  };

  const metaWeight = offensiveDangerWeight(
    "191427",
    (id) => effectiveCooldownSeconds(id) ?? 0,
  );
  const metaCd = effectiveCooldownSeconds("191427") ?? 0;
  // a Demonic form is produced by Eye Beam: priced at ITS cooldown
  const eyeBeamWeight = offensiveDangerWeight(
    EYE_BEAM_ID,
    (id) => effectiveCooldownSeconds(id) ?? 0,
  );

  const usedTwinCasts = new Set<string>();
  const successes = (unit.spellCastEvents ?? []).filter(
    (c) => c.logLine?.event === LogEvent.SPELL_CAST_SUCCESS && !!c.spellId,
  );
  for (const iv of intervals) {
    const startMs = bounds.startTime + iv.fromS * 1000;
    let endMs = bounds.startTime + iv.toS * 1000;
    const endObserved = !iv.inferredEnd;
    /** the aura's own official end for this caster, from its own start */
    const auraFull = buffDurationOfApplication(iv.spellId, unit, startMs);
    let auraOfficialEndMs =
      auraFull === undefined ? undefined : startMs + auraFull * 1000;
    // T308 (user 2026-11-27): a life the log never closes that it shows
    // still up past its official end ran on to its last evidence row
    // (ruling (B)), never past the round's end or the caster's next press of
    // it (605 90c01e7f r6: Doom Winds, pressed with
    // only its aura in the log, struck 2 s past its 10 s with no REMOVED) —
    // the press-row reading's own predicate (`observedEffectEnd`). Past the
    // aura's own official end, not the builder's cap from a later REFRESH:
    // that REFRESH is the evidence (codex 85-tk-L5-T308-1 #4). The next press
    // is its next application or the caster's next cast row of it, whichever
    // the log shows first — a press whose application row was lost still
    // ends this life (#1).
    if (roundEnd !== undefined && iv.inferredEnd && !iv.inferredStart) {
      const nextFromS = intervals
        .filter((o) => o.spellId === iv.spellId && o.fromS > iv.fromS)
        .reduce((m, o) => Math.min(m, o.fromS), Infinity);
      const pressId = genericCdOfAura(iv.spellId, unit.spec);
      // the next press: its next application, or the caster's next cast row
      // of any button that puts this aura up (`nextAuraPressMs`)
      // …a granting press inside the life's span carries it on from its
      // own press (`auraLifeLastPress`, codex 85-tk-L5-T308-1e #1)
      const life = auraLifeLastPress(
        unit,
        iv.spellId,
        pressId,
        startMs,
        Math.min(endMs, auraOfficialEndMs ?? endMs),
        (atMs) => buffDurationOfApplication(iv.spellId, unit, atMs),
      );
      const nextPressMs = Math.min(
        bounds.startTime + nextFromS * 1000,
        life.nextPressMs,
      );
      const capMs = life.capMs;
      // a life a granting press carried on is DUE off at that press's end:
      // the countdown reads it there (codex 85-tk-L5-T308-1g #2: an earlier
      // kill clipped the life and `[RES]` counted to the first press's end)
      if (life.pressMs > startMs && auraOfficialEndMs !== undefined)
        auraOfficialEndMs = Math.max(auraOfficialEndMs, life.capMs);
      // never past its holder's death, from the life's start (#4, 1c #4)
      const untilMs = auraSurelyUpUntilMs(
        unit,
        startMs,
        Math.min(roundEnd, nextPressMs),
      );
      const otherAuraIds = otherEffectAurasOf(pressId, iv.spellId);
      // …to its last evidence row (ruling (B), codex 85-tk-L5-T308-1h #1)
      const evidenceEndMs = auraSurelyUpEndMs(
        unit,
        unit,
        iv.spellId,
        pressId ?? iv.spellId,
        capMs,
        untilMs,
        { nextPressMs, otherAuraIds, lifeStartMs: startMs },
      );
      // (it holds the renewed length already; shorter only where the next
      // press, a death or the round's end cuts it)
      if (evidenceEndMs !== undefined) endMs = evidenceEndMs;
      // …and with none past it, a life a granting press carried on runs
      // that press's own length (codex 85-tk-L5-T308-1f #1: strikes to 22.2
      // s after an Ascendance at 12.5 s, the life read off at 19.2 s)
      else if (life.pressMs > startMs)
        endMs = Math.max(endMs, Math.min(life.capMs, roundEnd, nextPressMs));
    }
    const formName = OFFENSIVE_FORM_FACT_AURAS.get(iv.spellId);
    if (formName !== undefined) {
      if (iv.inferredStart) continue;
      // a press the log writes only as its form (T291)
      result.occurrences.push({
        spellId: iv.spellId,
        spellName: formName,
        startMs,
        endMs,
        endObserved,
        cooldownSeconds: 0,
        availableAgainAtMs: null,
        availabilityUnknown: true,
        dangerWeight: 0,
        burstRole: "fact",
        provenance: "press-inferred",
      });
      continue;
    }

    const genericCd = genericCdOfAura(iv.spellId, unit.spec);
    if (genericCd !== undefined) {
      if (iv.inferredStart) continue;
      const name = getEnglishSpellName(genericCd, iv.spellName);
      // a press of this button: under its name, as a cast that makes this
      // aura, or as a DB2 override variant of it (fact7 D68: Predator's Wake
      // 1259431's own buff, its The Hunt row lost to the caster's death).
      // Undated on purpose: which press PUT UP this aura is the effect, not
      // the cooldown — Predator's Wake makes it on 12.1.0 logs too, where it
      // spends a cooldown of its own (fact11 D22; dated, it read the aura a
      // `The Hunt (no press)` proc beside the Wake that made it, 9efe5b38 0:36)
      const isThisButton = (c: {
        spellId?: string | null;
        spellName?: string;
      }) =>
        getEnglishSpellName(c.spellId!, c.spellName ?? "") === name ||
        canonicalSpellId(c.spellId!) === canonicalSpellId(genericCd);
      const pressed = successes.some(
        (c) =>
          c.logLine.timestamp >= startMs - TWIN_CAST_BEFORE_S * 1000 &&
          c.logLine.timestamp <= startMs + GENERIC_PRESS_AFTER_MS &&
          (isThisButton(c) ||
            effectAurasOfCast(c.spellId!).includes(iv.spellId)),
      );
      if (pressed) continue;
      // the press row stands right after the aura row in the file, its
      // stamp late: a log-write stall (`PRESS_ROW_ADJACENT_LINES`)
      const auraLine = events.find(
        (a) =>
          a.spellId === iv.spellId &&
          a.logLine.timestamp === startMs &&
          a.logLine.event === LogEvent.SPELL_AURA_APPLIED,
      )?.logLine.lineIndex;
      if (
        auraLine !== undefined &&
        successes.some((c) => {
          const line = c.logLine.lineIndex;
          return (
            line !== undefined &&
            line > auraLine &&
            line <= auraLine + PRESS_ROW_ADJACENT_LINES &&
            c.logLine.timestamp > startMs &&
            // the aura the press is taken for is still up at the press
            // row, and no row of it stands between the two (an end the
            // file wrote before the press row: the press is another one's
            // — codex 85-tk-CD-T186-1)
            c.logLine.timestamp <= endMs &&
            !events.some(
              (a) =>
                a.spellId === iv.spellId &&
                a.logLine.lineIndex !== undefined &&
                a.logLine.lineIndex > auraLine &&
                a.logLine.lineIndex < line,
            ) &&
            isThisButton(c)
          );
        })
      )
        continue;
      // the run under way listed again, not an aura that went up: a row of
      // the batch that re-states the unit after it was unseen
      // (`isResyncBatchAt`) which re-lists a run still going
      // (`relistedRunAt`) — the unseen-press reader's own two tests (T85,
      // wide s1/195 r1 2:34: a Combustion pressed at 2:20 and past its
      // official length, listed again when the mage left Greater
      // Invisibility). A proc is a row of its own, in no batch.
      if (
        isResyncBatchAt(unit, startMs) &&
        relistedRunAt(unit, iv.spellId, startMs)
      )
        continue;
      // a press of it later inside the interval (a REFRESH) takes over from
      // there: the proc ends at the press (codex 20-F18-02 #3, 4501dd64
      // 2:19.9 → the 2:32.0 press), as a Metamorphosis press splits a form
      const laterPress = successes
        .filter(
          (c) =>
            c.logLine.timestamp > startMs + GENERIC_PRESS_AFTER_MS &&
            c.logLine.timestamp < endMs &&
            isThisButton(c),
        )
        .map((c) => c.logLine.timestamp)
        .sort((a, b) => a - b)[0];
      result.occurrences.push({
        spellId: genericCd,
        spellName: `${name}${NO_PRESS_SUFFIX}`,
        startMs,
        endMs: laterPress ?? endMs,
        endObserved: laterPress !== undefined ? true : endObserved,
        cooldownSeconds: 0,
        availableAgainAtMs: null,
        availabilityUnknown: true,
        dangerWeight: 0,
        burstRole: "burst",
        provenance: "unresolved",
        generic: true,
        ...(auraOfficialEndMs !== undefined
          ? { officialEndMs: auraOfficialEndMs }
          : {}),
      });
      continue;
    }

    if (iv.spellId === "162264") {
      const press = near(pressCasts, startMs, -W, endMs - startMs);
      const formOccurrence = (
        fromMs: number,
        toMs: number,
        toObserved: boolean,
      ) => {
        const eyeBeam = near(
          eyeBeams,
          fromMs,
          -EYE_BEAM_BEFORE_S * 1000,
          EYE_BEAM_AFTER_S * 1000,
        );
        const role = OFFENSIVE_AURA_FLAGS.demonic;
        // inferred end: Demonic's own 5 s from the LATEST evidence the form
        // was up (an APPLIED / REFRESH inside the segment), never from the
        // first application alone (codex review: a REFRESH at 16 s after an
        // application at 10 s proves the form at 16 s)
        const demonicEnd =
          lastEvidenceMs("162264", fromMs, toMs) + DEMONIC_FORM_SECONDS * 1000;
        const end = toObserved ? toMs : Math.min(toMs, demonicEnd);
        result.occurrences.push({
          spellId: "162264",
          spellName:
            eyeBeam !== undefined
              ? "Metamorphosis (Demonic)"
              : "Metamorphosis (source unknown)",
          startMs: fromMs,
          endMs: end,
          endObserved: toObserved,
          cooldownSeconds: 0,
          availableAgainAtMs: null,
          availabilityUnknown: eyeBeam === undefined,
          dangerWeight:
            role === "burst"
              ? metaWeight
              : role === "minor"
                ? eyeBeamWeight
                : 0,
          burstRole: role === "fact" ? "fact" : "burst",
          provenance: eyeBeam !== undefined ? "proc" : "unresolved",
          // a Demonic form runs 5 s from its last evidence; one with no Eye
          // Beam has no known length
          ...(eyeBeam !== undefined ? { officialEndMs: demonicEnd } : {}),
        });
      };
      if (press === undefined) {
        formOccurrence(startMs, endMs, endObserved);
        continue;
      }
      // the press went up at its activation, the instant the friendly ledger
      // dates it at (codex T05-2 #2): its own row, else the landing
      const activation = pressIsLanding(press)
        ? metamorphosisPressActivationMs(unit, press)
        : press;
      const splitAt = Math.max(startMs, activation);
      if (splitAt > startMs) formOccurrence(startMs, splitAt, true);
      // inferred end: the PRESS's own duration from the press, bounded by
      // the round and the next application of the aura — not the aura row's
      // 20 s cap the interval builder already applied (codex review)
      const nextStartMs =
        intervals
          .filter((o) => o.spellId === "162264" && o.fromS > iv.fromS)
          .map((o) => bounds.startTime + o.fromS * 1000)
          .sort((a, b) => a - b)[0] ?? bounds.endTime;
      const metaFull = buffFullDurationForCaster("191427", unit);
      let pressEnd = endObserved
        ? endMs
        : Math.max(
            endMs,
            Math.min(
              nextStartMs,
              bounds.endTime,
              splitAt + (metaFull ?? 0) * 1000,
            ),
          );
      // T212 (round-14 D33): with no end in the log the nominal length is
      // only where the form was DUE to end. Later evidence of the form moves
      // the end out, never past the next application or the round: a cast
      // only the form allows (`METAMORPHOSIS_FORM_CAST_IDS`) is the form up
      // at that instant, and an Eye Beam cast while it is up holds it
      // Demonic's 5 s from there (7669df4d: form from 2:26, due off at 2:50,
      // Death Sweep at 2:56, Eye Beam at 2:57, Annihilation at 2:58 / 2:59,
      // the REMOVED logged after the round's end)
      if (!endObserved) {
        const limit = Math.min(nextStartMs, bounds.endTime);
        const evidence = [
          ...formCasts.map((t) => ({ t, eyeBeam: false })),
          ...eyeBeams.map((t) => ({ t, eyeBeam: true })),
        ]
          .filter((e) => e.t > splitAt && e.t <= limit)
          .sort((a, b) => a.t - b.t);
        // to a fixed point: a form cast AFTER an Eye Beam shows the form
        // was up at that Eye Beam too, so its 5 s count (codex
        // 85-tk-CD-T212-1 #2: in 7669df4d the Eye Beam at 2:57 sits between
        // the Death Sweep at 2:56 and the Annihilations at 2:58 / 2:59 —
        // read in one pass it was skipped and the form ended at 2:59, not
        // at the round's end)
        for (let moved = true; moved;) {
          moved = false;
          for (const e of evidence) {
            const to = !e.eyeBeam
              ? e.t
              : e.t <= pressEnd
                ? Math.min(limit, e.t + DEMONIC_FORM_SECONDS * 1000)
                : pressEnd;
            if (to > pressEnd) {
              pressEnd = to;
              moved = true;
            }
          }
        }
      }
      result.occurrences.push({
        spellId: "191427",
        spellName: "Metamorphosis",
        startMs: splitAt,
        endMs: pressEnd,
        endObserved,
        cooldownSeconds: metaCd,
        availableAgainAtMs: activation + metaCd * 1000,
        availabilityUnknown: false,
        dangerWeight: metaWeight,
        burstRole: "burst",
        provenance: "press-inferred",
        ...(metaFull !== undefined
          ? { officialEndMs: splitAt + metaFull * 1000 }
          : {}),
      });
      continue;
    }

    const twin = OFFENSIVE_AURA_EVIDENCE.get(iv.spellId);
    if (twin?.twin) {
      const cdId = twin.cooldownId;
      // one cast pairs with one application: a later cast-less application
      // inside the pairing reach is its own `(no press)` occurrence, not a
      // second interval of the cast before it (codex 20-F15-25: a 454351
      // cast at 10 s, removed 10.5 s, and a cast-less one at 12.5 s were
      // merged into one 10–20.5 s Avenging Wrath)
      const cast = near(
        castTimes(unit, new Set([cdId])).filter(
          (x) => !usedTwinCasts.has(`${cdId}:${x}`),
        ),
        startMs,
        -TWIN_CAST_BEFORE_S * 1000,
        TWIN_CAST_AFTER_S * 1000,
      );
      if (cast !== undefined) usedTwinCasts.add(`${cdId}:${cast}`);
      const cd = effectiveCooldownSeconds(cdId) ?? 0;
      if (cast !== undefined) {
        // the press: anchored AT THE CAST (agy review: the Infernal aura lands
        // ≈ 1 s later — the timeline and the aura path must start together);
        // the timeline folds this into the logged cast and takes the end
        result.occurrences.push({
          spellId: cdId,
          spellName: twin.name,
          startMs: Math.min(cast, startMs),
          endMs,
          endObserved,
          cooldownSeconds: cd,
          availableAgainAtMs: cast + cd * 1000,
          availabilityUnknown: false,
          dangerWeight: offensiveDangerWeight(
            cdId,
            (id) => effectiveCooldownSeconds(id) ?? 0,
          ),
          burstRole: "burst",
          provenance: "press-logged",
          ...(auraOfficialEndMs !== undefined
            ? { officialEndMs: auraOfficialEndMs }
            : {}),
        });
      } else {
        // no press: a short talent proc (605 files: 14 such applications,
        // 0.4–10.3 s against the pressed 15 / 30 s — e.g. Time Anomaly's
        // Arcane Surge). A MINOR burst, priced like the Demonic ruling by
        // what produced it (a talent with no cooldown → 0): never a window
        // on its own, no claim a cooldown was spent.
        result.occurrences.push({
          // the COOLDOWN id, like the pressed twin — every id filter
          // (isEnemyCdWindowSpell) reads the same id for both (agy review)
          spellId: cdId,
          spellName: `${twin.name}${NO_PRESS_SUFFIX}`,
          startMs,
          endMs,
          endObserved,
          cooldownSeconds: 0,
          availableAgainAtMs: null,
          availabilityUnknown: true,
          dangerWeight: 0,
          burstRole: "burst",
          provenance: "unresolved",
          // the aura's own official end, as every other occurrence carries
          // it: still up as the slice ends, `[RES]` counts to it as an
          // upper bound (T140, codex 85-tk-CD-T140-1 #1) instead of to the
          // slice's end as if the log had shown it
          ...(auraOfficialEndMs !== undefined
            ? { officialEndMs: auraOfficialEndMs }
            : {}),
        });
      }
      continue;
    }

    if (iv.spellId === "466772") {
      const logged = near(doomWindsPresses, startMs, -W, W);
      if (logged !== undefined) {
        if (endObserved) {
          result.observedEndOfCast.set(logged, endMs);
          if (auraOfficialEndMs !== undefined)
            result.officialEndOfCast.set(logged, auraOfficialEndMs);
        }
        result.castCovered.push({
          spellId: DOOM_WINDS_PRESS_ID,
          startMs,
          endMs,
        });
        continue;
      }
      // Ascendance grants the buff — ONE burst, Ascendance's (user ruling);
      // Ascendance's own aura keeps the aura path "active"
      if (near(ascendances, startMs, -W, W) !== undefined) continue;
      // from 12.1.5 the press logs, and a buff with neither a press nor
      // Ascendance is a proc (`auraStandsForPressAt`, fact11 D7: 10244184
      // 1:30 / 1:55, 24.9 s apart, each in a Lightning Bolt's millisecond):
      // the cooldown's window, no press, nothing spent (Radiant Glory's
      // shape)
      if (
        !auraStandsForPressAt(DOOM_WINDS_PRESS_ID, logInstantOf(unit, startMs))
      ) {
        result.occurrences.push({
          spellId: DOOM_WINDS_PRESS_ID,
          spellName: `Doom Winds${NO_PRESS_SUFFIX}`,
          startMs,
          endMs,
          endObserved,
          cooldownSeconds: 0,
          availableAgainAtMs: null,
          availabilityUnknown: false,
          dangerWeight: offensiveDangerWeight(
            DOOM_WINDS_PRESS_ID,
            (id) => effectiveCooldownSeconds(id) ?? 0,
          ),
          burstRole: "burst",
          provenance: "proc",
          ...(auraOfficialEndMs !== undefined
            ? { officialEndMs: auraOfficialEndMs }
            : {}),
        });
        continue;
      }
      const cd = effectiveCooldownSeconds(DOOM_WINDS_PRESS_ID) ?? 0;
      result.occurrences.push({
        spellId: DOOM_WINDS_PRESS_ID,
        spellName: "Doom Winds",
        startMs,
        endMs,
        endObserved,
        cooldownSeconds: cd,
        availableAgainAtMs: startMs + cd * 1000,
        availabilityUnknown: false,
        dangerWeight: offensiveDangerWeight(
          DOOM_WINDS_PRESS_ID,
          (id) => effectiveCooldownSeconds(id) ?? 0,
        ),
        burstRole: "burst",
        provenance: "press-inferred",
        ...(auraOfficialEndMs !== undefined
          ? { officialEndMs: auraOfficialEndMs }
          : {}),
      });
    }
  }
  result.occurrences.sort((a, b) => a.startMs - b.startMs);
  byKey.set(key, result);
  return result;
}

/**
 * Is a registered aura-evidenced offensive effect (burst role) active on this
 * unit at `timestampMs`? The aura path's answer for the ids in
 * `OFFENSIVE_AURA_EVIDENCE` — the same intervals the timeline uses.
 * `spellIdFilter` is applied to the occurrence's shown id (a cooldown id for
 * a press, so `isEnemyCdWindowSpell` admits it).
 */
export function auraOffensiveActiveAt(
  unit: ICombatUnit,
  timestampMs: number,
  spellIdFilter?: (spellId: string) => boolean,
  /** the round — pass it whenever the caller has it, so this answer and the
   * timeline's come from the SAME bounds (codex review: the last aura event
   * is not the end of the observation) */
  combat?: Bounds,
): boolean {
  let bounds: Bounds | null | undefined = combat;
  if (bounds === undefined) bounds = boundsCache.get(unit);
  if (bounds === undefined) {
    // no round given: the unit's whole event stream (auras, casts, advanced
    // samples) is the observation window — legacy units are per round
    let lo = Infinity;
    let hi = -Infinity;
    const see = (t: number | undefined) => {
      if (typeof t !== "number") return;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    };
    for (const a of unit.auraEvents ?? []) see(a.logLine?.timestamp);
    for (const c of unit.spellCastEvents ?? []) see(c.logLine?.timestamp);
    for (const s of unit.advancedActions ?? []) see(s.logLine?.timestamp);
    bounds = lo <= hi ? { startTime: lo, endTime: hi } : null;
    boundsCache.set(unit, bounds);
  }
  if (bounds === null) return false;
  const r = auraOffensiveOccurrences(unit, bounds);
  const hit = (o: { spellId: string; startMs: number; endMs: number }) =>
    o.startMs <= timestampMs &&
    timestampMs <= o.endMs &&
    (spellIdFilter === undefined || spellIdFilter(o.spellId));
  return (
    r.occurrences.some((o) => o.burstRole === "burst" && hit(o)) ||
    r.castCovered.some(hit)
  );
}
