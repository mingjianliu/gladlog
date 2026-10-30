import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import {
  buildSpecNameIndex,
  SPEC_NAME_TO_ID,
  specKeyToDb2Name,
  transformSpellManaCostRows,
} from "../../scripts/datagen/genSpellManaCost";
import { parseCsv } from "../../scripts/datagen/lib/wagoCsv";
import {
  manaCostForCast,
  SPELL_MANA_COST_TABLE,
} from "../../src/data/spellManaCost";

const HEADER = "SpellID,PowerType,PowerCostPct,ManaCost,RequiredAuraSpellID";
const row = (
  spellId: string,
  powerType: string,
  pct: string,
  flat: string,
  requiredAura = "0",
) => `${spellId},${powerType},${pct},${flat},${requiredAura}`;

// Minimal test-local aura-name fixture (not real spellNames.json data) —
// covers only the aura ids these unit tests actually reference.
const AURA_NAMES: Record<string, string> = {
  "137031": "Holy Priest",
  "137033": "Shadow Priest",
  "137029": "Holy Paladin",
  "417191": "Initial Priest", // no real spec — must resolve to nothing
};

describe("transformSpellManaCostRows", () => {
  it("unconditional pct row → { pct }", () => {
    const csv = [HEADER, row("20473", "0", "2", "0")].join("\n");
    const { rows } = parseCsv(csv);
    const { table } = transformSpellManaCostRows(
      rows,
      new Set(["20473"]),
      AURA_NAMES,
    );
    expect(table).toEqual({ "20473": { pct: 2 } });
  });

  it("flat ManaCost row → { flat }", () => {
    const csv = [HEADER, row("228", "0", "0", "120")].join("\n");
    const { rows } = parseCsv(csv);
    const { table } = transformSpellManaCostRows(
      rows,
      new Set(["228"]),
      AURA_NAMES,
    );
    expect(table).toEqual({ "228": { flat: 120 } });
  });

  it("non-mana PowerType (rage/energy/etc.) is ignored entirely", () => {
    const csv = [HEADER, row("1", "1", "10", "0")].join("\n");
    const { rows } = parseCsv(csv);
    expect(
      transformSpellManaCostRows(rows, new Set(["1"]), AURA_NAMES).table,
    ).toEqual({});
  });

  it("spell not in the observed set is dropped", () => {
    const csv = [HEADER, row("999", "0", "5", "0")].join("\n");
    const { rows } = parseCsv(csv);
    expect(
      transformSpellManaCostRows(rows, new Set(["20473"]), AURA_NAMES).table,
    ).toEqual({});
  });

  it("zero-cost row (pct=0, flat=0) is dropped — nothing usable", () => {
    const csv = [HEADER, row("1", "0", "0", "0")].join("\n");
    const { rows } = parseCsv(csv);
    expect(
      transformSpellManaCostRows(rows, new Set(["1"]), AURA_NAMES).table,
    ).toEqual({});
  });

  it("spec-conditional rows (RequiredAuraSpellID gated) → bySpec keyed by CombatUnitSpec id, resolved via aura name → derived spec index", () => {
    const csv = [
      HEADER,
      row("2061", "0", "2.61", "0", "137031"), // Holy Priest
      row("2061", "0", "10", "0", "137033"), // Shadow Priest
      row("2061", "0", "10", "0", "417191"), // "Initial Priest" — no real spec
    ].join("\n");
    const { rows } = parseCsv(csv);
    const { table, skippedAuras } = transformSpellManaCostRows(
      rows,
      new Set(["2061"]),
      AURA_NAMES,
    );
    expect(table).toEqual({
      "2061": { bySpec: { "257": { pct: 2.61 }, "258": { pct: 10 } } },
    });
    // The unmatched aura is reported, not silently dropped.
    expect(skippedAuras).toEqual(["417191"]);
  });

  it("aura id absent from auraNameById entirely (no name at all) → row skipped, aura reported", () => {
    const csv = [HEADER, row("2061", "0", "10", "0", "999999999")].join("\n");
    const { rows } = parseCsv(csv);
    const { table, skippedAuras } = transformSpellManaCostRows(
      rows,
      new Set(["2061"]),
      AURA_NAMES, // no entry for "999999999"
    );
    expect(table).toEqual({});
    expect(skippedAuras).toEqual(["999999999"]);
  });

  it("unconditional row coexisting with conditional rows keeps both (base + bySpec)", () => {
    const csv = [
      HEADER,
      row("999", "0", "5", "0", "0"), // spec-agnostic default
      row("999", "0", "1", "0", "137029"), // Holy Paladin override
    ].join("\n");
    const { rows } = parseCsv(csv);
    const { table } = transformSpellManaCostRows(
      rows,
      new Set(["999"]),
      AURA_NAMES,
    );
    expect(table).toEqual({
      "999": { pct: 5, bySpec: { "65": { pct: 1 } } },
    });
  });
});

