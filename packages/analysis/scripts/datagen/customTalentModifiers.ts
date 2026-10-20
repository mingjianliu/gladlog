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
  // because that is the common one. The ledger then prices EVERY press per
  // cast (`guardianSpiritCastCooldownSeconds` → ICooldownCast.cooldownSecondsOverride):
  // saved → the official 180; expired → this 60 counted from the buff's END
  // (less a measured 1 s logging lag), not from the press — reliability audit
  // C4, 2026-09-25, where "60 from the press" read the spell ready 11 s early.
  // Per cast because `isConditional` has never been read at runtime (applyCdModifiers
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
  // Nature's Swiftness 132158 + Call of Ohn'ahra 1246126 had a hand −30 here
  // (2026-09-11, corpus split on 700 S2 logs: with the talent p05 63.1 s, without
  // p05 47.4 s). It is gone: DB2 carries the penalty itself on row 1247559
  // (already −30 at 12.1.0.69587, where the identical hand row hid it), and the
  // 2026-09-22 hotfix ("increases the cooldown of Nature's Swiftness by 60 sec
  // (was 30 sec)") reached 12.1.5.70391 as −60. Keeping the hand row would have
  // stacked −30 on top of DB2's −60. A log from before the hotfix gets −30
  // (`DATED_COOLDOWN_VALUES`, src/utils/talentModifiers.ts).
  //
  // Convoke the Spirits 391528 ← Cenarius' Guidance 393371 (Restoration),
  // GH #154. The tooltip's "cooldown is reduced by 50%" is $393374s4 / 120 s:
  // effect 3 of 393374 is a dummy aura (4), −60 000 ms, no class mask — a
  // server script the mask reader cannot see, while Feral's and Balance's
  // −50 % (393414 / 393991) are masked rows and already generated. Corpus,
  // ledgerImpossibleCastScan, 2,000 new-season files + 240 downloaded:
  // Restoration holders' Convoke recasts on the modelled 120 s come back
  // from 45.0 s on (36 presses under it), 60 − 15 with Control of the Dream.
  "391528": [
    {
      talentSpellId: "393371", // Cenarius' Guidance
      effect: "reduce_cd",
      value: 60,
    },
  ],

  // --- Mage ---
  // Ice Block 45438 ← Ice Cold 414658 (`pressedAs`: Ice Cold's presses are Ice
  // Block's). Up to 12.1.0 the node carried the passive 414659, whose aura-332
  // override row (1083954, 414659 → 414658) the generator read as this
  // replace_spell. 12.1.5.70391 puts the button 414658 on the node itself and
  // states the relation only as TraitDefinition.OverridesSpellID (414658
  // overrides 45438), which the aura-332 reader does not see — so the official
  // relation is carried here, keyed on the talent id the node now holds.
  "45438": [
    {
      talentSpellId: "414658", // Ice Cold (talent node spell since 12.1.5)
      effect: "replace_spell",
      value: 414658,
    },
  ],

  // Incarnation: Avatar of Ashamane ← Ashamane's Guidance (GH #106,
  // 2026-09-24). The talent 391548 is a script dummy (effect 3); the SpellMod
  // lives on the aura it applies, 1244546 (row 1245410: aura 107, SPELLMOD
  // cooldown, −30000 ms, PvpMultiplier 1), which no trigger edge reaches, so
  // the generator never sees it. Corpus (S2 archive every 30th file): 87
  // Feral recast gaps sit at the talent-resolved model minus 30.0 s (min
  // −30.2, p2 −30.0, p10 −29.0), 93 % of them below the old model.
  "102543": [
    {
      talentSpellId: "391548", // Ashamane's Guidance
      effect: "reduce_cd",
      value: 30,
    },
  ],
};
