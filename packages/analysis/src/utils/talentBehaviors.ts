/**
 * B139 — Healer PvP-talent behavioral catalog.
 *
 * Curated from official tooltips (Wowhead game-data endpoint + Icy Veins per-spec PvP pages), NOT inferred
 * from logs. Each entry maps a PvP talent to the concrete aura/condition the analysis keys on, so the
 * pipeline reads talent-modified play correctly (credit avoidances, suppress impossible interrupts).
 *
 * Discipline (the B144 lesson): only well-understood talents belong here — a wrong entry mislabels an
 * avoidance. Every entry's aura id was verified against a real corpus log.
 *
 * Seasonal maintenance: talent/aura ids drift each patch — re-verify against a current log alongside
 * CC_AVOIDANCE_BUFF_SPELLS and CD_TALENT_MODIFIERS.
 */

export type TalentEffectKind =
  /** while buffSpellId is active, immune to magic damage/effects → credit a magic CC/damage avoidance */
  | 'magic_immunity'
  /** while buffSpellId is active, immune to (the next) full CC → credit a CC avoidance */
  | 'cc_immunity'
  /** while conditionAuraId (a normal CD) is active, immune to interrupt/silence → suppress "interrupts UP" */
  | 'interrupt_immunity'
  /** an offensive CC / peel tool the talent grants (surfaced in the toolkit for usage coaching) */
  | 'offensive_cc'
  /** a dispel/purge-capability the talent grants (surfaced in the toolkit) */
  | 'dispel'
  /** a snare/root avoidance the talent grants (surfaced in the toolkit) */
  | 'snare_immunity';

/** Broad grouping for the PvP-toolkit render. */
export type TalentToolCategory = 'immunity' | 'cc' | 'dispel' | 'mobility';

export interface ITalentBehavior {
  /** the pvpTalents id as it appears in COMBATANT_INFO param 26 */
  talentSpellId: string;
  name: string;
  specs: string[];
  kind: TalentEffectKind;
  /**
   * For magic_immunity / cc_immunity: the buff aura whose active window IS the immunity. Self-gating —
   * the aura only exists when the talent is taken, so no pvpTalents lookup is needed downstream.
   */
  buffSpellId?: string;
  /**
   * For interrupt_immunity: the CD aura that must be active for the immunity to apply. The talent itself is
   * a passive with no marker aura and the condition (e.g. Obsidian Scales) exists WITHOUT the talent, so
   * this MUST be gated on the owner's pvpTalents containing talentSpellId.
   */
  conditionAuraId?: string;
  /** Display name of the condition CD (e.g. "Obsidian Scales") for the interrupt-immune render reason. */
  conditionName?: string;
  /**
   * Short label shown in the owner's <pvp_toolkit> loadout line, e.g. "Lightning Lasso (5s stun)". Present
   * for every talent worth surfacing to the coach as an available tool.
   */
  toolLabel?: string;
  /** Toolkit grouping for the loadout render. */
  toolCategory?: TalentToolCategory;
  /**
   * The castable ability this talent grants/modifies, if any. Used to mark a tool UNUSED when the owner
   * never cast it in the match (peel/usage coaching). Omit for always-on/reactive tools.
   */
  abilitySpellId?: string;
  note?: string;
}