/**
 * Aura→spec derivation (2026-08-15 review fix I1): `REQUIRED_AURA_TO_SPEC`
 * used to be a 26-entry hand-typed table inside the generator — an
 * unregistered curated game-fact per CLAUDE.md's curatedAbilityFacts
 * institution. Replaced with a mechanical derivation: each spec-passive
 * aura's own official DB2 name literally equals `"<spec label> <class
 * label>"`, which `specKeyToDb2Name` computes from the OFFICIALLY GENERATED
 * `CombatUnitSpec` enum (packages/parser-compat/src/enumsGenerated.ts) by
 * PascalCase-splitting the enum key — no hand-typed name↔spec pair exists
 * anywhere in the generator anymore.
 */
describe("specKeyToDb2Name / buildSpecNameIndex (derived aura→spec resolution)", () => {
  it("PascalCase word-split matches known DB2 spec-passive-aura names", () => {
    expect(specKeyToDb2Name("Priest_Holy")).toBe("Holy Priest");
    expect(specKeyToDb2Name("DemonHunter_Havoc")).toBe("Havoc Demon Hunter");
    expect(specKeyToDb2Name("Evoker_Devastation")).toBe("Devastation Evoker");
    expect(specKeyToDb2Name("Hunter_BeastMastery")).toBe(
      "Beast Mastery Hunter",
    );
    expect(specKeyToDb2Name("None")).toBeNull(); // enum sentinel, not a class_spec pair
  });

  it("the derived index reproduces the review's 3 spot-checked pairs exactly (137031/212612/356809)", () => {
    // Review brief spot-checks: 137031 → wowhead "Holy Priest" (spec 257),
    // 212612 → "Havoc Demon Hunter" (spec 577), 356809 → "Devastation
    // Evoker" (spec 1467). Asserted here against the MECHANISM (independent
    // of spellNames.json's live data) — see the next test for the
    // end-to-end version against the real generated name table.
    expect(SPEC_NAME_TO_ID.get("Holy Priest")).toBe("257");
    expect(SPEC_NAME_TO_ID.get("Havoc Demon Hunter")).toBe("577");
    expect(SPEC_NAME_TO_ID.get("Devastation Evoker")).toBe("1467");
  });

  it("buildSpecNameIndex() is a fresh, independently-reproducible computation (not just reading the cached SPEC_NAME_TO_ID singleton)", () => {
    const rebuilt = buildSpecNameIndex();
    expect(rebuilt.get("Holy Priest")).toBe("257");
    expect(rebuilt.size).toBe(SPEC_NAME_TO_ID.size);
  });

  it("end-to-end against the REAL spellNames.json: the 3 review-verified aura ids' actual official names resolve to the expected specs", () => {
    // This is exactly what main() does at generation time: look up each
    // RequiredAuraSpellID's real DB2 name, then resolve via SPEC_NAME_TO_ID.
    const realNames = JSON.parse(
      readFileSync(
        path.resolve(__dirname, "../../src/data/spellNames.json"),
        "utf-8",
      ),
    ) as Record<string, string>;
    expect(realNames["137031"]).toBe("Holy Priest");
    expect(realNames["212612"]).toBe("Havoc Demon Hunter");
    expect(realNames["356809"]).toBe("Devastation Evoker");
    expect(SPEC_NAME_TO_ID.get(realNames["137031"]!)).toBe("257");
    expect(SPEC_NAME_TO_ID.get(realNames["212612"]!)).toBe("577");
    expect(SPEC_NAME_TO_ID.get(realNames["356809"]!)).toBe("1467");
  });
});

