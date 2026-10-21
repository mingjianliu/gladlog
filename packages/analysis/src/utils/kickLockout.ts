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
import type { ICombatUnit } from "@gladlog/parser-compat";

import { kickLockoutSeconds } from "../data/spellEffectData";
import { STORM_CONDUIT_HOTFIX_EPOCH_MS } from "../data/talentScriptedCooldowns";
import { playerTalentIdSets } from "./cooldowns";
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
  logEpochMs: number,
): number {
  return typeof m.multiplier === "number"
    ? m.multiplier
    : logDatedNumberAt(m.multiplier, logEpochMs);
}

/** The lockout `kickSpellId` puts on `victim` for interrupting
 * `interruptedSpellId` at `interruptEpochMs` (the SPELL_INTERRUPT row's own
 * log timestamp — every reader holds it): `kickLockoutSeconds` × every
 * modifier the victim holds for that spell, each as of that timestamp, in
 * whole milliseconds (3 × 0.6 is 1.7999999999999998 otherwise, and `[CONSEQ]`
 * prints the number as it is). Without a victim or an interrupted spell it
 * is the kick's own lockout. */
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
  if (!victim || !interruptedSpellId) return base;
  let held: Set<string>;
  try {
    held = playerTalentIdSets(victim).pvpTalentIds;
  } catch {
    return base;
  }
  let lock = base;
  let modified = false;
  for (const m of KICK_LOCKOUT_VICTIM_MODIFIERS)
    if (held.has(m.talentId) && m.interruptedSpellIds.has(interruptedSpellId)) {
      lock *= kickLockoutVictimMultiplierAt(m, interruptEpochMs);
      modified = true;
    }
  return modified ? Math.round(lock * 1000) / 1000 : lock;
}
