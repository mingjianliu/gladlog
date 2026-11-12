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
