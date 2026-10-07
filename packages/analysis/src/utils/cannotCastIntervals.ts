import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import {
  isCastBlockingAuraType,
  SPELL_CATEGORIES as SPELLS,
} from "../data/spellCategories";
import { BACKLASH_AURA_CC_TYPE } from "../data/backlashCc";

import { ccSpellIds, officialSilenceIds } from "../data/spellTags";
import { REACTION_WINDOW_S } from "./cooldowns";
import { matchPendingCcKey } from "./drAnalysis";
import { kickLockoutSecondsFor } from "./kickLockout";
import { isSilenceableCast } from "./spellMechanics";
import { firstDeathMs } from "./unitDeath";

/**
 * "When could this unit not cast?" — ONE predicate for the two consumers that
 * used to answer it separately (BACKLOG #38 (e), unified 2026-09-02):
 *
 *   - `dispelAnalysis.ts` → the "dispeller was locked out" exemption on
 *     missed-cleanse / missed-purge (gate b+c; this function was born there);
 *   - `healingGaps.ts` → the free-cast seconds of a healing gap ("he COULD
 *     have cast"), which until 2026-09-02 subtracted hard CC + silence auras
 *     but NOT kick lockouts — a pure interrupt (Pummel / Kick / Counterspell)
 *     logs no SPELL_AURA_APPLIED, so the 3–6 s the healer could not cast the
 *     locked school counted as "free" and a Holy Paladin (36 % of kicks
 *     followed by 5 s of nothing, corpus #36 (b)) was charged with a healing
 *     gap he was locked out of.
 *
 * Two sources, both enemy-inflicted:
 *   1. cast-blocking auras (hard CC + silence; `isCastBlockingAuraType`)
 *      from APPLIED to the first REMOVED/BROKEN after it in log order
 *      (open-ended when never removed);
 *   2. school lockouts from SPELL_INTERRUPT (`kickLockoutSeconds`, the
 *      corpus-observed table — GH #62). In SPELL_INTERRUPT `spellId` IS the
 *      kick (same source as matchTimeline's [KICK]; gate-predicate divergence
 *      case 13: do NOT read extraSpellId here). The school itself is not
 *      checked — the locked school is almost always the healing one, and a
 *      wrong exemption costs far less than a wrong accusation.
 *
 * "Enemy" means `enemyIds` — pass `enemySourceIds(...)` (the enemy players
 * plus everything they summoned) so a pet's stun or a totem's silence counts;
 * a players-only set drops them (e5b3534b: a Hunter pet's Intimidation on the
 * owner, triage 2026-09-29 H23).
 *
 * Intervals are raw (unclipped, possibly overlapping); `coveredMsWithin`
 * clips them to a window and merges before summing.
 */
export function buildCannotCastIntervals(
  unit: ICombatUnit,
  enemyIds: Set<string>,
): Array<{ from: number; to: number }> {
  return namedCannotCastIntervals(unit, enemyIds).map((iv) => ({
    from: iv.from,
    to: iv.to,
  }));
}

/** One `buildCannotCastIntervals` interval with what caused it. */
export interface NamedCannotCastInterval {
  from: number;
  to: number;
  /** the cast-blocking aura, or for a lockout the kick (SPELL_INTERRUPT's
   * own `spellId`) */
  spellId: string;
  lockout: boolean;
}

/**
 * `buildCannotCastIntervals` with each interval's cause — the same intervals
 * in the same order (it is the implementation), for a fact that has to NAME
 * what blocked the unit (cd-hoarded `facts.ownerCc`, triage 2026-09-29 H1).
 */
