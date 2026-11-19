/**
 * Is a (target aura, talent) duration modifier already priced by the
 * product? One answer for the tools that list what is NOT —
 * `durationCandidatesFromInventory.ts` (what the season scan is offered) and
 * `talentCoverageDoc.ts` §4 (what the gaps doc prints). T76: both read only
 * the two hand tables of spellEffectData.ts, so the pairs priced from the
 * tooltip tables (Havoc under Improved Havoc, Power Surge under Energy
 * Conservation, …) were still offered and still listed as gaps.
 */
import {
  BUFF_DURATION_TALENT_MODIFIERS,
  CC_DURATION_TALENT_MODIFIERS,
} from "@gladlog/analysis/src/data/spellEffectData";
import {
  TOOLTIP_DURATION_ROWS,
  TOOLTIP_PER_EVENT_DURATIONS,
} from "@gladlog/analysis/src/data/talentDurationTooltips";

/** The product tables that price a talent's effect on an aura's duration. */
export function durationPairCarriedBy(
  target: string,
  talent: string,
): "hand" | "tooltip" | "per-event" | undefined {
  if (
    [
      ...(BUFF_DURATION_TALENT_MODIFIERS[target] ?? []),
      ...(CC_DURATION_TALENT_MODIFIERS[target] ?? []),
    ].some((m) => m.talentSpellId === talent)
  )
    return "hand";
  if (
    (TOOLTIP_DURATION_ROWS[target] ?? []).some(
      (r) => r.talentSpellId === talent,
    )
  )
    return "tooltip";
  if (TOOLTIP_PER_EVENT_DURATIONS[target]?.talentSpellId === talent)
    return "per-event";
  return undefined;
}

/** The first aura whose duration the product prices under `talent`
 * (`durationPairCarriedBy` over every aura a duration table names), or
 * `undefined`. For a tool that has the talent and not the aura — the talent
 * audit's join, which walked the four tables itself until T208 (GH #218
 * 10.8) and would have missed a table added to the predicate above. */
export function durationAuraCarryingTalent(talent: string): string | undefined {
  const auras = new Set([
    ...Object.keys(BUFF_DURATION_TALENT_MODIFIERS),
    ...Object.keys(CC_DURATION_TALENT_MODIFIERS),
    ...Object.keys(TOOLTIP_DURATION_ROWS),
    ...Object.keys(TOOLTIP_PER_EVENT_DURATIONS),
  ]);
  for (const aura of auras)
    if (durationPairCarriedBy(aura, talent) !== undefined) return aura;
  return undefined;
}

/** A CC entry written on DB2 + tooltip alone, still waiting for its first
 * holders: priced, but kept in front of the season scan. */
export function durationPairCorpusPending(
  target: string,
  talent: string,
): boolean {
  return (CC_DURATION_TALENT_MODIFIERS[target] ?? []).some(
    (m) => m.talentSpellId === talent && m.corpusPending !== undefined,
  );
}
