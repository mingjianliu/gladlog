/**
 * ownShieldLinks.ts — which own absorb shields a press put up (fact6 F20,
 * user ruling 1 2026-10-28): the one lookup for "this shield aura is the
 * effect of that press", read by the kill windows' `defenseless` reading
 * (`ownPressedShieldSpansMs`) and by corpusFactScan2's E6.
 *
 * Source: `ownShieldLinksGenerated.json`, written by
 * `packages/eval/scripts/ownShieldLinkScan.ts --emit`:
 *  - `rulingFamily` (DB2 only): Power Word: Shield 17 / Void Shield 1253593
 *    and every DB2 absorb in their `SpellClassOptions` family (same class
 *    set, a shared mask bit) — Holy's proc PW:S 1246768 and Unfolding
 *    Vision's copies 1300008 / 1300009 (round-6 D15 D16 D18);
 *  - `riders` (DB2 nominates, the corpus chooses): a class-owned DB2 absorb
 *    that ≥ 90 % of the time goes up within ±150 ms of its holder's press of
 *    ANOTHER spell, and absorbs — Chi Cocoon 406220 with Invoke Chi-Ji,
 *    1260681 with Enveloping Mist (D21), Matted Fur with Barkskin,
 *    Purification with Purify, First In, Last Out with Fel Rush (the rate
 *    counts only holders whose carrying press the log shows: the
 *    Devourer's Shift writes no cast row); a shield pressed as itself on
 *    some applications and carried by another press on most of the rest
 *    counts both (Reversion 367364 with Merithra's Blessing, 86 % + its own
 *    Reversion press — F20 wide residual). Passive procs (Divine Aegis 71 %, Soul Leech
 *    16 %), deferrals (Stretch Time) and auras that never absorb (Glimpse's
 *    20 % reduction) are not riders.
 * Chosen on the 605 S2 files (2026-10-28, fact6 F20 residual; 90 %); the
 * wide corpus is still to
 * run (corpusFactScan5 `absorb` module's `report()` prints the same
 * inventory). Re-run both legs at a season refresh
 * (docs/commands/update-wow-data.md §7b). Registered in curatedIdRegistry.
 */
import { castsOfEffectAura } from "./castEffectAuras";
import generated from "./ownShieldLinksGenerated.json";

interface IRider {
  name: string;
  casts: string[];
  apps: number;
  withPress: number;
  /** its own id is a cast players log (Ice Barrier) */
  castAsItself?: true;
}
const data = generated as unknown as {
  rulingFamily: string[];
  riders: Record<string, IRider>;
};

/** Ruling (1)'s shields by DB2 family — up counts, pressed or not. */
export const OWN_SHIELD_RULING_FAMILY_IDS: ReadonlySet<string> = new Set(
  data.rulingFamily,
);

const NONE: readonly string[] = [];

/** The presses of other spells that put this shield aura up (the rider
 * table); empty for a shield no other press carries. */
export function riderCastsOfShield(auraSpellId: string): readonly string[] {
  return data.riders[auraSpellId]?.casts ?? NONE;
}

/** A rider whose application stands for its carrying press when the
 * holder logged no cast of any carrier that round (the Devourer's Shift,
 * which writes no cast row, puts First In, Last Out up) — not one whose own
 * id is a logged press (Ice Barrier 11426: 17 of the 739 applications on
 * the 605 on mages with no Blazing Barrier had no Ice Barrier / Blazing
 * Barrier cast in the 2 s before — they came some other way). */
export function riderStandsForUnloggedPress(auraSpellId: string): boolean {
  const r = data.riders[auraSpellId];
  return !!r && r.casts.length > 0 && !r.castAsItself;
}

/** The casts whose press puts this own shield aura up: its own id, a cast
 * whose effect it is (`castsOfEffectAura`), a press that carries it
 * (`riderCastsOfShield`). Its name is the third link the readers add. */
export function ownShieldPressCastIds(auraSpellId: string): ReadonlySet<string> {
  return new Set([
    auraSpellId,
    ...castsOfEffectAura(auraSpellId),
    ...riderCastsOfShield(auraSpellId),
  ]);
}

/** Every [rider shield aura, cast] pair — for the registry. */
export function riderShieldPairs(): ReadonlyArray<readonly [string, string]> {
  return Object.entries(data.riders).flatMap(([aura, r]) =>
    r.casts.map((c) => [aura, c] as const),
  );
}
