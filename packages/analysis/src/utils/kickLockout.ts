/**
 * kickLockout.ts — how long a kick locked THIS victim out (triage
 * 2026-09-29 kick-eaten F-K8, user ruling A23, 2026-09-30).
 *
 * `kickLockoutSeconds(kick)` is the kick's lockout and knows nothing of the
 * victim. Some victims shorten it for some interrupted spells: Storm Conduit
 * (Shaman PvP talent 1217092) puts aura 1223529 on its holder — DB2 effect
 * aura 232 MOD_MECHANIC_DURATION, misc 26 (interrupt), PvpMultiplier 1 —
 * which shortens the lockout of an interrupted Lightning Bolt / Chain
 * Lightning. The holder is read from the victim's COMBATANT_INFO PvP talents
 * (Game-Behaviour Rule 4: never inferred from the arithmetic).
 *
 * **By how much depends on the date of the log** (user ruling 2026-10-11,
 * "date it if the evidence holds"; it replaces A23's flat ×0.6 and the FLAG
 * that row kept open at "corpus ×0.35"). The aura's base was −65 until the
 * 2026-08-18 hotfix and is −40 since: ×0.35 for an interrupt logged before
 * `STORM_CONDUIT_HOTFIX_EPOCH_MS`, ×0.6 from it on (Wind Shear 2.0 → 0.7 s /
 * 1.2 s) — the instant, the comparison (`logIsFrom`) and the not-a-date rule
 * (`logDatedNumberAt`) of the talent's cooldown half
 * (`eventReductionSecondsAt`, data/talentScriptedCooldowns.ts).
 *
 * Evidence (Game-Behaviour Rule; `kickLockoutScan.ts` re-runs the corpus leg,
 * fix-FT `scl-lockout-split-605.txt` is the run this was decided on):
 *  - DB2 row: SpellEffect 1211582 of 1223529 reads −65 in builds
 *    12.1.0.69273 and 69382 and −40 in 69404, 69587, 12.1.5.69594 and 69952
 *    (the datagen cache's SpellEffect CSVs — the repo's generated tables
 *    carry the aura's name only, so neither number is in them).
 *  - What it covers: aura 232 has no class mask or label, it shortens the
 *    interrupt MECHANIC, and the tooltip's "while casting Lightning Bolt and
 *    Chain Lightning" is a script. The corpus is the leg for the spell list:
 *    holders interrupted on another spell (36 pairs) and non-holders
 *    interrupted on these two (17) never come back before ×0.84 of the
 *    kick's own lockout.
 *  - Corpus split, 605 new-season files: the victim's first cast of a locked
 *    school after the interrupt as a fraction of the kick's own lockout, the
 *    interrupt dated as the product dates it. 15 holder pairs, all on
 *    Lightning Bolt. Before the cutover 8 (Restoration, logs of 08-14 …
 *    08-16): ×0.344 – ×0.367 for seven and ×0.456 for one, each within −12 …
 *    +211 ms of 0.35 × the lockout and 289 – 1396 ms before 0.6 × it. Since
 *    the cutover 7 (six Restoration, one Elemental): ×0.622, ×0.629, ×0.727,
 *    ×0.780, ×0.808, ×1.225 — the ×0.622 one still refused "not ready" at
 *    ×0.480 — and one at ×0.351 (the FLAG below). A first cast more than
 *    15 ms before the modelled end: 9 of 15 with ×0.6 alone, 1 of 15 dated.
 *    (The log's clock is the recording client's: of the 5,598 pairs no
 *    modifier applies to, 978 land within 15 ms of the kick's lockout and
 *    294 of those before it.)
 *  - Arithmetic: 1 − 0.65 = 0.35 and 1 − 0.40 = 0.6 of 2 / 3 / 5 / 6 s.
 *
 * **FLAG, kept open — the hour of the hotfix, and everything not measured.**
 *  - The one pair on the wrong side is the only one logged on the hotfix
 *    day: 2026-08-18 18:56 in an Oceanic log (097c4ae3; its UTC+10 is
 *    written without a sign, so the parser reads it in its own zone — 08:56
 *    UTC in truth), still ×0.351. So the hotfix went live after
 *    `STORM_CONDUIT_HOTFIX_EPOCH_MS`, the start of that day in UTC: the
 *    corpus puts it between 08-18 08:56 UTC and 08-19 04:37 UTC (the ×0.629
 *    pair; 08-19 15:01 UTC for the refused press). A holder's log of 08-18
 *    from before it reads ×0.6 where the game had ×0.35 — the longer lock,
 *    the side that exempts more, and what every log read before this change.
 *    The instant is the cooldown half's and the ruling's wording ("from
 *    2026-08-18"); it is not moved here.
 *  - Before 12.1 (2026-08-11): no pair in the corpus and no DB2 build that
 *    old in the cache. The one older match read (1b930c17, 2026-07-27, the
 *    match A23 began with — A23's probe, not this scan) has its two pairs at
 *    ×0.49 and ×0.52: ×0.6 is contradicted there too and ×0.35 is not, but
 *    a third value (×0.5) would fit them as well.
 *  - An Elemental holder before the hotfix, and Chain Lightning on either
 *    side: no pair. The aura row has no spec in it, so every holder is read
 *    alike (the cooldown half is per spec because its seconds are a script).
 *
 * Direction: a successful cast proves the lock was over, so the shorter
 * number is the safe one for the TEXT — but a shorter lock also exempts less
 * ("the healer was locked" is true for less time), so dating it can ADD
 * candidate rows on a pre-hotfix holder's log as well as change the facts on
 * existing ones. The mechanism is the dated hotfix; the control is the
 * post-hotfix samples, which do not come back early.
 *
 * Readers, all through `kickLockoutSecondsFor` with the interrupt's own log
 * timestamp: the kick instance's `lockoutDurationSeconds` (kick-eaten
 * `lockout=`, `kickPressure`, `postKick`, `[RES] cc:[kick]`), the cannot-cast
 * intervals (`cannotCastIntervals.ts`: msw / kick-priority / cd-hoarded
 * feasibility), `[CONSEQ]` (`observedConsequences.ts`) and eval's
 * `consequenceFacts.ts` — the four consumers of the signed row. The table is
 * registered in `curatedIdRegistry.ts`.
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { kickLockoutSeconds, spellEffectData } from "../data/spellEffectData";
import { STORM_CONDUIT_HOTFIX_EPOCH_MS } from "../data/talentScriptedCooldowns";
import { playerTalentIdSets } from "./cooldowns";
import type { LogInstant } from "./logEra";
import { logInstantOf } from "./logEra";
import { type ILogDatedNumber, logDatedNumberAt } from "./logEra";
import { talentModifierOwnershipOf } from "./talentOwnership";

export interface KickLockoutVictimModifier {
  /** the victim's talent (PvP talent spell id, as COMBATANT_INFO lists it) */
  talentId: string;
  /** the interrupted spells it applies to */
  interruptedSpellIds: ReadonlySet<string>;
  /** lockout × this. Not always one number, so no reader takes it from
   * here: `kickLockoutVictimMultiplierAt` says what it is at a timestamp. */
  multiplier: number | ILogDatedNumber;
}

