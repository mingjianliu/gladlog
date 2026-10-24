// packages/shared/src/utils/combatStates.ts
import {
  AtomicArenaCombat,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { getEnglishSpellName } from "../data/spellEffectData";
import { dropAuraRebroadcasts, officialDurationS } from "./auraIntervals";
import { empowerSpans } from "./castCommitSpans";
import { auraBlocksMechanic, INTERRUPT_MECHANIC } from "./spellMechanics";

export interface IFormInterval {
  form: "Bear" | "Cat";
  startSeconds: number;
  endSeconds: number;
}

export interface ISpiritOfRedemptionInterval {
  startSeconds: number;
  endSeconds: number;
}

export interface IStasisEvent {
  startSeconds: number;
  /** When storing ended: the storing aura (370537) came off — the third
   * spell stored, or Stasis pressed again. The stored spells then WAIT under
   * the ready aura (370562). */
  storedSeconds: number;
  /**
   * When the stored spells were replayed: the ready aura's REMOVED (FT-T06).
   * It was stamped at `storedSeconds` — on the 60 re-eval logs the real
   * release follows it by a median 9.0 s (p10 3.3 s, p90 23.0 s; the ready
   * aura also releases by itself at 30 s: 16 of 16 full-length ones were
   * followed by replays). Equal to `storedSeconds` when the log carries no
   * ready aura for this Stasis; undefined when the spells were not replayed
   * inside the log (`unreleased`).
   */
  releaseSeconds: number | undefined;
  /** Not replayed: the ready aura was still up when the log ended ("held"),
   * or came off with no cast after it — the Evoker died ("lost"). */
  unreleased?: "held" | "lost";
  /** The ready aura was already up when the round began: the spells were
   * stored before it (the prep room, the previous Shuffle round). Their
   * names are NOT in this round's log, and are not reconstructed from what
   * the Evoker cast at the release: a replay has its own ids (Dream Breath
   * 355941), comes 0.3–0.4 s after the last one with no global cooldown, and
   * real presses land between them (codex review: three such readings were
   * wrong). `spells` is empty and `storedCount` 0 for these. */
  storedBeforeRound?: true;
  spells: string[];
  // Number of spells actually stored, derived from the Stasis aura's stack
  // (dose) removals. Used as a fallback when individual spell names cannot be
  // resolved, so a real release is never rendered as an empty one.
  storedCount: number;
}

/**
 * The auras a priest in Spirit of Redemption form carries: 27827 (the
 * on-death proc) and 215769 (the pressed PvP-talent version, ~9 s). Both are
 * observed in the corpus; 215982, listed here until FT-T10, is the PvP
 * talent's own id and is never an aura in a log (0 occurrences).
 */
export const SPIRIT_OF_REDEMPTION_AURA_IDS: ReadonlySet<string> = new Set([
  "27827",
  "215769",
]);

/**
 * The PRESSED form alone (the PvP talent, ~9 s, after which the priest is
 * alive again). A kill attempt is cut around this one only: the on-death
 * form (27827) is the priest dying — the death is logged when it ends — so
 * an attempt whose target drops into it is the kill, not a span to cut
 * (codex review 40-FT-74: with both ids a credited KILL at 10–22 s became a
 * failed 10–12 s attempt).
 */
export const PRESSED_SPIRIT_OF_REDEMPTION_AURA_IDS: ReadonlySet<string> =
  new Set(["215769"]);

/**
 * Does this aura make its carrier's casts unkickable — an official interrupt
 * immunity (DB2 aura 77 mechanic 26, or every school: `auraBlocksMechanic`),
 * or the Spirit of Redemption form, which DB2 does not encode that way.
 * F16 retest (2026-10-21, idx 42): 233 priest cast starts inside a pressed
 * form across 71 raw files, 0 interrupted (2.8 % of the same priests' casts
 * outside it); kick-priority-missed said Wind Shear could kick a Flash Heal
 * cast wholly inside the form (691a7f31 2:35). The form is an immunity form
 * (user ruling 2026-10-20, fact2 ruling 5).
 */
export function auraBlocksInterrupt(auraId: string): boolean {
  return (
    SPIRIT_OF_REDEMPTION_AURA_IDS.has(auraId) ||
    auraBlocksMechanic(auraId, INTERRUPT_MECHANIC) === true
  );
}

/**
 * When `unit` was in Spirit of Redemption form — the `unit:ghost` token of a
 * [STATE] tick. FT-T10: the token's code and this reader both existed, and no
 * caller passed the intervals (0 `:ghost` in 3,520 contexts of the 605-file
 * capture against 1,372 Spirit of Redemption press lines); wired in
 * `buildMatchContext` for every player of the round.
 */
export function extractSpiritOfRedemptionIntervals(
  unit: Pick<ICombatUnit, "id" | "auraEvents"> &
    Partial<Pick<ICombatUnit, "spec" | "info" | "spellCastEvents">>,
  combat: Pick<AtomicArenaCombat, "startTime" | "endTime">,
  auraIds: ReadonlySet<string> = SPIRIT_OF_REDEMPTION_AURA_IDS,
): ISpiritOfRedemptionInterval[] {
  const intervals: ISpiritOfRedemptionInterval[] = [];
  let ghost: { startMs: number; spellId: string } | null = null;
  const rel = (ms: number) => (ms - combat.startTime) / 1000;
  // a form whose REMOVED the log lost ends at its official length (the
  // `buildAuraIntervals` cap), not at the round's end (codex 60-POSTHOC-09f
  // #1: a PvP Spirit of Redemption 215769 at 10 s read 10–180 s — 6 s
  // official — and [STATE], offensive windows and kill attempts dropped
  // the rest of the round)
  const capped = (g: { startMs: number; spellId: string }, endMs: number) => {
    // the priest's own length — Afterlife's 9 s, not the base 6 s (codex
    // 20-F17-07 #4: the cap read the form as over 3 s early); a unit
    // without its kit falls back to the base
    const d = officialDurationS(
      g.spellId,
      unit.spec !== undefined && unit.spellCastEvents !== undefined
        ? (unit as Parameters<typeof officialDurationS>[1])
        : undefined,
      g.startMs,
    );
    return d === null ? endMs : Math.min(endMs, g.startMs + d * 1000);
  };

  for (const aura of unit.auraEvents) {
    const isGhost =
      !!aura.spellId &&
      auraIds.has(aura.spellId) &&
      // on this unit (a unit's aura events can carry auras it put on others)
      (aura.destUnitId === undefined || aura.destUnitId === unit.id);
    if (!isGhost) continue;
    if (aura.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
      // a second APPLIED with no REMOVED between: the first one's REMOVED was
      // lost — it ended at its official length (or here, whichever is first)
      if (ghost)
        intervals.push({
          startSeconds: rel(ghost.startMs),
          endSeconds: rel(capped(ghost, aura.logLine.timestamp)),
        });
      ghost = { startMs: aura.logLine.timestamp, spellId: aura.spellId! };
    } else if (aura.logLine.event === LogEvent.SPELL_AURA_REMOVED && ghost) {
      intervals.push({
        startSeconds: rel(ghost.startMs),
        endSeconds: rel(aura.logLine.timestamp),
      });
      ghost = null;
    }
  }

  // held to the end of the log, or to its official length if shorter
  if (ghost)
    intervals.push({
      startSeconds: rel(ghost.startMs),
      endSeconds: rel(capped(ghost, combat.endTime)),
    });

  return intervals;
}

/**
 * Is a unit with these form intervals `:ghost` at the [STATE] tick of whole
 * second `second`? The tick's own rule — every whole second from the form's
 * start to its end, both included — in one place: the tick
 * (`timelineSections/state.ts`) and the gate that reads the token back
 * (`checkNoWindowAcrossSpiritOfRedemption`) are the two ends of it.
 */
export function isGhostAtRenderSecond(
  intervals: ReadonlyArray<ISpiritOfRedemptionInterval>,
  second: number,
): boolean {
  return intervals.some(
    (int) => second >= int.startSeconds && second <= int.endSeconds,
  );
}

/**
 * Does a span printed `a–b` hold a `:ghost` second of its target? Whole
 * render seconds; the span's own first and last second are not "held".
 *
 * Why the ends are open (F17): a kill window / kill-attempt bracket is cut at
 * the form's raw instants (`computeOffensiveWindows` step 2c,
 * `extractKillAttempts`) and both are printed floored. A span that ENDS where
 * the form begins at S prints `floor(S)`, and the tick of that second is
 * `ghost` only when S is whole; a span that STARTS where the form ends at E
 * prints `floor(E)`, whose tick is still `ghost`. So the one second a cut
 * span can share with the form is its own boundary second — every ghost
 * second strictly between the two printed ends means the span runs across
 * the form.
 */
export function spanHoldsGhostSecond(
  fromSecond: number,
  toSecond: number,
  ghostSecond: number,
): boolean {
  return ghostSecond > fromSecond && ghostSecond < toSecond;
}

export function extractShapeshiftIntervals(
  unit: ICombatUnit,
  combat: AtomicArenaCombat,
): IFormInterval[] {
  const intervals: IFormInterval[] = [];
  let bearStart: number | null = null;
  let catStart: number | null = null;

  for (const aura of unit.auraEvents) {
    if (!aura.spellName) continue;

    const isBear = aura.spellId === "5487" || aura.spellId === "9634"; // Bear Form, Dire Bear Form
    const isCat = aura.spellId === "768"; // Cat Form

    if (aura.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
      if (isBear) {
        bearStart = aura.logLine.timestamp;
      } else if (isCat) {
        catStart = aura.logLine.timestamp;
      }
    } else if (aura.logLine.event === LogEvent.SPELL_AURA_REMOVED) {
      if (isBear && bearStart !== null) {
        intervals.push({
          form: "Bear",
          startSeconds: (bearStart - combat.startTime) / 1000,
          endSeconds: (aura.logLine.timestamp - combat.startTime) / 1000,
        });
        bearStart = null;
      } else if (isCat && catStart !== null) {
        intervals.push({
          form: "Cat",
          startSeconds: (catStart - combat.startTime) / 1000,
          endSeconds: (aura.logLine.timestamp - combat.startTime) / 1000,
        });
        catStart = null;
      }
    }
  }

  // Handle forms held until the end of the match
  if (bearStart !== null) {
    intervals.push({
      form: "Bear",
      startSeconds: (bearStart - combat.startTime) / 1000,
      endSeconds: (combat.endTime - combat.startTime) / 1000,
    });
  }
  if (catStart !== null) {
    intervals.push({
      form: "Cat",
      startSeconds: (catStart - combat.startTime) / 1000,
      endSeconds: (combat.endTime - combat.startTime) / 1000,
    });
  }

  return intervals;
}

// Stasis (370537) lets a Preservation Evoker store the next 3 spells they cast,
// then replays them on release. It is a *stacked* aura: applied with charges,
// each stored spell removes a dose (SPELL_AURA_REMOVED_DOSE), and the final
// removal (SPELL_AURA_REMOVED) is the release.
const STASIS_SPELL_ID = "370537";

// Spells Stasis commonly stores for Preservation, used to resolve stored-spell
// NAMES. Off-GCD utility cast during Stasis (e.g. Hover) does NOT consume a
// charge and is not stored, so this stays an allow-list rather than "every
// cast". When a stored spell falls outside this list its name can't be
// resolved — but the dose-derived storedCount still records that the release
// was non-empty (see IStasisEvent.storedCount), so it is never shown as empty.
/** @internal exported for data/curatedIdRegistry (corpus rot scan) */
// 2026-08-21 S2 corpus scan (10,682 matches): removed Spiritbloom 367226 — 0 occurrences, ability gone in 12.x (eval-private/reports/s2-health-2026-08-21)
export const STASIS_STORABLE_HEAL_IDS = new Set([
  "355936", // Dream Breath
  "366155", // Reversion
  "355913", // Emerald Blossom
  "360995", // Verdant Embrace
  "361195", // Verdant Embrace (alternate cast-success id seen in 12.x logs)
  "361469", // Living Flame
  "361509", // Living Flame (heal-component id logged as cast success)
  "431443", // Chrono Flame (Chronowarden Living Flame replacement)
  "364343", // Echo
  "1256581", // Merithra's Blessing (12.1 Preservation heal)
  // Whitelist audit 2026-07-15: the log's own AURA_REMOVED_DOSE count proved
  // 3 spells stored while the list captured 2 in 24/51 corpus releases — the
  // four ids above were the casts inside those windows. storedCount (dose-
  // derived) remains the ground truth; keep it ≥ spells.length as invariant.
]);

/** Stasis' second aura: up while the stored spells wait. Its removal replays
 * them as the Evoker's own SPELL_CAST_SUCCESS events — casts nobody pressed. */
const STASIS_READY_AURA_ID = "370562";

/** How long after the ready aura's removal a cast may be a replay. 605 S2
 * files, 222 removals: the three replays sit at p50 +0.01 / +0.38 / +0.71 s
 * (third p90 +0.93 s); 141470d0, replayed inside a Nature lockout, spaced them
 * +0.02 / +0.74 / +1.40 s. Too long only keeps a real press from counting as
 * evidence, which is the safe side for every caller. */
export const STASIS_REPLAY_WINDOW_S = 1.5;

/** Spans (ms, log clock) in which the unit's successful casts may be Stasis
 * replays rather than presses. */
export function stasisReplayWindows(
  unit: Pick<ICombatUnit, "auraEvents">,
): Array<{ from: number; to: number }> {
  return (unit.auraEvents ?? [])
    .filter(
      (e) =>
        e.spellId === STASIS_READY_AURA_ID &&
        e.logLine.event === LogEvent.SPELL_AURA_REMOVED,
    )
    .map((e) => ({
      from: e.logLine.timestamp,
      to: e.logLine.timestamp + STASIS_REPLAY_WINDOW_S * 1000,
    }));
}

/** How close the ready aura's APPLIED sits to the storing aura's REMOVED —
 * the same instant in the log (141470d0: both at 00:56:36.621). */
const STASIS_READY_AFTER_STORED_MS = 50;

/** One press the log writes under two ids: Verdant Embrace is 360995 at the
 * press and 361195 when it lands (605-file sample 119: 157 ms apart). Two
 * presses of one heal are a global cooldown apart, so two SUCCESS lines of
 * one name inside this window are one stored spell. */
const STASIS_TWIN_CAST_MS = 700;

interface StasisReadyLife {
  appliedMs: number | undefined;
  removedMs: number | undefined;
  used: boolean;
}

/** The lives of the ready aura (370562) on the Evoker, in log order. */
function stasisReadyLives(unit: ICombatUnit): StasisReadyLife[] {
  const lives: StasisReadyLife[] = [];
  let open: StasisReadyLife | undefined;
  for (const e of dropAuraRebroadcasts(unit.auraEvents ?? [])) {
    if (e.spellId !== STASIS_READY_AURA_ID) continue;
    if (e.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
      open = {
        appliedMs: e.logLine.timestamp,
        removedMs: undefined,
        used: false,
      };
      lives.push(open);
    } else if (e.logLine.event === LogEvent.SPELL_AURA_REMOVED) {
      if (open && open.removedMs === undefined)
        open.removedMs = e.logLine.timestamp;
      else
        // up before the log began: only its end is logged
        lives.push({
          appliedMs: undefined,
          removedMs: e.logLine.timestamp,
          used: false,
        });
      open = undefined;
    }
  }
  return lives;
}

/** The Evoker's casts right after a ready aura came off — the replays. */
function stasisReplayCasts(unit: ICombatUnit, removedMs: number) {
  return (unit.spellCastEvents ?? []).filter(
    (c) =>
      c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
      c.logLine.timestamp >= removedMs &&
      c.logLine.timestamp <= removedMs + STASIS_REPLAY_WINDOW_S * 1000,
  );
}

/** The press that releases Stasis' stored spells (`SPELL_CAST_SUCCESS`,
 * when the log writes one — 0e0663e6 does, in the ready aura's REMOVED ms;
 * 141470d0 does not). */
export const STASIS_RELEASE_SPELL_ID = "370564";

/** How close to its official length a ready aura may come off and still be
 * its own expiry rather than a press. */
const STASIS_READY_EXPIRY_SLACK_MS = 500;

/**
 * The Evoker's own Stasis releases (ms, log clock, ascending): a
 * `STASIS_RELEASE_SPELL_ID` SUCCESS, or a ready aura (370562) that came off
 * before its official length (DB2, 30 s) with the stored spells replayed
 * after it — a release the log wrote no SUCCESS for (WO6 #5, n9: 141470d0
 * 199.288, 6.25 s into the aura, 1.02 s after a kick). A ready aura that runs
 * its length releases on its own and is no press; one that comes off with
 * nothing replayed was lost (a death), not released.
 */
export function stasisReleasePressesMs(unit: ICombatUnit): number[] {
  const out: number[] = (unit.spellCastEvents ?? [])
    .filter(
      (c) =>
        c.spellId === STASIS_RELEASE_SPELL_ID &&
        c.logLine.event === LogEvent.SPELL_CAST_SUCCESS,
    )
    .map((c) => c.logLine.timestamp);
  const lengthS = officialDurationS(STASIS_READY_AURA_ID, undefined);
  if (lengthS) {
    for (const life of stasisReadyLives(unit)) {
      const { appliedMs, removedMs } = life;
      if (appliedMs === undefined || removedMs === undefined) continue;
      if (
        removedMs - appliedMs >=
        lengthS * 1000 - STASIS_READY_EXPIRY_SLACK_MS
      )
        continue;
      if (
        !stasisReplayCasts(unit, removedMs).some(
          (c) => c.spellId !== STASIS_RELEASE_SPELL_ID,
        )
      )
        continue;
      if (
        out.some(
          (ms) => Math.abs(ms - removedMs) <= STASIS_READY_AFTER_STORED_MS,
        )
      )
        continue;
      out.push(removedMs);
    }
  }
  return out.sort((a, b) => a - b);
}

/** Where a Stasis whose storing ended at `storedMs` was released. A ready
 * aura that comes off after the round's end was held through it. */
function stasisReleaseOf(
  unit: ICombatUnit,
  lives: StasisReadyLife[],
  storedMs: number,
  startMs: number,
  endMs: number,
): Pick<IStasisEvent, "releaseSeconds" | "unreleased"> {
  const life = lives.find(
    (l) =>
      !l.used &&
      l.appliedMs !== undefined &&
      Math.abs(l.appliedMs - storedMs) <= STASIS_READY_AFTER_STORED_MS,
  );
  // no ready aura in the log for it: the storing aura's end is all there is
  if (!life) return { releaseSeconds: (storedMs - startMs) / 1000 };
  life.used = true;
  if (life.removedMs === undefined || life.removedMs > endMs)
    return { releaseSeconds: undefined, unreleased: "held" };
  if (stasisReplayCasts(unit, life.removedMs).length === 0)
    return { releaseSeconds: undefined, unreleased: "lost" };
  return { releaseSeconds: (life.removedMs - startMs) / 1000 };
}

export function extractStasisEvents(
  unit: ICombatUnit,
  combat: AtomicArenaCombat,
): IStasisEvent[] {
  const events: IStasisEvent[] = [];
  const readyLives = stasisReadyLives(unit);
  // one press of a spell the log writes under two ids (Verdant Embrace
  // 360995 / 361195) is one stored spell (b12bfef4)
  let lastBuffered: { name: string; ms: number } | undefined;
  let isBuffering = false;
  let startSeconds = 0;
  let bufferedSpells: string[] = [];
  let doseRemovals = 0;
  let lastStasisCastTimestamp = 0;
  // round-1 retest idx 18: an empowered spell logs its SUCCESS at the start
  // of the hold; a hold that ended in SPELL_EMPOWER_INTERRUPT released
  // nothing and stored nothing (0f894aee 4:22.965: a Dream Breath cut at
  // 4:23.30, no dose taken — read as a stored Dream Breath)
  const unreleased = (empowerSpans(unit) ?? []).filter((h) => h.interrupted);
  const unreleasedEmpowerAt = (spellId: string, ms: number): boolean =>
    unreleased.some(
      (h) => h.spellId === spellId && Math.abs(h.startMs - ms) <= 50,
    );

  // We scan aura events (for boundaries and stored-spell doses) and cast events
  // (for the buffered spell names).
  // The storing aura is re-broadcast mid-store (REMOVED and APPLIED in one
  // ms; sample 119: 23:13:54.090) — one storing window, not two: split, the
  // second half has no dose and no event, and its ready aura reads as a
  // Stasis stored before the round.
  const mergedEvents = [
    ...dropAuraRebroadcasts(unit.auraEvents),
    ...unit.spellCastEvents,
  ]
    .filter(
      (e) =>
        e.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
        e.logLine.event === LogEvent.SPELL_AURA_REMOVED ||
        e.logLine.event === LogEvent.SPELL_AURA_REMOVED_DOSE ||
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS,
    )
    .sort((a, b) => {
      if (a.logLine.timestamp !== b.logLine.timestamp) {
        return a.logLine.timestamp - b.logLine.timestamp;
      }
      // At the same ms: count storage casts and doses before the final removal,
      // so a spell cast at the exact ms Stasis is released is still captured.
      const getPriority = (event: string) => {
        if (event === LogEvent.SPELL_AURA_APPLIED) return 0;
        if (event === LogEvent.SPELL_CAST_SUCCESS) return 1;
        if (event === LogEvent.SPELL_AURA_REMOVED_DOSE) return 2;
        if (event === LogEvent.SPELL_AURA_REMOVED) return 3;
        return 4;
      };
      return getPriority(a.logLine.event) - getPriority(b.logLine.event);
    });

  for (const e of mergedEvents) {
    if (
      e.spellId === STASIS_SPELL_ID &&
      e.logLine.event === LogEvent.SPELL_CAST_SUCCESS
    ) {
      lastStasisCastTimestamp = e.logLine.timestamp;
    }

    if (
      e.spellId === STASIS_SPELL_ID &&
      e.logLine.event === LogEvent.SPELL_AURA_APPLIED
    ) {
      isBuffering = true;
      startSeconds = (e.logLine.timestamp - combat.startTime) / 1000;
      bufferedSpells = [];
      doseRemovals = 0;
    } else if (
      e.spellId === STASIS_SPELL_ID &&
      e.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
      isBuffering
    ) {
      // The final removal is itself one stored-spell consumption when doses preceded it.
      const dosedCount = doseRemovals > 0 ? doseRemovals + 1 : doseRemovals;
      const storedCount = Math.max(bufferedSpells.length, dosedCount);
      // A real release consumes stored stacks, which in the log fire as
      // SPELL_AURA_REMOVED_DOSE before the final removal. Any dose removal therefore
      // proves a genuine release — this captures partial 2-stack releases (1 dose),
      // not just full 3-stack auto-releases, while still excluding expiration/death
      // (no doses). isManualRelease is kept as a defensive fallback for the synthetic
      // case where the release recast shares the removal timestamp.
      const isManualRelease = lastStasisCastTimestamp === e.logLine.timestamp;
      const hasConsumption = doseRemovals > 0;

      if (isManualRelease || hasConsumption) {
        events.push({
          startSeconds,
          storedSeconds: (e.logLine.timestamp - combat.startTime) / 1000,
          ...stasisReleaseOf(
            unit,
            readyLives,
            e.logLine.timestamp,
            combat.startTime,
            combat.endTime,
          ),
          spells: [...bufferedSpells],
          storedCount,
        });
      }
      isBuffering = false;
    } else if (
      isBuffering &&
      e.spellId === STASIS_SPELL_ID &&
      e.logLine.event === LogEvent.SPELL_AURA_REMOVED_DOSE
    ) {
      doseRemovals += 1;
    } else if (
      isBuffering &&
      e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
      e.spellId &&
      STASIS_STORABLE_HEAL_IDS.has(e.spellId) &&
      bufferedSpells.length < 3 &&
      !unreleasedEmpowerAt(e.spellId, e.logLine.timestamp)
    ) {
      const name = getEnglishSpellName(e.spellId, e.spellName ?? "Unknown");
      const twin =
        lastBuffered !== undefined &&
        lastBuffered.name === name &&
        e.logLine.timestamp - lastBuffered.ms <= STASIS_TWIN_CAST_MS;
      lastBuffered = { name, ms: e.logLine.timestamp };
      if (!twin) bufferedSpells.push(name);
    }
  }

  // A ready aura no storing window of this round led to: stored before the
  // round (141470d0: ready from 2.4 s, no 370537 press in the log). When it
  // was released is in the log; what it held is not (`storedBeforeRound`).
  for (const life of readyLives) {
    if (life.used) continue;
    const storedSeconds =
      life.appliedMs === undefined
        ? 0
        : Math.max(0, (life.appliedMs - combat.startTime) / 1000);
    const held =
      life.removedMs === undefined || life.removedMs > combat.endTime;
    // came off with nothing cast after it: the Evoker died holding it
    if (!held && stasisReplayCasts(unit, life.removedMs!).length === 0)
      continue;
    events.push({
      startSeconds: storedSeconds,
      storedSeconds,
      releaseSeconds: held
        ? undefined
        : (life.removedMs! - combat.startTime) / 1000,
      ...(held ? { unreleased: "held" as const } : {}),
      storedBeforeRound: true,
      spells: [],
      storedCount: 0,
    });
  }

  return events.sort((a, b) => a.storedSeconds - b.storedSeconds);
}
