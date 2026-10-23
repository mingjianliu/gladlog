/**
 * A unit's commands to its pet — the owner's presses a summon carried out
 * (fact2 R2, 2026-10-20; moved here from context/ccUse.ts on 2026-10-22 so
 * the avoidance sweep and the kick audit read the same relation — fact4
 * D8: a Command Demon press and the Sayaad's own Seduction printed two
 * `[CC AVOIDED?]` lines for one attempt).
 */
import type { AtomicArenaCombat, ICombatUnit } from "@gladlog/parser-compat";

import { getEnglishSpellName } from "../data/spellEffectData";

/** How far apart an owner's press and the row of the summon that carried it
 * out can be logged (Command Demon: the Sayaad's own Seduction bar starts
 * 1 ms before the warlock's 119909 row, d2ebcb94 0:47.938 / 0:47.939). */
export const PET_COMMAND_MS = 500;

/**
 * fact2 R2 (2026-10-20): the owner's presses a summon of the owner carried
 * out — the owner's START / SUCCESS row of a spell, and within
 * `PET_COMMAND_MS` a START or SUCCESS of a same-named spell by one of the
 * owner's pets (`ownerId`, a `Pet-` GUID). The press is a command (Command Demon:
 * Seduction 119909 → the Sayaad's 6358; Axe Toss, Spell Lock, Singe Magic
 * share the shape): the control is the summon's, its bar and its success.
 * d2ebcb94: `Seduction cast 9×` counted the warlock's nine command rows;
 * the Sayaad began four bars and two went off.
 */
export function petCommands(
  owner: ICombatUnit,
  combat: Pick<AtomicArenaCombat, never> & {
    units?: Record<string, unknown> | ReadonlyArray<unknown>;
  },
): {
  /** the owner's command rows, by timestamp ms + id */
  commandRows: Set<string>;
  /** the summons' rows that carried a command out */
  summons: ICombatUnit[];
  petRow: (u: ICombatUnit, ms: number, name: string) => boolean;
} {
  // a PET (`Pet-` GUID) carries out a command; a totem or guardian logging
  // its summoning spell's name (Capacitor Totem) is the owner's press itself
  const summons = (
    Object.values(combat.units ?? {}) as ICombatUnit[]
  ).filter(
    (u) => u.ownerId === owner.id && u.id.startsWith("Pet-"),
  );
  const petRows = summons.flatMap((u) =>
    [...(u.castStartEvents ?? []), ...(u.spellCastEvents ?? [])]
      .filter(
        (e) =>
          e.logLine.event === "SPELL_CAST_START" ||
          e.logLine.event === "SPELL_CAST_SUCCESS",
      )
      .map((e) => ({
        u,
        ms: e.logLine.timestamp,
        name: getEnglishSpellName(e.spellId ?? "", e.spellName),
      })),
  );
  const ownerRows = [
    ...(owner.castStartEvents ?? []),
    ...(owner.spellCastEvents ?? []),
  ];
  // the commanded SPELLS: an owner spell a pet logged the same-named spell
  // next to at least once this round — every row of it is then a command
  // (a press the pet could not start for line of sight still is one:
  // d2ebcb94 0:50.310, 572 ms from the pet's last bar)
  const commandIds = new Set<string>();
  const commandNames = new Set<string>();
  for (const e of ownerRows) {
    if (!e.spellId) continue;
    const name = getEnglishSpellName(e.spellId, e.spellName);
    if (
      petRows.some(
        (r) =>
          r.name === name &&
          Math.abs(r.ms - e.logLine.timestamp) <= PET_COMMAND_MS,
      )
    ) {
      commandIds.add(e.spellId);
      commandNames.add(name);
    }
  }
  const commandRows = new Set<string>(
    ownerRows
      .filter((e) => !!e.spellId && commandIds.has(e.spellId))
      .map((e) => `${e.logLine.timestamp}|${e.spellId}`),
  );
  return {
    commandRows,
    summons,
    // a pet's row of a commanded spell is the owner's control
    petRow: (_u, _ms, name) => commandNames.has(name),
  };
}