export function namedCannotCastIntervals(
  unit: ICombatUnit,
  enemyIds: Set<string>,
): NamedCannotCastInterval[] {
  const intervals: NamedCannotCastInterval[] = castBlockingAuraIntervals(
    unit,
    enemyIds,
  ).map((a) => ({
    from: a.from,
    to: a.to,
    spellId: a.spellId,
    lockout: false,
  }));

  for (const action of unit.actionIn ?? []) {
    if (action.logLine.event !== LogEvent.SPELL_INTERRUPT) continue;
    if (!enemyIds.has(action.srcUnitId)) continue;
    const kickSpellId = action.spellId ?? "";
    // kick-eaten F-K8 (A23): the lockout THIS unit sat in — a Storm Conduit
    // holder's interrupted Lightning Bolt locks for ×0.6
    const interrupted = (action as { extraSpellId?: string }).extraSpellId;
    intervals.push({
      from: action.timestamp,
      to:
        action.timestamp +
        kickLockoutSecondsFor(kickSpellId, unit, interrupted) * 1000,
      spellId: kickSpellId,
      lockout: true,
    });
  }

  return intervals;
}

/**
 * The source set `buildCannotCastIntervals` expects: the enemy players plus
 * every unit whose `ownerId` is one of them (pets, totems, guardians — the
 * summon-GUID attribution of GH #99). One definition for every caller; until
 * 2026-09-30 some passed players only and lost pet CC (triage H23), others
 * built this set inline (burst-window feasibility, missed-sync-window).
 */
export function enemySourceIds(
  enemyPlayers: ReadonlyArray<{ id: string }>,
  units: ReadonlyArray<{ id: string; ownerId?: string }>,
): Set<string> {
  const ids = new Set<string>(enemyPlayers.map((u) => u.id));
  const players = new Set(ids);
  for (const u of units) if (u.ownerId && players.has(u.ownerId)) ids.add(u.id);
  return ids;
}

export interface CastBlockingAura {
  spellId: string;
  spellName: string;
  srcUnitId: string;
  srcUnitName: string;
  /** SPELL_AURA_APPLIED, epoch ms */
  from: number;
  /** first REMOVED / BROKEN after the APPLIED in log order; Infinity when
   * never removed */
  to: number;
}

/**
 * The enemy-applied cast-blocking auras on `unit` (hard CC + silence,
 * `isCastBlockingAuraType`), APPLIED paired with the first REMOVED/BROKEN of
 * the same spell after it in log order. The aura half of `buildCannotCastIntervals`,
 * exported so a renderer can name what blocked the unit without a second
 * predicate (2026-09-25, reliability round 2 W1b).
 */
