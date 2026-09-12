import type { ICDModifier } from "../../src/utils/talentModifiers";

/**
 * Manual talent-to-spell modifications that cannot be automatically extracted from DB2.
 * These are often "SPELL_AURA_DUMMY" effects that require server-side script logic.
 *
 * Map: baseSpellId -> list of ICDModifier
 */
export const CUSTOM_TALENT_MODIFIERS: Record<string, ICDModifier[]> = {
  // --- Priest ---
  // Guardian Spirit (base 180s). Guardian Angel is OUTCOME-CONDITIONAL: the
  // press that expires without saving anyone comes back fast, the press that
  // actually prevented a death does not. The value below is the fast branch,
  // because that is the common one; the slow branch is restored per cast by
  // the ledger (`guardianSpiritSaved` → ICooldownCast.cooldownSecondsOverride),
  // since `isConditional` has never been read at runtime (applyCdModifiers
  // ignores the field) and a scalar cannot express "depends what happened".
  //
  // Why 120 and not the old 60 (i.e. 60s effective, not 120s): measured on 600
  // S2 archive logs, ROUND-SEGMENTED (Solo Shuffle resets cooldowns every
  // round, so cross-round gaps say nothing), 1,166 Guardian Spirit presses ->
  // 496 within-round repeat intervals with no save in between:
  //   · 91.7% are shorter than the old 120s model — i.e. the ledger called the
  //     spell unavailable at moments the priest demonstrably had it;
  //   · only 0.2% (1 of 496) are shorter than 60s;
  //   · the mode sits at 60-90s (353 of 496).
  // The saved branch could not be measured (n=2 within-round repeats after a
  // save), so it keeps the untouched official 180s — the conservative
  // direction: too long only ever costs us a finding, too short manufactures
  // one (cd-hoarded cites Guardian Spirit).
  "47788": [
    {
      talentSpellId: "200209", // Guardian Angel (Talent)
      effect: "reduce_cd",
      value: 120,
      isConditional: true, // slow branch restored per cast, see above
    },
  ],

  // --- Druid ---
  // Nature's Swiftness + Call of Ohn'ahra (PvP talent): "Nature's Swiftness now
  // also affects Cyclone, but its cooldown is increased by 30 sec" (A-tier
  // tooltip). A cooldown INCREASE is a negative reduction — `applyCdModifiers`
  // computes `base - flatReduce`, so -30 adds 30s.
  //
  // Hand entry because DB2 does not carry it: the 2026-09-11 PvP-pool pass mines
  // the Shaman's identical talent (Ancestral Swiftness/Nature's Swiftness 378081
  // <- Call of Al'Akir 1246131, reduce_cd -30) but nothing for the Druid's, so
  // this one is server-side script. Corpus split instead (700 S2 logs,
  // round-segmented, grouped by whether COMBATANT_INFO's pvpTalents holds
  // 1246126):
  //   · with Call of Ohn'ahra    — 75 casters, 186 repeat intervals, p05 63.1s,
  //     p25 73.5s, and only 1.1% under 60s;
  //   · without it               — 26 casters, 42 intervals, p05 47.4s,
  //     p25 56.3s, 36% under 60s.
  // The arithmetic closes: base 60 − Passing Seasons 15 = 45 (floor observed
  // 32–47, Control of the Dream shaves up to 15 more), +30 → 75, floor 60 with
  // the same Control of the Dream (observed 63.1 at p05). Direction is the safe
  // one — a longer modelled cooldown can only cost a finding, never invent one.
  "132158": [
    {
      talentSpellId: "1246126", // Call of Ohn'ahra (PvP talent SpellID)
      effect: "reduce_cd",
      value: -30,
    },
  ],
};