export const KICK_LOCKOUT_VICTIM_MODIFIERS: readonly KickLockoutVictimModifier[] =
  [
    {
      talentId: "1217092", // Storm Conduit → aura 1223529 (aura 232, misc 26)
      interruptedSpellIds: new Set([
        "188196", // Lightning Bolt
        "188443", // Chain Lightning
      ]),
      // DB2 −65 before the 2026-08-18 hotfix, −40 since — see the header
      multiplier: {
        cutoverEpochMs: STORM_CONDUIT_HOTFIX_EPOCH_MS,
        before: 0.35,
        since: 0.6,
      },
    },
  ];

/**
 * Auras that change the length of an interrupt on the unit that HOLDS them at
 * the interrupt, whatever spell was interrupted (pipeline T69, GH #134 item
 * "lockout readers run to the modelled lock end": a lock printed 3.0 s on a
 * victim standing in Concentration Aura). `multiplier` is the DB2 row's own
 * PvP number, 1 + base × PvpMultiplier / 100.
 *
 * Evidence (Game-Behaviour Rule; `kickLockoutScan.ts` re-runs the corpus leg
 * — its "victims with a DB2 interrupt-duration aura" block — and carries the
 * full DB2 list, every SpellEffect row with aura 232 MOD_MECHANIC_DURATION,
 * misc 26, of build 12.1.7.70740; the rows of the three ids below read the
 * same in 12.1.0.69587, 12.1.5.69952 and 12.1.5.70391):
 *  - Concentration Aura 317920: effect 0, area aura (Effect 65) 232 / misc
 *    26, base −30, PvpMultiplier 0.67 → ×0.799. No class mask or label: the
 *    row shortens the interrupt mechanic on its holder, as Storm Conduit's
 *    does. 605 files, 43 pairs on a holder with no talent modifier (gap to
 *    the victim's first cast of a locked school ÷ the kick's own lockout):
 *    23 come back more than 15 ms before the unmodified end (×1), 8 before
 *    ×0.799 — five of those no proof (a passive row, a lock-ignoring cast,
 *    a triggered row, a Counterspell from a mage without the +1 s talent)
 *    and three real: ×0.788 (33 ms early) and ×0.732 / ×0.736.
 *  - Oppressing Roar 372048 / 406971: aura 232 / misc 26, base +50,
 *    PvpMultiplier 0.6 → ×1.3. 7 pairs: none before ×1.3, the two earliest
 *    at ×1.303 and ×1.320, and one still refused "not ready" after the
 *    unmodified end.
 *
 * **FLAG, kept open — Concentration Aura may be the full −30 in arenas.**
 * Two pairs of one Warlock (928f085e, Disrupt's 3 s: Agony at 2.196 s, Drain
 * Soul at 2.209 s) come back ~200 ms before 2.397 s and after 2.1 s (×0.7,
 * the row without its PvpMultiplier); no pair of the 43 contradicts ×0.7,
 * and no refusal sits between the two. Oppressing Roar's cluster at ×1.30
 * says the PvpMultiplier is applied to this aura type, so the official
 * number stays (user ruling on control lengths, `ccFullDurationSeconds`:
 * the official number unless a mechanism is known) — the longer lock of
 * the two, the side that keeps a "was locked" exemption. Left of the DB2
 * list with no pair on 605 and not modelled: 196879, 221404, 221660,
 * 221677, 234084.
 *
 * Up at the interrupt = the victim's last APPLIED / REMOVED row of the id
 * before it, or the log's start list (`interestingAurasJSON` — a Paladin
 * aura is usually up before the gates open). Registered in
 * curatedIdRegistry.
 */
