import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { MITIGATION_TABLE } from "../data/mitigationData";
import { getEnglishSpellName } from "../data/spellEffectData";

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

/** "an ally's 15% copy of Obsidian Scales" — the talent-shared walls' ally
 * copies, named off the table for a legend (read at call time: the spell
 * names load after this module). */
export function allyCopyLegendPhrase(): string {
  return Object.entries(MITIGATION_TABLE)
    .filter(([id]) => isAllyCopyWallId(id))
    .map(
      ([id, row]) =>
        `an ally's ${row.pctOnOthers}% copy of ${getEnglishSpellName(id, id)}`,
    )
    .join(", ");
}

/** The ally's copy is applied in the same instant as the cast (2026-09-12
 * corpus note on the 363916 row: SPELL_CAST_SUCCESS with the ally as dest,
 * APPLIED on the caster and on the ally at the same ms). 0.5 s covers log
 * jitter without reaching a second press. */
export const ALLY_COPY_PAIR_MS = 500;

/**
 * F15 / fact1215 C1 (2026-10-16): the ally a press of a talent-shared wall
 * put its copy on — read from the log, never from the talent: a unit other
 * than the caster carries an APPLIED / REFRESH of the same spell from this
 * caster within `ALLY_COPY_PAIR_MS` of the cast. Undefined for a press that
 * stayed on the caster: without Lifecinders the cast line still names the
 * caster's current target as dest (B112 / B127) and nothing lands there.
 *
 * fact2 C1 (2026-10-20): the copy is looked for on every unit, not only on
 * the cast's dest. The dest is whatever the caster had targeted: 42 of the
 * 50 presses with the caster as dest in the 30 fact2 logs put a copy on an
 * ally, and 18 of 433 aimed at one ally (or at an ENEMY — 691a7f31 2:21,
 * aimed at the enemy Diiscmo, copy on Dtn) put it on another. When two units
 * carry one, the cast's dest wins, else the closest in time.
 *
 * The one "did this press reach an ally" fact for the friendly ledger
 * (`ICooldownCast.allyCopyOn` → `[YOU] [CD]`, `[TEAM] [CD]`, cd-hoarded's
 * answered sets), the healer cast-gap promotion and the enemy side's
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
  units: Iterable<ICombatUnit>,
): ICombatUnit | undefined {
  const spellId = cast.spellId;
  if (!spellId || !isAllyCopyWallId(spellId)) return undefined;
  const t = cast.logLine.timestamp;
  let best: { unit: ICombatUnit; gap: number } | undefined;
  for (const unit of units) {
    if (unit.id === casterId) continue;
    for (const a of unit.auraEvents ?? []) {
      if (
        a.spellId !== spellId ||
        a.srcUnitId !== casterId ||
        a.destUnitId !== unit.id ||
        (a.logLine.event !== LogEvent.SPELL_AURA_APPLIED &&
          a.logLine.event !== LogEvent.SPELL_AURA_REFRESH)
      )
        continue;
      const gap = Math.abs(a.logLine.timestamp - t);
      if (gap > ALLY_COPY_PAIR_MS) continue;
      // the cast's dest first, then the closest copy
      const rank = unit.id === cast.destUnitId ? -1 : gap;
      if (!best || rank < best.gap) best = { unit, gap: rank };
    }
  }
  return best?.unit;
}
