import { getInterruptImmunityConditions, getPvpToolkit, getTalentAvoidanceBuffs } from '../../src/utils/talentBehaviors';

describe('talentBehaviors — getTalentAvoidanceBuffs', () => {
  it('exposes the self-gating magic/cc-immunity buff auras (Peaceweaver, Phase Shift, …)', () => {
    const buffs = new Map(getTalentAvoidanceBuffs());
    expect(buffs.get('353319')).toBe('Peaceweaver');
    expect(buffs.get('408558')).toBe('Phase Shift');
    expect(buffs.get('378464')).toBe('Nullifying Shroud');
    expect(buffs.get('204018')).toBe('Blessing of Spellwarding');
  });

  it('does not expose interrupt-immunity or toolkit-only talents as avoidance buffs', () => {
    const buffs = new Map(getTalentAvoidanceBuffs());
    // Obsidian Mettle / Zen Focus Tea are condition-gated interrupt immunity, not avoidance buffs
    expect(buffs.has('363916')).toBe(false);
    expect(buffs.has('116680')).toBe(false);
    // Lightning Lasso is an offensive-CC toolkit entry, not an avoidance buff
    expect(buffs.has('305483')).toBe(false);
  });
});

describe('talentBehaviors — getInterruptImmunityConditions', () => {
  it('returns the condition only when the owner has the talent (self-gating passives)', () => {
    const withMettle = getInterruptImmunityConditions(['378444']);
    expect(withMettle).toHaveLength(1);
    expect(withMettle[0].conditionAuraId).toBe('363916');
    expect(withMettle[0].name).toBe('Obsidian Mettle');
    expect(withMettle[0].conditionName).toBe('Obsidian Scales');

    const withDivineFavor = getInterruptImmunityConditions(['210294']);
    expect(withDivineFavor).toHaveLength(1);
    expect(withDivineFavor[0].conditionAuraId).toBe('210294');
    expect(withDivineFavor[0].name).toBe('Divine Favor');

    const withAegis = getInterruptImmunityConditions(['131558']);
    expect(withAegis).toHaveLength(1);
    expect(withAegis[0].conditionAuraId).toBe('131558');
    expect(withAegis[0].name).toBe("Spiritwalker's Aegis");
  });

  it('returns nothing when the owner lacks the talent', () => {
    expect(getInterruptImmunityConditions(['999999'])).toHaveLength(0);
    expect(getInterruptImmunityConditions(undefined)).toHaveLength(0);
  });
});

describe('talentBehaviors — getPvpToolkit', () => {
  it('lists the owner talent-granted tools and marks a castable one UNUSED when never cast', () => {
    // Owner has Lightning Lasso (offensive CC, castable) + Peaceweaver (reactive immunity)
    const toolkit = getPvpToolkit(['305483', '353313'], new Set());
    const lasso = toolkit.find((t) => t.label.includes('Lightning Lasso'));
    const peace = toolkit.find((t) => t.label.includes('Peaceweaver'));
    expect(lasso?.used).toBe(false); // castable but never cast → UNUSED
    expect(peace?.used).toBeUndefined(); // reactive immunity, no usage check
  });

  it('marks a castable tool used when the owner cast its ability', () => {
    const toolkit = getPvpToolkit(['305483'], new Set(['305483']));
    expect(toolkit.find((t) => t.label.includes('Lightning Lasso'))?.used).toBe(true);
  });

  it('returns nothing for a talentless owner', () => {
    expect(getPvpToolkit(undefined, new Set())).toHaveLength(0);
  });
});