export const KICK_LOCKOUT_VICTIM_AURAS: Readonly<
  Record<string, { name: string; multiplier: number }>
> = {
  "317920": { name: "Concentration Aura", multiplier: 0.799 },
  "372048": { name: "Oppressing Roar", multiplier: 1.3 },
  "406971": { name: "Oppressing Roar", multiplier: 1.3 },
};

/** Is `auraId` up on `victim` at `atMs`: its latest APPLIED / REFRESH /
 * REMOVED row at or before that instant (a REMOVED in the instant's own
 * millisecond leaves it up), else the log's start list. Latest by
 * timestamp, not by position — a log's rows can step back in time. An
 * application whose REMOVED the log never shows is over at the aura's DB2
 * length (the rule `oppressingRoarTracker` keeps; an aura with no length,
 * Concentration Aura, stays up). Codex 85-tk-F-T69-1 #1 / #2. */
function victimAuraUpAt(
  victim: Pick<ICombatUnit, "auraEvents"> & Partial<Pick<ICombatUnit, "info">>,
  auraId: string,
  atMs: number,
): boolean {
  let up = false;
  try {
    const initial: unknown = JSON.parse(
      victim.info?.interestingAurasJSON ?? "[]",
    );
    up = Array.isArray(initial) && initial.some((x) => String(x) === auraId);
  } catch {
    // unreadable start list: nothing up at the start
  }
  let lastMs = -Infinity;
  let appliedMs: number | undefined;
  for (const a of victim.auraEvents ?? []) {
    if (a.spellId !== auraId) continue;
    const t = a.logLine.timestamp;
    if (t > atMs || t < lastMs) continue;
    const ev = a.logLine.event;
    if (
      ev === LogEvent.SPELL_AURA_APPLIED ||
      ev === LogEvent.SPELL_AURA_REFRESH
    ) {
      up = true;
      appliedMs = t;
      lastMs = t;
    } else if (ev === LogEvent.SPELL_AURA_REMOVED && t < atMs) {
      up = false;
      appliedMs = undefined;
      lastMs = t;
    }
  }
  if (up && appliedMs !== undefined) {
    const dur = spellEffectData[auraId]?.durationSeconds;
    if (dur !== undefined && dur > 0 && atMs > appliedMs + dur * 1000)
      return false;
  }
  return up;
}