export function castBlockingAuraIntervals(
  unit: ICombatUnit,
  enemyIds: Set<string>,
): CastBlockingAura[] {
  // Pairing is by position in the unit's aura stream (log order), not by
  // timestamp: a Cyclone re-applied in the same millisecond as the previous
  // one's REMOVED (e5b3534b 23.317, REMOVED logged first) used to pair with
  // that earlier REMOVED — `r >= a.ts` — and became a zero-length interval,
  // so the owner read as free for the whole 4.8 s (triage 2026-09-29 H23).
  //
  // And by CASTER (user ruling P-FU-H23, 2026-10-06): a removal closes the
  // application of ITS source — `matchPendingCcKey`, the pairing `ccInstances`
  // and the CC-break analysis use (exact `spell:source` key; a BROKEN line's
  // source is the breaker, so it falls back to the earliest pending
  // application of the spell). Until then every application paired with the
  // first later removal of the SPELL: a second paladin's Hammer of Justice
  // landing while the first was still up ended at the first one's REMOVED,
  // and the unit read as free for the rest of the second stun.
  const pending = new Map<
    string,
    {
      applyMs: number;
      spellId: string;
      name: string;
      srcId: string;
      srcName: string;
    }
  >();
  const out: CastBlockingAura[] = [];

  // Fixture-built units may lack either stream (momentSnapshot.test.ts has
  // healers with no actionIn) — an absent stream is "nothing happened", not a
  // throw that the caller's try/catch would turn into "no gaps at all".
  for (const aura of unit.auraEvents ?? []) {
    const spellId = aura.spellId;
    if (!spellId) continue;
    // cc-dr F-SR1 (ruling A52 = A, 2026-09-30): a CC / silence whose source
    // is the unit itself was sent back to it (Diffuse Magic, Reverse Magic,
    // Spell Reflection) and locks it like any enemy's — 82a2d681's Death
    // Knight sat in his own reflected Strangulate 57.33–60.31 and read free.
    if (!enemyIds.has(aura.srcUnitId) && aura.srcUnitId !== unit.id) continue;
    // cc-dr F-BK1: the dispel-backlash auras (Unstable Affliction's silence
    // 196364, Vampiric Touch's horror 87204 — DB2 aura 7 / mechanic 24,
    // tier-C 09-30) have no SPELL_CATEGORIES row; the one registered table is
    // `BACKLASH_AURA_CC_TYPE`, which `ccInstances` already reads.
    const spell = SPELLS[spellId];
    if (
      !BACKLASH_AURA_CC_TYPE.has(spellId) &&
      (!spell || !isCastBlockingAuraType(spell.type))
    )
      continue;

    const key = `${spellId}:${aura.srcUnitId}`;
    if (aura.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
      // a second APPLIED from the same caster with no removal between keeps
      // the first one's start (both used to run to the same removal)
      if (!pending.has(key))
        pending.set(key, {
          applyMs: aura.timestamp,
          spellId,
          name: aura.spellName ?? spellId,
          srcId: aura.srcUnitId,
          srcName: aura.srcUnitName ?? "",
        });
    } else if (
      aura.logLine.event === LogEvent.SPELL_AURA_REMOVED ||
      aura.logLine.event === LogEvent.SPELL_AURA_BROKEN ||
      aura.logLine.event === LogEvent.SPELL_AURA_BROKEN_SPELL
    ) {
      const matchKey = matchPendingCcKey(pending, spellId, key);
      const p = matchKey ? pending.get(matchKey) : undefined;
      if (!p || !matchKey) continue;
      pending.delete(matchKey);
      out.push({
        spellId,
        spellName: p.name,
        srcUnitId: p.srcId,
        srcUnitName: p.srcName,
        from: p.applyMs,
        to: aura.timestamp,
      });
    }
  }
  // never removed: open-ended
  for (const p of pending.values())
    out.push({
      spellId: p.spellId,
      spellName: p.name,
      srcUnitId: p.srcId,
      srcUnitName: p.srcName,
      from: p.applyMs,
      to: Infinity,
    });
  // in application order (a stable sort: same-millisecond applications keep
  // their log order)
  return out.sort((a, b) => a.from - b.from);
}

/** A cast-blocking aura that is a silence and not hard CC — the same split
 * `silenceIntervals` renders `[SILENCE]` from. */
const isSilenceOnlyAura = (auraId: string): boolean =>
  officialSilenceIds.has(auraId) && !ccSpellIds.has(auraId);

/**
 * "Could this unit press `spellId` at `tMs`, as far as auras go?" — the
 * cast-blocking aura (`castBlockingAuraIntervals`) that stops it at that
 * instant, or undefined when it was free.
 *
 *  - Hard CC stops everything.
 *  - A silence stops only a cast DB2 marks silenceable (`isSilenceableCast`).
 *    Kick, Pummel, Skull Bash, Rebuke, Disrupt, Counter Shot are not: on 605
 *    S2 files those were cast under a silence aura 31 times, the silenceable
 *    kicks (Counterspell, Wind Shear, Mind Freeze, Strangulate, Solar Beam,
 *    Spell Lock) twice in ~3,900 casts. 6062daf2 @32.7: a Feral Druid inside
 *    Garrote - Silence at cast start is still a kicker. Without `spellId`
 *    every cast-blocking aura counts.
 *  - The AURA half only, on purpose. `buildCannotCastIntervals` also carries
 *    school lockouts with no school on them, and an interrupt is rarely of
 *    the locked school: fa5e6c66's Frost-locked Mage (152.7–154.7) cast an
 *    Arcane Counterspell at 154.25. A kicker under a lockout is still a
 *    kicker.
 *
 * One predicate for "is this enemy's kick usable now": kick-eaten's
 * `kickersInRange` / `nearestKickerDistYd` (triage 2026-09-29 F-K5d) and the
 * `enemy interrupts UP` readers (res-readiness F-C5b). Ask it of the unit
 * that casts the kick — the pet for a pet kick (a Warlock commands Spell
 * Lock while stunned). `hostileIds` = the ids that may have applied the aura
 * (the other side's players and their summons, `enemySourceIds`).
 */
