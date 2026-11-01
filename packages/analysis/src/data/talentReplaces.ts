import { TALENT_REPLACES_GENERATED } from "./talentReplacesGenerated";

/**
 * Class / hero talent → the spell ids it REPLACES for the player who took it
 * (the button no longer exists; the talent's own spell is what they press).
 *
 * Sibling of `PVP_TALENT_REPLACES` (generated from the official DB2
 * `PvpTalent.OverridesSpellID`). Class / hero talents have two official
 * encodings, both generated into `TALENT_REPLACES_GENERATED`
 * (`scripts/datagen/genTalentReplaces.ts`): `TraitDefinition.OverridesSpellID`
 * and an aura-332 row on a carrier named as the talent (Holy Armaments 1289728
 * over Divine Toll / Holy Prism, Ancestral Swiftness over Nature's Swiftness —
 * no DB2 edge reaches those carriers, a script applies them). A pair that
 * neither states lives here, by hand, with the sentence that proves it.
 *
 * Admission (reliability audit C1, 2026-09-26; codex astra review): a pair
 * enters only with (a) the official tooltip / DB2 sentence quoted in its
 * note and (b) the corpus nomination from
 * `packages/eval/scripts/talentReplaceScan.ts` (holders never cast the
 * replaced spell, non-holders do), and only after the two encodings above were
 * checked — "the tooltip is the only source" has been wrong once, for
 * Ancestral Swiftness. The scan's reverse check re-measures every
 * row each season (`docs/commands/update-wow-data.md` §7b). Never extended
 * from memory — a stale pair silently deletes a real button from the ledger.
 *
 * Consumers (one predicate, `replacedSpellIds`): `extractMajorCooldowns`
 * (every entry path: static catalog, dynamic discovery, healer save-roster
 * injection) and `talentOwnershipFromTables` ("no": the button no longer
 * exists). A cast of the replaced spell in the round overrides the table for
 * that player — evidence beats the hand row, the same rule W1g applied to
 * `SPEC_EXCLUSIVE_SPELLS`.
 *
 * Registered in `curatedIdRegistry.ts` (kind "mixed": talent ids as keys,
 * cast ids as values).
 */
/** Hand rows: replacements neither official encoding states. */
export const TALENT_REPLACES: Readonly<Record<string, readonly string[]>> = {
  // Incarnation: Chosen of Elune (Balance Druid; talent entry 394013, the
  // button and its cast are 102560 — the entry's VisibleSpellID) stands where
  // Celestial Alignment 194223 stood. Not in TraitDefinition.OverridesSpellID
  // (row 114844 has 0; Feral's twin 102543 → Berserk 106951 has it and is in
  // the generated table) and no tooltip sentence says "replaces". What DB2
  // does say (12.1.0.69587): the two buttons spend ONE charge category
  // (SpellCategories.ChargeCategory 2328, one charge, 180 s —
  // `SHARED_CHARGE_CATEGORY`), and Orbital Strike 390378's description names
  // its button as `$?s102560[Incarnation: Chosen of Elune][Celestial
  // Alignment]` — Incarnation for a druid who knows 102560, Celestial
  // Alignment otherwise (the conditional as the datagen cache's Spell table
  // has it; the two names stand there in zhCN). Corpus (605 archive files, 2026-10-13,
  // fix-FT/scripts/tic_scan.ts — talentReplaceScan cannot nominate a talent
  // with 2 non-holders, its reverse check does re-measure this row): 138
  // Balance player-rounds, every one holding Celestial Alignment's entry
  // 395022; the 136 who also hold 394013 never cast Celestial Alignment (131
  // pressed Incarnation), the 2 who do not both cast it. Entered together
  // with the button-grant reading (`getSpecTalentButtonGrants`), which proves
  // Celestial Alignment from 395022 and would have listed it `[UNUSED]`
  // beside every Incarnation. With this row an Incarnation holder's ledger
  // is what it was before both: no Celestial Alignment row unless it is cast.
  "394013": ["194223"],
};

/**
 * Every spell id the replacement tables remove from THIS player's kit:
 * class / hero talents through `TALENT_REPLACES` (hand) and
 * `TALENT_REPLACES_GENERATED` (official, `scripts/datagen/genTalentReplaces.ts`),
 * PvP talents through
 * `PVP_TALENT_REPLACES`. `talentedSpellIds === null` means the talents did
 * not decode — nothing is replaced on that evidence (never "holds nothing").
 */
export function replacedSpellIds(
  talentedSpellIds: ReadonlySet<string> | null,
  pvpTalentIds: ReadonlySet<string>,
  pvpTalentReplaces: Readonly<Record<string, readonly string[]>>,
): Set<string> {
  const out = new Set<string>();
  if (talentedSpellIds)
    for (const table of [TALENT_REPLACES, TALENT_REPLACES_GENERATED])
      for (const [talentId, replaced] of Object.entries(table))
        if (talentedSpellIds.has(talentId))
          for (const r of replaced) out.add(r);
  for (const [talentId, replaced] of Object.entries(pvpTalentReplaces))
    if (pvpTalentIds.has(talentId)) for (const r of replaced) out.add(r);
  return out;
}