/** `KICK_LOCKOUT_VICTIM_AURAS` on this victim at this instant: the product
 * of the multipliers of the auras up on it (one per name — the two
 * Oppressing Roar ids are one debuff), 1 with none. */
export function kickLockoutVictimAuraMultiplierAt(
  victim: Pick<ICombatUnit, "auraEvents"> & Partial<Pick<ICombatUnit, "info">>,
  interruptEpochMs: number,
): number {
  const seen = new Set<string>();
  let mult = 1;
  for (const [id, m] of Object.entries(KICK_LOCKOUT_VICTIM_AURAS)) {
    if (seen.has(m.name) || !victimAuraUpAt(victim, id, interruptEpochMs))
      continue;
    seen.add(m.name);
    mult *= m.multiplier;
  }
  return mult;
}

/**
 * Kicker talents a kick's lockout already INCLUDES (user ruling 2026-10-20,
 * fact1215 retest idx 11, 「都要」): Counterspell's 6 s (ruling 2026-09-18,
 * `SPELL_EFFECT_OVERRIDES`) is the Improved Counterspell 1270865 holder's
 * value — "the target cannot cast for 1 sec longer", taken by 94.6 % of mages
 * (talent impact audit 2026-09-26); DB2's own lockout is 5 s. A mage whose
 * talents show the node missing locks for 5 (raw 1:38.927: Echo, Arcane,
 * refused up to +4.80 s and cast at +5.17 s after a non-holder's
 * Counterspell). Only a definite "no" shortens — an unknown kicker keeps the
 * ruled holder value (the `ccFullDurationForCaster` rule for a talent the
 * typical base already carries). Registered in curatedIdRegistry.
 */
export const KICK_LOCKOUT_KICKER_TALENTS: Readonly<
  Record<string, { talentSpellId: string; seconds: number }>
> = {
  "2139": { talentSpellId: "1270865", seconds: 1 }, // Counterspell ← Improved Counterspell
};

/** `kickLockoutSeconds` for this kicker: the ruled lockout, less what a
 * talent it definitely lacks would have added. */
export function kickLockoutSecondsOfKicker(
  kickSpellId: string,
  kicker: ICombatUnit | undefined,
): number {
  const base = kickLockoutSeconds(kickSpellId);
  const t = KICK_LOCKOUT_KICKER_TALENTS[kickSpellId];
  if (!t || !kicker) return base;
  return talentModifierOwnershipOf(kicker, t.talentSpellId) === "no"
    ? base - t.seconds
    : base;
}

/**
 * What `m` multiplies a lockout by for an interrupt logged at `logEpochMs` —
 * the one reading of a modifier's number (the scan that re-checks it against
 * the corpus asks here too). A timestamp that is not a number takes the
 * CURRENT value (`logDatedNumberAt`): for Storm Conduit that is the longer
 * lockout, the side on which a "was locked" exemption is kept.
 */
export function kickLockoutVictimMultiplierAt(
  m: Pick<KickLockoutVictimModifier, "multiplier">,
  logEpochMs: LogInstant,
): number {
  return typeof m.multiplier === "number"
    ? m.multiplier
    : logDatedNumberAt(m.multiplier, logEpochMs);
}

