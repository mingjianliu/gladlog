import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { effectiveCooldownSeconds } from "../data/spellEffectData";
import { buildAuraIntervals } from "./auraIntervals";
import { buffFullDurationForCaster } from "./buffDuration";
import { offensiveDangerWeight } from "./spellDanger";

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
 *    AURA_ONLY_ACTIVATION_IDS reads the same buff the same way).
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
]);
/** A twin's cast is logged at most this long before its aura (Infernal:
 * ≈ 1.0 s, the summon landing — p90 1.02 s on 207 pairs) or 0.5 s after
 * (log order). Not widened for lag: the only cast-less applications in 605
 * files lasted 0.4–10.3 s, i.e. short procs, not late-landing presses. */
const TWIN_CAST_BEFORE_S = 3;
const TWIN_CAST_AFTER_S = 0.5;

/** Cast ids read as evidence (registered with the table above). */
export const METAMORPHOSIS_PRESS_CAST_IDS: ReadonlySet<string> = new Set([
  "191427", // the button — never logged in the corpus, kept for safety
  "200166", // the leap landing: how a press shows up
]);
export const EYE_BEAM_ID = "198013";
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
/** Evidence tolerance around an aura start (cast ↔ aura association). */
export const AURA_EVIDENCE_WINDOW_S = 3;
/** Eye Beam cast window relative to the Demonic aura: the cast is logged up
 * to 0.3 s AFTER the aura it grants. */
const EYE_BEAM_BEFORE_S = 4;
const EYE_BEAM_AFTER_S = 0.3;

/** How a Demonic (Eye Beam) Metamorphosis form counts. User ruling
 * 2026-09-26 (GH #119): 「算小爆发」 → "minor": a burst everywhere (burst
 * fields, crisis bursts, the aura-path "offensive active" check, the count of
 * cooldowns aligned in a window) priced by what produces it — Eye Beam's 30 s
 * cooldown, `offensiveDangerWeight(198013)` = 0 — so it never opens a window
 * on its own. The two alternatives measured on 605 files before the ruling
 * stay selectable for re-measurement: "burst" = weighted like the pressed
 * Metamorphosis (≈ 200 extra windows, named in 92 kick-eaten burst fields);
 * "fact" = shown on the timeline only, never a burst. */
export const OFFENSIVE_AURA_FLAGS: { demonic: "burst" | "minor" | "fact" } = {
  demonic: "minor",
};

export type AuraOccurrenceProvenance =
  "press-logged" | "press-inferred" | "proc" | "unresolved";

export interface IAuraOffensiveOccurrence {
  /** the id the timeline shows / keys on */
  spellId: string;
  spellName: string;
  startMs: number;
  endMs: number;
  endObserved: boolean;
  /** 0 when no cooldown was spent (a proc / unresolved form) */
  cooldownSeconds: number;
  /** when the cooldown comes back; null = no button (proc) */
  availableAgainAtMs: number | null;
  /** true when nothing tells whether a cooldown was spent */
  availabilityUnknown: boolean;
  dangerWeight: number;
  burstRole: "burst" | "fact";
  provenance: AuraOccurrenceProvenance;
}

export interface IAuraOccurrenceResult {
  occurrences: IAuraOffensiveOccurrence[];
  /** logged Doom Winds presses whose buff end was observed: cast ms → end ms
   * (the timeline overwrites that cast's estimated buff end) */
  observedEndOfCast: Map<number, number>;
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
  const key = `${bounds.startTime}:${bounds.endTime}:${OFFENSIVE_AURA_FLAGS.demonic}`;
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
    castCovered: [],
  };
  const events = (unit.auraEvents ?? []).filter(
    (a) =>
      a.spellId !== undefined &&
      OFFENSIVE_AURA_EVIDENCE.has(a.spellId) &&
      a.srcUnitId === unit.id &&
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
  );
  const pressCasts = castTimes(unit, METAMORPHOSIS_PRESS_CAST_IDS);
  const eyeBeams = castTimes(unit, new Set([EYE_BEAM_ID]));
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

  for (const iv of intervals) {
    const startMs = bounds.startTime + iv.fromS * 1000;
    const endMs = bounds.startTime + iv.toS * 1000;
    const endObserved = !iv.inferredEnd;

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
        const end = toObserved
          ? toMs
          : Math.min(
              toMs,
              lastEvidenceMs("162264", fromMs, toMs) +
                DEMONIC_FORM_SECONDS * 1000,
            );
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
        });
      };
      if (press === undefined) {
        formOccurrence(startMs, endMs, endObserved);
        continue;
      }
      const splitAt =
        press - startMs > PRESS_LANDING_LAG_S * 1000 ? press : startMs;
      if (splitAt > startMs) formOccurrence(startMs, splitAt, true);
      // inferred end: the PRESS's own duration from the press, bounded by
      // the round and the next application of the aura — not the aura row's
      // 20 s cap the interval builder already applied (codex review)
      const nextStartMs =
        intervals
          .filter((o) => o.spellId === "162264" && o.fromS > iv.fromS)
          .map((o) => bounds.startTime + o.fromS * 1000)
          .sort((a, b) => a - b)[0] ?? bounds.endTime;
      const pressEnd = endObserved
        ? endMs
        : Math.max(
            endMs,
            Math.min(
              nextStartMs,
              bounds.endTime,
              splitAt + (buffFullDurationForCaster("191427", unit) ?? 0) * 1000,
            ),
          );
      result.occurrences.push({
        spellId: "191427",
        spellName: "Metamorphosis",
        startMs: splitAt,
        endMs: pressEnd,
        endObserved,
        cooldownSeconds: metaCd,
        availableAgainAtMs: press + metaCd * 1000,
        availabilityUnknown: false,
        dangerWeight: metaWeight,
        burstRole: "burst",
        provenance: "press-inferred",
      });
      continue;
    }

    const twin = OFFENSIVE_AURA_EVIDENCE.get(iv.spellId);
    if (twin?.twin) {
      const cdId = twin.cooldownId;
      const cast = near(
        castTimes(unit, new Set([cdId])),
        startMs,
        -TWIN_CAST_BEFORE_S * 1000,
        TWIN_CAST_AFTER_S * 1000,
      );
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
          spellName: `${twin.name} (no press)`,
          startMs,
          endMs,
          endObserved,
          cooldownSeconds: 0,
          availableAgainAtMs: null,
          availabilityUnknown: true,
          dangerWeight: 0,
          burstRole: "burst",
          provenance: "unresolved",
        });
      }
      continue;
    }

    if (iv.spellId === "466772") {
      const logged = near(doomWindsPresses, startMs, -W, W);
      if (logged !== undefined) {
        if (endObserved) result.observedEndOfCast.set(logged, endMs);
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
