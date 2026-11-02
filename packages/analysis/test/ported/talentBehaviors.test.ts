import {
  getPvpToolkit,
  getTalentAvoidanceBuffs,
  TALENT_BEHAVIORS,
  unitAuraBlocksInterrupt,
} from "../../src/utils/talentBehaviors";

describe("talentBehaviors — getTalentAvoidanceBuffs", () => {
  it("exposes the self-gating magic/cc-immunity buff auras (Peaceweaver, Phase Shift, …)", () => {
    const buffs = new Map(getTalentAvoidanceBuffs());
    expect(buffs.get("353319")).toBe("Peaceweaver");
    expect(buffs.get("408558")).toBe("Phase Shift");
    expect(buffs.get("378464")).toBe("Nullifying Shroud");
    expect(buffs.get("204018")).toBe("Blessing of Spellwarding");
    // 12.1: Ancient of Lore returned as a Resto Druid PvP talent — the shapeshift
    // prevents all CC while active. pvpTalents id / cast id / self-buff aura id are
    // all 473909 (verified in corpus match 7d74b373, 2026-08-13).
    expect(buffs.get("473909")).toBe("Ancient of Lore");
  });

  it("does not expose interrupt-immunity or toolkit-only talents as avoidance buffs", () => {
    const buffs = new Map(getTalentAvoidanceBuffs());
    // Obsidian Mettle / Zen Focus Tea are condition-gated interrupt immunity, not avoidance buffs
    expect(buffs.has("363916")).toBe(false);
    expect(buffs.has("116680")).toBe(false);
    // Lightning Lasso is an offensive-CC toolkit entry, not an avoidance buff
    expect(buffs.has("305483")).toBe(false);
  });
});

describe("talentBehaviors — unitAuraBlocksInterrupt", () => {
  const withMettle = { info: { pvpTalents: ["378444"] } };
  const without = { info: { pvpTalents: [] } };

  it("Obsidian Scales stops a kick only with Obsidian Mettle, whatever DB2's row says", () => {
    expect(unitAuraBlocksInterrupt(withMettle, "363916")).toBe(true);
    expect(unitAuraBlocksInterrupt(without, "363916")).toBe(false);
    expect(unitAuraBlocksInterrupt({}, "363916")).toBe(false);
  });

  it("DB2's immunities need no talent row, the aura is the proof (tree talents included)", () => {
    for (const aura of [
      "209584", // Zen Focus Tea
      "378078", // Spiritwalker's Aegis, a tree talent
      "104773", // Unending Resolve
      "289655", // Sanctified Ground
      "317929", // Aura Mastery
      "377362", // Precognition
    ])
      expect(unitAuraBlocksInterrupt(without, aura)).toBe(true);
  });

  it("Thunder Focus Tea is not an immunity, with or without Zen Focus Tea", () => {
    expect(
      unitAuraBlocksInterrupt({ info: { pvpTalents: ["468430"] } }, "116680"),
    ).toBe(false);
  });

  it("no row keeps a Divine Favor aura the tooltips no longer make an immunity", () => {
    const ids = TALENT_BEHAVIORS.flatMap((b) => [
      b.talentSpellId,
      b.conditionAuraId,
    ]);
    for (const id of ["210294", "210303", "460422", "1270916"])
      expect(ids).not.toContain(id);
  });
});

describe("talentBehaviors — getPvpToolkit", () => {
  it("lists the owner talent-granted tools and marks a castable one UNUSED when never cast", () => {
    // Owner has Lightning Lasso (offensive CC, castable) + Peaceweaver (reactive immunity)
    const toolkit = getPvpToolkit(["305483", "353313"], new Set());
    const lasso = toolkit.find((t) => t.label.includes("Lightning Lasso"));
    const peace = toolkit.find((t) => t.label.includes("Peaceweaver"));
    expect(lasso?.used).toBe(false); // castable but never cast → UNUSED
    expect(peace?.used).toBeUndefined(); // reactive immunity, no usage check
  });

  it("marks a castable tool used when the owner cast its ability", () => {
    const toolkit = getPvpToolkit(["305483"], new Set(["305483"]));
    expect(toolkit.find((t) => t.label.includes("Lightning Lasso"))?.used).toBe(
      true,
    );
  });

  it("returns nothing for a talentless owner", () => {
    expect(getPvpToolkit(undefined, new Set())).toHaveLength(0);
  });
});