/** A lockout's length rounded as every line prints it: one decimal — the
 * kick-eaten row's `lockout` fact ("3.0", "2.4"). Pipeline T69 attempt 2: a
 * Storm Conduit holder's lock printed "2.4" there and "2.397s" on the
 * `[CONSEQ]` line. */
export function fmtKickLockoutSeconds(seconds: number): string {
  return seconds.toFixed(1);
}

/** The same rounding with a whole number left bare, the `[CONSEQ]` line's
 * `Ns school lockout`: "3s", "2.4s", and "4s" for 3.96 (coordinator
 * 2026-11-13: only a fractional lock's text moves). The gate re-parses this
 * text (`checkConseqHpStateConsistency`). */
export function fmtKickLockoutSecondsBare(seconds: number): string {
  return String(Number(fmtKickLockoutSeconds(seconds)));
}

/** The lockout `kickSpellId` puts on `victim` for interrupting
 * `interruptedSpellId` at `interruptEpochMs` (the SPELL_INTERRUPT row's own
 * log timestamp — every reader holds it): `kickLockoutSeconds` × every
 * modifier the victim holds for that spell, each as of that timestamp, in
 * whole milliseconds (3 × 0.6 is 1.7999999999999998 otherwise; printed
 * through `fmtKickLockoutSeconds` / `fmtKickLockoutSecondsBare`). Without a victim or an interrupted spell it
 * is the kick's own lockout — times `KICK_LOCKOUT_VICTIM_AURAS` when a
 * victim is given: an aura on it at the interrupt needs no interrupted spell. */
export function kickLockoutSecondsFor(
  kickSpellId: string,
  victim: ICombatUnit | undefined,
  interruptedSpellId: string | undefined,
  interruptEpochMs: number,
  /** the interrupt's source: a kicker whose talents show it lacks a talent
   * the kick's lockout includes locks for less (`KICK_LOCKOUT_KICKER_TALENTS`) */
  kicker?: ICombatUnit,
): number {
  const base = kickLockoutSecondsOfKicker(kickSpellId, kicker);
  if (!victim) return base;
  // an aura on the victim changes every interrupt on it, whatever was cast
  const auraMult = kickLockoutVictimAuraMultiplierAt(victim, interruptEpochMs);
  let lock = base * auraMult;
  let modified = auraMult !== 1;
  const done = () => (modified ? Math.round(lock * 1000) / 1000 : lock);
  if (!interruptedSpellId) return done();
  let held: Set<string>;
  try {
    held = playerTalentIdSets(victim).pvpTalentIds;
  } catch {
    return done();
  }
  for (const m of KICK_LOCKOUT_VICTIM_MODIFIERS)
    if (held.has(m.talentId) && m.interruptedSpellIds.has(interruptedSpellId)) {
      lock *= kickLockoutVictimMultiplierAt(
        m,
        logInstantOf(victim, interruptEpochMs),
      );
      modified = true;
    }
  return done();
}

/**
 * When the lock a kick-eaten row speaks of ends, in whole ms since the match
 * start: the modelled lockout or, earlier, the first successful press of a
 * spell that lock covers (`lockEndedBySuccessS`, ruling A23). The one end of
 * the kick-eaten text (`postKick`, the rejected-press split) and of the
 * row's pressure window (`kickPressure`: `ourLow*` / `theirLow*` / burst) —
 * until pipeline T69 each computed it, one in ms and one in seconds (GH
 * #134, "lock end, no shared predicate").
 *
 * Whole milliseconds: `lockEndedBySuccessS` is `cast − kick`, and adding
 * the kick back is one ulp above the cast's own instant when the
 * subtraction was inexact (kick 0.177 s, cast 0.838 s → 0.8380000000000001),
 * so a reject logged in the cast's own millisecond read as inside the
 * lockout.
 */
export function kickTextLockEndMs(k: {
  atSeconds: number;
  lockoutDurationSeconds: number;
  lockEndedBySuccessS?: number | null;
}): number {
  return Math.round(
    (k.atSeconds +
      Math.min(k.lockoutDurationSeconds, k.lockEndedBySuccessS ?? Infinity)) *
      1000,
  );
}
