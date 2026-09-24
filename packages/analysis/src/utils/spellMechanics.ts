/**
 * Official spell-mechanic facts (`spellMechanicsGenerated.json`, GH #77) —
 * the one place that answers "what kind of control is this", "is it
 * instant", "does this aura make its carrier immune to it" and "does this
 * aura stop its carrier casting". Every answer that cannot be read off DB2
 * is `undefined` / `null`, and callers treat that as "don't know → say
 * nothing", never as a yes or a no.
 */
import raw from "../data/spellMechanicsGenerated.json";

interface Entry {
  mech?: number;
  castMs?: number;
  immuneMech?: number[];
  immuneMechMask?: number;
  immuneAll?: boolean;
  locksCasting?: boolean;
}

const SPELLS = (raw as unknown as { spells: Record<string, Entry | undefined> })
  .spells;

/** SpellMechanic ids that `mechanicStateOf` maps onto the three official
 * usable-while-CC states. */
const STUN_MECHANICS = new Set([12]);
const FEAR_MECHANICS = new Set([5, 24]); // fleeing, horrified
const CONFUSE_MECHANICS = new Set([2]); // disoriented

/** The CC's mechanic (SpellMechanic id), or undefined when DB2 cannot say
 * (Holy Word: Chastise 88625: its aura is an incapacitate or a stun
 * depending on a talent). */
export function ccMechanicOf(spellId: string): number | undefined {
  return SPELLS[spellId]?.mech;
}

/** True only when DB2 says the base cast time is 0. Unknown is not instant. */
export function isInstantCast(spellId: string): boolean {
  return SPELLS[spellId]?.castMs === 0;
}

/** Does carrying this aura make the carrier immune to a CC of `mech`?
 * `null` = unknown (the aura carries an aura-147 mask whose bit order is
 * unresolved — see genSpellMechanics.ts). */
export function auraBlocksMechanic(
  auraId: string,
  mech: number,
): boolean | null {
  const e = SPELLS[auraId];
  if (!e) return false;
  if (e.immuneAll || e.immuneMech?.includes(mech)) return true;
  if (e.immuneMechMask !== undefined) return null;
  return false;
}

/** Is `mech` listed on this spell's own mechanic-immunity aura (aura 77)?
 * Those are the designed CC breakers, and the corpus confirms they are pressed
 * from inside that CC (S2 archive 1 in 30, cast within the CC or at its
 * removal instant): Will of the Forsaken 352 / 373 casts, Will to Survive
 * 227 / 248, Berserker Shout 292 / 469, Berserker Rage 49 / 64, Lichborne
 * 135 / 231, Icebound Fortitude 111 / 247 (stun), Blink 601 / 1,958. The
 * official usable-while-feared attribute does NOT list Berserker Rage, so it
 * cannot be the gate for these. Full-school immunities (Ice Block, Divine
 * Shield) are not "explicit" — see `auraBlocksMechanic`. */
export function explicitlyBreaksMechanic(
  spellId: string,
  mech: number,
): boolean {
  return SPELLS[spellId]?.immuneMech?.includes(mech) === true;
}

/** Does this aura stop its carrier casting its other abilities (Ice Block,
 * Dispersion, Bladestorm)? */
export function auraLocksCasting(auraId: string): boolean {
  return SPELLS[auraId]?.locksCasting === true;
}

/** Which official usable-while-CC state a mechanic puts its victim in, or
 * null when no such official attribute exists (incapacitate, sap, sleep,
 * polymorph, …). */
export function mechanicStateOf(
  mech: number,
): "stunned" | "feared" | "confused" | null {
  if (STUN_MECHANICS.has(mech)) return "stunned";
  if (FEAR_MECHANICS.has(mech)) return "feared";
  if (CONFUSE_MECHANICS.has(mech)) return "confused";
  return null;
}

/** Spells whose aura grants immunity to `mech` (explicitly or to every
 * school) — the candidates for "the target could break or ignore it". */
export function spellsBlockingMechanic(mech: number): string[] {
  const out: string[] = [];
  for (const [id, e] of Object.entries(SPELLS))
    if (e && (e.immuneAll || e.immuneMech?.includes(mech))) out.push(id);
  return out;
}