export const TALENT_BEHAVIORS: ITalentBehavior[] = [
  // A. Magic immunity — self-gating buff aura
  {
    talentSpellId: '353313',
    name: 'Peaceweaver',
    specs: ['Mistweaver Monk'],
    kind: 'magic_immunity',
    buffSpellId: '353319',
    toolLabel: 'Peaceweaver (Revival/Restoral → 2s team magic immunity)',
    toolCategory: 'immunity',
    note: 'Revival/Restoral grants healed allies immunity to magic damage & harmful effects ~2s (proc 353319)',
  },
  {
    talentSpellId: '204018',
    name: 'Blessing of Spellwarding',
    specs: ['Holy Paladin'],
    kind: 'magic_immunity',
    buffSpellId: '204018',
    toolLabel: 'Blessing of Spellwarding (ally magic immunity)',
    toolCategory: 'immunity',
    note: 'ally magic immunity; the buff shares the talent id',
  },
  // B. Full CC immunity / untargetable — self-gating buff aura
  {
    talentSpellId: '408557',
    name: 'Phase Shift',
    specs: ['Discipline Priest', 'Holy Priest'],
    kind: 'cc_immunity',
    buffSpellId: '408558',
    toolLabel: 'Phase Shift (Fade → ~1s untargetable / CC dodge)',
    toolCategory: 'immunity',
    note: 'Fade phases the priest out (untargetable ~1s)',
  },
  {
    talentSpellId: '1241352',
    name: 'Nullifying Shroud',
    specs: ['Preservation Evoker'],
    kind: 'cc_immunity',
    buffSpellId: '378464',
    toolLabel: 'Nullifying Shroud (Verdant Embrace → next-CC immunity 3s)',
    toolCategory: 'immunity',
    note: 'Verdant Embrace prevents the next full loss-of-control, 3s',
  },
  {
    talentSpellId: '1246968',
    name: 'Psychic Shroud',
    specs: ['Holy Priest', 'Discipline Priest'],
    kind: 'cc_immunity',
    buffSpellId: '1246965',
    toolLabel: 'Psychic Shroud (Psychic Scream → next-CC immunity)',
    toolCategory: 'immunity',
    note: 'Psychic Scream prevents the next CC on you',
  },
  // C. Interrupt / silence immunity — condition-gated passive (MUST check pvpTalents)
  {
    talentSpellId: '378444',
    name: 'Obsidian Mettle',
    specs: ['Preservation Evoker'],
    kind: 'interrupt_immunity',
    conditionAuraId: '363916',
    conditionName: 'Obsidian Scales',
    toolLabel: 'Obsidian Mettle (interrupt/silence immunity while Obsidian Scales up)',
    toolCategory: 'immunity',
    note: 'immune to interrupt/silence/pushback while Obsidian Scales is active',
  },
  {
    talentSpellId: '468430',
    name: 'Zen Focus Tea',
    specs: ['Mistweaver Monk'],
    kind: 'interrupt_immunity',
    conditionAuraId: '116680',
    conditionName: 'Thunder Focus Tea',
    toolLabel: 'Zen Focus Tea (interrupt/silence immunity while Thunder Focus Tea up)',
    toolCategory: 'immunity',
    note: 'immune to silence/interrupt while Thunder Focus Tea is active (5s)',
  },
  {
    talentSpellId: '210294',
    name: 'Divine Favor',
    specs: ['Holy Paladin'],
    kind: 'interrupt_immunity',
    conditionAuraId: '210294',
    conditionName: 'Divine Favor',
    toolLabel: 'Divine Favor (interrupt/silence immunity on next heal)',
    toolCategory: 'immunity',
    note: 'next cast is immune to interrupt/silence',
  },
  {
    talentSpellId: '210303',
    name: 'Divine Favor',
    specs: ['Holy Paladin'],
    kind: 'interrupt_immunity',
    conditionAuraId: '210294',
    conditionName: 'Divine Favor',
    toolLabel: 'Divine Favor (interrupt/silence immunity on next heal)',
    toolCategory: 'immunity',
    note: 'next cast is immune to interrupt/silence',
  },
  {
    talentSpellId: '460422',
    name: 'Divine Favor',
    specs: ['Holy Paladin'],
    kind: 'interrupt_immunity',
    conditionAuraId: '460422',
    conditionName: 'Divine Favor',
    toolLabel: 'Divine Favor (interrupt/silence/pushback immunity on next heal)',
    toolCategory: 'immunity',
    note: 'next cast is immune to interrupt/silence',
  },
  {
    talentSpellId: '1270916',
    name: 'Divine Favor',
    specs: ['Holy Paladin'],
    kind: 'interrupt_immunity',
    conditionAuraId: '1270916',
    conditionName: 'Divine Favor',
    toolLabel: 'Divine Favor (interrupt/silence immunity on next heal)',
    toolCategory: 'immunity',
    note: 'next cast is immune to interrupt/silence',
  },
  {
    talentSpellId: '355584',
    name: "Spiritwalker's Aegis",
    specs: ['Restoration Shaman'],
    kind: 'interrupt_immunity',
    conditionAuraId: '131558',
    conditionName: "Spiritwalker's Aegis",
    toolLabel: "Spiritwalker's Aegis (interrupt/silence immunity during Spiritwalker's Grace)",
    toolCategory: 'immunity',
    note: "immune to silence/interrupt while Spiritwalker's Aegis is active",
  },
  {
    talentSpellId: '131558',
    name: "Spiritwalker's Aegis",
    specs: ['Restoration Shaman'],
    kind: 'interrupt_immunity',
    conditionAuraId: '131558',
    conditionName: "Spiritwalker's Aegis",
    toolLabel: "Spiritwalker's Aegis (interrupt/silence immunity during Spiritwalker's Grace)",
    toolCategory: 'immunity',
    note: "immune to silence/interrupt while Spiritwalker's Aegis is active",
  },

  // D. Offensive CC / peel tools — surfaced in the toolkit; usage checked via abilitySpellId
  {
    talentSpellId: '204336',
    name: 'Grounding Totem',
    specs: ['Restoration Shaman'],
    kind: 'offensive_cc',
    abilitySpellId: '204336',
    toolLabel: 'Grounding Totem (redirect a targeted harmful spell/CC)',
    toolCategory: 'cc',
    note: 'redirects the first single-target harmful spell to the totem',
  },
  {
    talentSpellId: '305483',
    name: 'Lightning Lasso',
    specs: ['Restoration Shaman'],
    kind: 'offensive_cc',
    abilitySpellId: '305483',
    toolLabel: 'Lightning Lasso (channeled 5s stun)',
    toolCategory: 'cc',
    note: 'non-dispellable channeled stun',
  },
  {
    talentSpellId: '355580',
    name: 'Static Field Totem',
    specs: ['Restoration Shaman'],
    kind: 'offensive_cc',
    abilitySpellId: '355580',
    toolLabel: 'Static Field Totem (impassable electric wall)',
    toolCategory: 'cc',
    note: 'summons a wall enemies cannot pass',
  },
  {
    talentSpellId: '410126',
    name: 'Searing Glare',
    specs: ['Holy Paladin'],
    kind: 'offensive_cc',
    abilitySpellId: '410126',
    toolLabel: 'Searing Glare (AoE blind, enemies miss 4s)',
    toolCategory: 'cc',
    note: 'cone disorient — enemies miss spells and attacks',
  },
  {
    talentSpellId: '1246126',
    name: "Call of Ohn'ahra",
    specs: ['Restoration Druid'],
    kind: 'offensive_cc',
    abilitySpellId: '33786',
    toolLabel: "Call of Ohn'ahra (Nature's Swiftness → instant Cyclone)",
    toolCategory: 'cc',
    note: "Nature's Swiftness also affects Cyclone (instant CC)",
  },

  // E. Dispel / purge capability — surfaced in the toolkit
  {
    talentSpellId: '378438',
    name: 'Scouring Flame',
    specs: ['Preservation Evoker'],
    kind: 'dispel',
    abilitySpellId: '357208', // Fire Breath
    toolLabel: 'Scouring Flame (Fire Breath offensive-purges 2 magic buffs)',
    toolCategory: 'dispel',
    note: 'Fire Breath burns away beneficial magic effects — an Evoker offensive purge',
  },
  {
    talentSpellId: '199330',
    name: 'Cleanse the Weak',
    specs: ['Holy Paladin'],
    kind: 'dispel',
    toolLabel: 'Cleanse the Weak (Cleanse hits 2 allies; FoL/HoL cleanse Disease/Poison)',
    toolCategory: 'dispel',
    note: 'extra dispel target + Flash/Holy Light passively cleanse Disease & Poison',
  },

  // F. Snare / root avoidance — surfaced in the toolkit
  {
    talentSpellId: '409293',
    name: 'Burrow',
    specs: ['Restoration Shaman'],
    kind: 'cc_immunity',
    buffSpellId: '409293',
    abilitySpellId: '409293',
    toolLabel: 'Burrow (unattackable + clears snares, 5s)',
    toolCategory: 'immunity',
    note: 'unattackable defensive that removes movement-impairing effects',
  },
];

