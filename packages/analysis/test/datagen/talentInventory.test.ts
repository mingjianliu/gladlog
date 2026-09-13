import { describe, expect, it } from "vitest";

import {
  buildTalentInventory,
  compileCooldownModifiers,
  deriveClassFamilies,
  MAX_TRIGGER_HOPS,
  talentClassMapOf,
} from "../../scripts/datagen/lib/talentInventory";

// GH #96 M1 — design D1 fixtures (codex astra R2 ruling 1). Synthetic trees so
// the fixtures do not depend on the real talent map.
const tree = (classId: number, specId: number, spellIds: string[]) => ({
  classId,
  specId,
  classNodes: [{ entries: spellIds.map((spellId) => ({ spellId })) }],
});
const effect = (
  spellId: string,
  id: string,
  extra: Record<string, string> = {},
): Record<string, string> => ({
  ID: id,
  SpellID: spellId,
  EffectIndex: "0",
  Effect: "6",
  EffectAura: "107",
  EffectBasePointsF: "-10000",
  EffectMiscValue_0: "11",
  EffectSpellClassMask_0: "1",
  EffectSpellClassMask_1: "0",
  EffectSpellClassMask_2: "0",
  EffectSpellClassMask_3: "0",
  EffectTriggerSpell: "0",
  ...extra,
});
const target = {
  SpellID: "900001",
  SpellClassSet: "8",
  SpellClassMask_0: "1",
  SpellClassMask_1: "0",
  SpellClassMask_2: "0",
  SpellClassMask_3: "0",
};

describe("talent evidence inventory (GH #96 M1)", () => {
  it("a row reached from two talents is stored once with an edge per talent, and compiles once", () => {
    // talents 800001 and 800002 both trigger carrier 800100, whose row R carries the SpellMod
    const inv = buildTalentInventory({
      talentTrees: [tree(4, 259, ["800001", "800002"])],
      pvpPool: {},
      spellEffectRows: [
        effect("800001", "1", {
          EffectAura: "42",
          EffectTriggerSpell: "800100",
          EffectMiscValue_0: "0",
          EffectSpellClassMask_0: "0",
        }),
        effect("800002", "2", {
          EffectAura: "42",
          EffectTriggerSpell: "800100",
          EffectMiscValue_0: "0",
          EffectSpellClassMask_0: "0",
        }),
        effect("800100", "3"),
      ],
      spellClassOptionsRows: [target],
      spellCategoriesRows: [],
      trackedSpellIds: new Set(["900001"]),
    });
    expect(inv.rows.filter((r) => r.rowId === "3")).toHaveLength(1);
    const reach = inv.edges.filter((e) => e.spellId === "800100");
    expect(reach.map((e) => e.talentSpellId).sort()).toEqual([
      "800001",
      "800002",
    ]);
    expect(reach.every((e) => e.hop === 1)).toBe(true);
    // trigger-reached rows are inventory, not permanent cooldown rules
    expect(compileCooldownModifiers(inv, new Set(["900001"]))).toEqual({});
  });

  it("activation is unknown without duration evidence, whileAura for a finite carrier, passive only when SpellMisc covers it", () => {
    const base = {
      talentTrees: [tree(4, 259, ["800001", "800002", "800003"])],
      pvpPool: {},
      spellEffectRows: [
        effect("800001", "1"),
        effect("800002", "2"),
        effect("800003", "3"),
      ],
      spellClassOptionsRows: [target],
      spellCategoriesRows: [],
    };
    const inv = buildTalentInventory({
      ...base,
      temporarySpellIds: new Set(["800002"]),
      knownDurationSpellIds: new Set(["800002", "800003"]),
    });
    const act = Object.fromEntries(
      inv.rows.map((r) => [r.spellId, r.activation]),
    );
    expect(act).toEqual({
      "800001": "unknown",
      "800002": "whileAura",
      "800003": "passive",
    });
  });

  it("trigger chains longer than MAX_TRIGGER_HOPS are recorded as truncated, not silently cut", () => {
    const chain = ["800001", "800101", "800102", "800103"];
    const rows = chain.map((id, i) =>
      effect(id, String(i + 1), {
        EffectAura: "42",
        EffectMiscValue_0: "0",
        EffectSpellClassMask_0: "0",
        EffectTriggerSpell: chain[i + 1] ?? "0",
      }),
    );
    const inv = buildTalentInventory({
      talentTrees: [tree(4, 259, ["800001"])],
      pvpPool: {},
      spellEffectRows: rows,
      spellClassOptionsRows: [],
      spellCategoriesRows: [],
    });
    expect(Math.max(...inv.edges.map((e) => e.hop))).toBe(MAX_TRIGGER_HOPS);
    expect(inv.meta.truncatedTriggerEdges).toBe(1);
  });

  it("class family is read from DB2 when the class's talent spells carry SpellClassOptions", () => {
    const talentClass = talentClassMapOf(
      [tree(10, 268, ["800001", "800002", "800003"])],
      {},
    );
    const opts = ["800001", "800002", "800003"].map((SpellID) => ({
      SpellID,
      SpellClassSet: "53",
    }));
    expect(deriveClassFamilies(talentClass, opts).derived).toEqual({ 10: 53 });
  });

  it("a SpellMod op code in MiscValue_0 never becomes a charge-category target", () => {
    const inv = buildTalentInventory({
      talentTrees: [tree(4, 259, ["800001"])],
      pvpPool: {},
      spellEffectRows: [effect("800001", "1", { EffectSpellClassMask_0: "0" })],
      spellClassOptionsRows: [],
      spellCategoriesRows: [{ SpellID: "900011", ChargeCategory: "11" }],
    });
    expect(inv.rows[0]!.targets.some((t) => t.via === "chargeCategory")).toBe(
      false,
    );
  });
});