export function castBlockingAuraAt(
  unit: ICombatUnit,
  hostileIds: Set<string>,
  tMs: number,
  spellId?: string,
): CastBlockingAura | undefined {
  const silenceStops = spellId === undefined || isSilenceableCast(spellId);
  // hard CC stops every cast, a silence a silenceable one. An aura of the
  // cast-blocking TYPES that is neither — the lockout aura a kick leaves
  // (Shambling Rush 91807: type "interrupts", not in the official silence
  // category, not CC) — is the lockout half this predicate leaves out, and
  // used to be read as hard CC (pre-review of the batch: a Warrior in Pummel
  // range under 91807 dropped out of `kickersInRange`).
  return castBlockingAuraIntervals(unit, hostileIds).find(
    (a) =>
      a.from <= tMs &&
      tMs < a.to &&
      (ccSpellIds.has(a.spellId) ||
        (silenceStops && officialSilenceIds.has(a.spellId))),
  );
}

/** The root-like half of the same question for MOVEMENT: the hard CC (never
 * a silence — it does not stop walking) holding `unit` at `tMs`. */
export function hardCcAuraAt(
  unit: ICombatUnit,
  hostileIds: Set<string>,
  tMs: number,
): CastBlockingAura | undefined {
  return castBlockingAuraIntervals(unit, hostileIds).find(
    (a) => a.from <= tMs && tMs < a.to && ccSpellIds.has(a.spellId),
  );
}

/**
 * Silences on `unit`: the cast-blocking auras (the same predicate as
 * `buildCannotCastIntervals`, which already locks the unit for them) that are
 * in the official DR `silence` category and not hard CC (`ccSpellIds`, which
 * the [CC ON TEAM] / [CC ON ENEMY] lines already render). The official
 * category keeps kick-lockout auras out (Shambling Rush 91807 is mechanic
 * "interrupt": 349 of the first run's 11,625 lines). Round 2 found Garrote -
 * Silence, Strangulate and Spider Venom on the log owner in 4 of 24 matches
 * with no timeline line at all, so the prompt read the healer as free
 * (reliability round 2 W1b).
 */
export function silenceIntervals(
  unit: ICombatUnit,
  enemyIds: Set<string>,
): CastBlockingAura[] {
  return castBlockingAuraIntervals(unit, enemyIds)
    .filter((a) => isSilenceOnlyAura(a.spellId))
    .sort((x, y) => x.from - y.from);
}

/**
 * The contiguous runs of the intervals' union, sorted (touching intervals
 * merge). Triage G5: the death-setup `chain` is the CCs of every run that
 * touches the 12 s before the death (crisis-external F-AS1).
 */
export function cannotCastRuns(
  intervals: ReadonlyArray<{ from: number; to: number }>,
): Array<{ from: number; to: number }> {
  const sorted = [...intervals]
    .filter((iv) => iv.to > iv.from)
    .sort((a, b) => a.from - b.from);
  const runs: Array<{ from: number; to: number }> = [];
  for (const iv of sorted) {
    const last = runs[runs.length - 1];
    if (last && iv.from <= last.to) last.to = Math.max(last.to, iv.to);
    else runs.push({ from: iv.from, to: iv.to });
  }
  return runs;
}

/**
 * Triage G5 (crisis-external F-AS1 / death-kill F-S1, reused by cc-dr F-KS1):
 * the lock chain before a death. `runs` = every contiguous cannot-cast run
 * touching [deathMs − lookbackMs, deathMs], not clipped at the window start;
 * `links` = the cast-blocking auras inside those runs that began before the
 * death, in time order (a kick lockout counts toward the runs and `lockedMs`
 * but is not a CC to name); `lockedMs` = cannot-cast ms of the window.
 */
export function deathLockChain<
  T extends { from: number; to: number; lockout: boolean },