/**
 * Talent-granted CC-avoidance buff auras (id → display name). These are self-gating (the buff only exists
 * when the talent is taken), so callers can merge them into the static avoidance set unconditionally.
 */
export function getTalentAvoidanceBuffs(): Array<[string, string]> {
  return TALENT_BEHAVIORS.filter((b) => (b.kind === 'magic_immunity' || b.kind === 'cc_immunity') && b.buffSpellId).map(
    (b) => [b.buffSpellId as string, b.name],
  );
}

/**
 * The interrupt/silence-immunity conditions the owner's talents grant: while any returned conditionAuraId
 * is active on the owner, they are interrupt-immune. Gated on the owner's pvpTalents.
 */
export function getInterruptImmunityConditions(
  pvpTalentIds: string[] | undefined,
): Array<{ conditionAuraId: string; name: string; conditionName: string }> {
  const talents = new Set(pvpTalentIds ?? []);
  return TALENT_BEHAVIORS.filter(
    (b) => b.kind === 'interrupt_immunity' && b.conditionAuraId && talents.has(b.talentSpellId),
  ).map((b) => ({
    conditionAuraId: b.conditionAuraId as string,
    name: b.name,
    conditionName: b.conditionName ?? '',
  }));
}

/** PvP talents that grant an OFFENSIVE purge (dispelling beneficial effects from ENEMIES). */
const OFFENSIVE_PURGE_TALENT_IDS = new Set([
  '378438', // Scouring Flame — Preservation Evoker's Fire Breath burns away enemy magic buffs
]);