describe("manaCostForCast", () => {
  it("unconditional row: pct converts to absolute mana via manaMax", () => {
    expect(manaCostForCast("20473", "65", 273000)).toBeCloseTo(5460, 5); // 2% of 273000
  });

  it("spec-conditional row: picks the caster's own spec, not another spec's row", () => {
    // 2061 Flash Heal: Holy Priest 2.61%, Shadow Priest 10% (see generator anchors)
    expect(manaCostForCast("2061", "257", 273000)).toBeCloseTo(
      0.0261 * 273000,
      1,
    );
    expect(manaCostForCast("2061", "258", 273000)).toBeCloseTo(0.1 * 273000, 5);
  });

  it("spec-conditional row with no matching spec → null (never guesses)", () => {
    // 2061 has no unconditional row and no Discipline (256) anchor in this
    // synthetic case — but the real table DOES have 256, so use a spec that
    // is genuinely absent: e.g. a Mage spec never casts Flash Heal.
    expect(manaCostForCast("2061", "62", 273000)).toBeNull();
  });

  it("unknown spellId → null", () => {
    expect(manaCostForCast("999999999", "65", 273000)).toBeNull();
  });
});

/**
 * Anchor list (2026-08-15, DR-seven-step-precedent discipline): five
 * healing spells whose mana cost was verified against build 12.1.0.69273's
 * live `SpellPower` CSV AND cross-checked independently (see
 * genSpellManaCost.ts's module header + task-4-report.md). These also
 * double as a regression pin on the 2026-08-15 review-fix regeneration
 * (I1: aura→spec map derived from official data instead of hand-typed) —
 * the generated table is asserted to be byte-identical to before that fix
 * (see task-4-report.md's "Fix round 1" section for the diff confirmation):
 *   - Holy Shock (20473, Holy Paladin, unconditional 2%): wowhead's generic
 *     tooltip independently reads "2% of base mana" — matches exactly; the
 *     healer's own raw.txt mana samples around a real Holy Shock cast in
 *     match 60ab1e8f show a 2.05% drop across a 0.017s gap to the next
 *     logged event — empirical confirmation, not just column-reading.
 *   - Holy Light (82326, Holy Paladin, unconditional 7%).
 *   - Holy Word: Serenity (2050, Priest, unconditional 2.375%).
 *   - Flash Heal (2061, spec-conditional): Holy Priest 2.61% vs the
 *     class-generic wowhead tooltip's 10% (the Shadow/default row) — this
 *     ~4x gap is exactly the misread this table's spec-conditional handling
 *     exists to prevent; asserting BOTH rows here pins that the Holy row
 *     specifically, not the class-default row, resolves for a Holy Priest.
 *   - Flash of Light (19750, spec-conditional): Holy Paladin 0.6% vs
 *     Retribution/Protection's shared 10% — the largest observed spec gap
 *     in this table (~16.7x), a real Holy Paladin mana-economy fact (cheap
 *     Flash of Light spam is central to the spec's kit).
 * A mismatch here means either the upstream DB2 build changed these costs
 * (rare — check the patch notes before touching this test) or the
 * generator's spec-aura resolution/scope logic drifted — STOP and report per
 * CLAUDE.md's anchor-list discipline, do not just update the expected
 * number to make the test pass.
 */
describe("spellManaCostGenerated anchors", () => {
  it("Holy Shock (20473): unconditional 2%", () => {
    expect(SPELL_MANA_COST_TABLE["20473"]).toEqual({ pct: 2 });
  });
  it("Holy Light (82326): unconditional 7%", () => {
    expect(SPELL_MANA_COST_TABLE["82326"]).toEqual({ pct: 7 });
  });
  it("Holy Word: Serenity (2050): unconditional 2.375%", () => {
    expect(SPELL_MANA_COST_TABLE["2050"]).toEqual({ pct: 2.375 });
  });
  it("Flash Heal (2061): Holy Priest (257) 2.61%, not the 10% class-default", () => {
    const row = SPELL_MANA_COST_TABLE["2061"];
    expect(row?.pct).toBeUndefined(); // no spec-agnostic row exists
    expect(row?.bySpec?.["257"]?.pct).toBeCloseTo(2.6099998951, 5);
    expect(row?.bySpec?.["258"]?.pct).toBe(10); // Shadow Priest — the wowhead-generic value
  });
  it("Flash of Light (19750): Holy Paladin (65) 0.6%, not the 10% Ret/Prot value", () => {
    const row = SPELL_MANA_COST_TABLE["19750"];
    expect(row?.bySpec?.["65"]?.pct).toBeCloseTo(0.60000002384, 5);
    expect(row?.bySpec?.["70"]?.pct).toBe(10); // Retribution Paladin
  });
});