>(
  named: ReadonlyArray<T>,
  deathMs: number,
  lookbackMs: number,
): { runs: Array<{ from: number; to: number }>; links: T[]; lockedMs: number } {
  const winFromMs = deathMs - lookbackMs;
  const runs = cannotCastRuns(named).filter(
    (r) => r.to > winFromMs && r.from < deathMs,
  );
  const links = named
    .filter(
      (iv) =>
        !iv.lockout &&
        iv.from < deathMs &&
        runs.some((r) => iv.from < r.to && iv.to > r.from),
    )
    .sort((a, b) => a.from - b.from);
  return { runs, links, lockedMs: coveredMsWithin(named, winFromMs, deathMs) };
}

/**
 * Free milliseconds just before `atMs`: `atMs` − the end of the last
 * cannot-cast run that starts before it, 0 when that run covers `atMs`, or
 * undefined when no run starts before it (never a `Math.max` over nothing).
 * Triage G5: death-setup `freeBeforeDeathS` (crisis-external F-D2) and the
 * `[DEFENSIVE AVAILABLE]` "free Ns before the death" (cc-dr F-KS1) — one
 * helper, one interval list.
 */
export function freeMsBefore(
  intervals: ReadonlyArray<{ from: number; to: number }>,
  atMs: number,
): number | undefined {
  const before = cannotCastRuns(intervals).filter((r) => r.from < atMs);
  const last = before[before.length - 1];
  if (!last) return undefined;
  return last.to >= atMs ? 0 : atMs - last.to;
}

/**
 * Milliseconds of [fromMs, toMs] covered by the union of the intervals
 * (clipped to the window, overlaps merged so a stun inside a silence is not
 * counted twice).
 */
export function coveredMsWithin(
  intervals: ReadonlyArray<{ from: number; to: number }>,
  fromMs: number,
  toMs: number,
): number {
  const clipped: Array<{ from: number; to: number }> = [];
  for (const iv of intervals) {
    const from = Math.max(iv.from, fromMs);
    const to = Math.min(iv.to, toMs);
    if (to > from) clipped.push({ from, to });
  }
  if (clipped.length === 0) return 0;
  clipped.sort((a, b) => a.from - b.from);
  let covered = 0;
  let cur = clipped[0]!;
  for (let i = 1; i < clipped.length; i++) {
    const w = clipped[i]!;
    if (w.from <= cur.to) cur = { from: cur.from, to: Math.max(cur.to, w.to) };
    else {
      covered += cur.to - cur.from;
      cur = w;
    }
  }
  covered += cur.to - cur.from;
  return covered;
}

/**
 * The one "could this unit react at all in [fromMs, toMs]" test: at least
 * REACTION_WINDOW_S of the window not covered by a cannot-cast interval.
 * Shared by missed-sync-window's readiness (`evaluateSyncWindow`, B3i) and
 * cd-hoarded's owner gate (reliability round 2 W1a, 2026-09-25) — before this
 * each consumer either computed it inline or did not check at all.
 */
export function couldReactWithin(
  blocked: ReadonlyArray<{ from: number; to: number }>,
  fromMs: number,
  toMs: number,
): boolean {
  const freeMs = toMs - fromMs - coveredMsWithin(blocked, fromMs, toMs);
  return freeMs >= REACTION_WINDOW_S * 1000;
}

/**
 * The stricter form for a WINDOW the player is expected to use (an enemy
 * healer's lock): free for at least half of it and never less than
 * REACTION_WINDOW_S. User ruling 2026-09-26 (reliability leftovers, sync-window
 * design question A): an owner stunned for 3 of a 5 s lock with 2.2 s free
 * does not count as able to enter it — `couldReactWithin`'s 1 s is the
 * reaction standard for a crisis response, not for spending a lock.
 */
export function couldActForMostOf(
  blocked: ReadonlyArray<{ from: number; to: number }>,
  fromMs: number,
  toMs: number,
): boolean {
  const span = toMs - fromMs;
  if (span <= 0) return false;
  const freeMs = span - coveredMsWithin(blocked, fromMs, toMs);
  return freeMs >= Math.max(REACTION_WINDOW_S * 1000, span / 2);
}

