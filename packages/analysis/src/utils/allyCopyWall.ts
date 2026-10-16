import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { MITIGATION_TABLE } from "../data/mitigationData";

/**
 * A talent-shared wall: one press puts the aura on the caster AND on the ally
 * the press was cast at — the `MITIGATION_TABLE` rows that declare
 * `pctOnOthers` (Flameshaper Obsidian Scales 363916 through Lifecinders
 * 444322: 15 % on the ally, 30 % on the caster). Data-driven, so a second
 * such row joins every reader below without a code change.
 */
export function isAllyCopyWallId(spellId: string): boolean {
  return MITIGATION_TABLE[spellId]?.pctOnOthers !== undefined;
}

/** The ally's copy is applied in the same instant as the cast (2026-09-12
 * corpus note on the 363916 row: SPELL_CAST_SUCCESS with the ally as dest,
 * APPLIED on the caster and on the ally at the same ms). 0.5 s covers log
 * jitter without reaching a second press. */
export const ALLY_COPY_PAIR_MS = 500;

/**
 * F15 / fact1215 C1 (2026-10-16): the ally a press of a talent-shared wall
 * put its copy on — read from the log, never from the talent: the cast's dest
 * unit carries an APPLIED / REFRESH of the same spell from this caster within
 * `ALLY_COPY_PAIR_MS` of the cast. Undefined for a press that stayed on the
 * caster: without Lifecinders the cast line still names the caster's current
 * target as dest (B112 / B127) and nothing lands there.
 *
 * The one "did this press reach an ally" fact for the friendly ledger
 * (`ICooldownCast.allyCopyOn` → `[YOU] [CD]`, `[TEAM] [CD]`, cd-hoarded's
 * answered set), the healer cast-gap promotion and the enemy side's
 * `[ENEMY DEF]` external line. It answers what a press DID; whether a player
 * COULD have put it on an ally (cd-hoarded's ready set) still reads
 * `canHelpAnotherUnit`, which says no for 363916 — registered in
 * docs/predicate-index.md "Not yet unified".
 */
export function allyCopyRecipient(
  casterId: string,
  cast: {
    spellId?: string | null;
    destUnitId?: string | null;
    logLine: { timestamp: number };
  },
  unitById: (id: string) => ICombatUnit | undefined,
): ICombatUnit | undefined {
  const spellId = cast.spellId;
  if (!spellId || !isAllyCopyWallId(spellId)) return undefined;
  const destId = cast.destUnitId;
  if (!destId || destId === casterId) return undefined;
  const dest = unitById(destId);
  if (!dest) return undefined;
  const t = cast.logLine.timestamp;
  const landed = (dest.auraEvents ?? []).some(
    (a) =>
      a.spellId === spellId &&
      a.srcUnitId === casterId &&
      a.destUnitId === dest.id &&
      (a.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
        a.logLine.event === LogEvent.SPELL_AURA_REFRESH) &&
      Math.abs(a.logLine.timestamp - t) <= ALLY_COPY_PAIR_MS,
  );
  return landed ? dest : undefined;
}