/**
 * True when the owner's PvP talents grant an offensive purge they would not otherwise have. Used to gate
 * [MISSED PURGE] for specs with no baseline offensive purge (Preservation Evoker — Naturalize is a
 * defensive ally-dispel, so the only offensive purge is Scouring Flame).
 */
export function hasOffensivePurgeTalent(pvpTalentIds: string[] | undefined): boolean {
  return (pvpTalentIds ?? []).some((id) => OFFENSIVE_PURGE_TALENT_IDS.has(id));
}

/**
 * The owner's talent-granted PvP toolkit for the loadout render: every talent with a toolLabel that the
 * owner has taken. `used` is true/false for tools that grant a castable ability (abilitySpellId) — false
 * means the owner never cast it in the match (peel/usage coaching) — and undefined for always-on/reactive
 * tools where "unused" is not meaningful.
 */
export function getPvpToolkit(
  pvpTalentIds: string[] | undefined,
  ownerCastSpellIds: Set<string>,
): Array<{ label: string; category: TalentToolCategory; used: boolean | undefined }> {
  const talents = new Set(pvpTalentIds ?? []);
  return TALENT_BEHAVIORS.filter((b) => b.toolLabel && talents.has(b.talentSpellId)).map((b) => ({
    label: b.toolLabel as string,
    category: b.toolCategory ?? 'immunity',
    used: b.abilitySpellId ? ownerCastSpellIds.has(b.abilitySpellId) : undefined,
  }));
}