/**
 * `couldReactWithin` bound to one unit on the round's clock, with death: the
 * window is cut at the unit's first death and at `roundEndMs` (the match end,
 * or a Solo Shuffle round's ending death — time after it is not playable,
 * triage 2026-09-29 H4), and a unit dead before the window could not
 * respond. Arguments are seconds since `matchStartMs`. When the
 * intervals cannot be built the answer is "could respond" — a missing input
 * must never manufacture an exemption silently, but neither may it throw the
 * caller's candidate away (the caller's try/catch would drop the whole type).
 */
export function couldRespondFor(
  unit: ICombatUnit,
  enemyIds: Set<string>,
  matchStartMs: number,
  roundEndMs: number = Infinity,
): (fromS: number, toS: number) => boolean {
  return actWindowFor(unit, enemyIds, matchStartMs, roundEndMs).couldRespond;
}

/** What blocked a unit around an anchor second, and how long it was free. */
export interface ActWindowState {
  /** the cannot-cast intervals overlapping [fromS, toS] cut at death and the
   * round end (the gate's window), seconds since round start, unclipped
   * (`toS` Infinity = never removed), in start order */
  blocks: Array<{
    spellId: string;
    lockout: boolean;
    fromS: number;
    toS: number;
  }>;
  /** seconds of (anchorS, toS] — cut at death and the round end, like
   * `couldRespond` — outside every cannot-cast interval */
  freeAfterS: number;
  /** the window's end after that cut, seconds since round start (F-H5
   * `windowS` = endS − t) */
  endS: number;
}

/**
 * `couldRespondFor`'s predicate and its explanation from ONE set of inputs
 * (same intervals, same death and round-end cut): `couldRespond` is the owner
 * gate, `stateIn` the fact that says what the gate saw — cd-hoarded's
 * `ownerCc` / `ownerFreeS` (triage 2026-09-29 H1: the gate passes an owner
 * CC'd for most of the window by ruling, and the line then read "held").
 * `stateIn` is null when the intervals cannot be built.
 */
export function actWindowFor(
  unit: ICombatUnit,
  enemyIds: Set<string>,
  matchStartMs: number,
  roundEndMs: number = Infinity,
): {
  couldRespond: (fromS: number, toS: number) => boolean;
  stateIn: (
    fromS: number,
    toS: number,
    anchorS: number,
  ) => ActWindowState | null;
} {
  let named: NamedCannotCastInterval[];
  try {
    named = namedCannotCastIntervals(unit, enemyIds);
  } catch {
    return { couldRespond: () => true, stateIn: () => null };
  }
  const deathMs = firstDeathMs(unit);
  const endMs = (toS: number) =>
    Math.min(matchStartMs + toS * 1000, deathMs, roundEndMs);
  return {
    couldRespond: (fromS, toS) => {
      const fromMs = matchStartMs + fromS * 1000;
      const toMs = endMs(toS);
      if (toMs <= fromMs) return false;
      return couldReactWithin(named, fromMs, toMs);
    },
    stateIn: (fromS, toS, anchorS) => {
      const fromMs = matchStartMs + fromS * 1000;
      // the gate's own window: cut at death and the round end, so a CC that
      // landed after the round was over is never named (agy review of F-H1)
      const toMs = endMs(toS);
      const blocks = named
        .filter((iv) => iv.to > fromMs && iv.from < toMs)
        .sort((a, b) => a.from - b.from)
        .map((iv) => ({
          spellId: iv.spellId,
          lockout: iv.lockout,
          fromS: (iv.from - matchStartMs) / 1000,
          toS: (iv.to - matchStartMs) / 1000,
        }));
      const anchorMs = matchStartMs + anchorS * 1000;
      const freeEndMs = toMs;
      const freeAfterS =
        freeEndMs > anchorMs
          ? (freeEndMs -
              anchorMs -
              coveredMsWithin(named, anchorMs, freeEndMs)) /
            1000
          : 0;
      return { blocks, freeAfterS, endS: (toMs - matchStartMs) / 1000 };
    },
  };
}
