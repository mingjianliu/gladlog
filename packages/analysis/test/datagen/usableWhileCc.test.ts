import { describe, expect, it } from "vitest";

import {
  ANCHOR_HAND_EXEMPTIONS,
  attrBit,
  DIMENSIONS,
  NAMED_BITS,
  usableWhile,
  verifyAnchors,
} from "../../scripts/datagen/genUsableWhileCc";
import { UWC_ANCHORS } from "../../scripts/datagen/usableWhileCcAnchors";
import observed from "../../src/data/observedSpellIdsGenerated.json";
import { USABLE_WHILE_CC_GENERATED } from "../../src/data/usableWhileCcGenerated";
import { USABLE_WHILE_CC_CONDITIONAL } from "../../src/utils/cooldowns";

// 2026-09-04 (BACKLOG #41 (8)): the table reads the NAMED SpellMisc bits
// (SimC sc_spell_info.cpp / TrinityCore SharedDefines.h) — stunned 163 ∪ 378,
// feared 177, confused 178 — and the 13 signed anchors are the verification
// gate. The 2026-08-14 bit search had picked 10#13 "Reset Cooldown on
// Encounter End" as the second stun bit and admitted 213 observed long
// cooldowns; three anchors (Divine Shield / Ice Block / Icebound Fortitude)
// were re-ruled NOT usable that day, so every non-null cell now agrees.
const observedIds = new Set((observed as unknown as number[]).map(String));

describe("usableWhileCcGenerated — named bits vs signed anchors", () => {
  it.each(DIMENSIONS)(
    "every observed non-null %s anchor matches the generated set (hand exemptions aside)",
    (dim) => {
      for (const a of UWC_ANCHORS) {
        const expected = a[dim];
        if (expected === null) continue;
        if (ANCHOR_HAND_EXEMPTIONS[dim].has(a.spellId)) continue;
        if (!observedIds.has(a.spellId)) continue; // emitted table is corpus-restricted
        if (dim === "stunned" && a.spellId in USABLE_WHILE_CC_CONDITIONAL)
          continue;
        expect(
          USABLE_WHILE_CC_GENERATED[dim].has(a.spellId),
          `${a.name} ${dim}`,
        ).toBe(expected);
      }
    },
  );

  it("all three dimensions are emitted and non-trivial (>20 spells at current build)", () => {
    for (const dim of DIMENSIONS)
      expect(USABLE_WHILE_CC_GENERATED[dim].size, dim).toBeGreaterThan(20);
  });

  it("the 10#13 false positives are gone: Bloodlust / Tranquility / Rebirth / Innervate / Lay on Hands are NOT usable while stunned", () => {
    for (const id of ["2825", "740", "20484", "29166", "633"])
      expect(USABLE_WHILE_CC_GENERATED.stunned.has(id), id).toBe(false);
  });

  it("the former hand gap layer is covered by bit 378: Divine Protection 498/403876, Thunderstorm 51490", () => {
    for (const id of ["498", "403876", "51490"])
      expect(USABLE_WHILE_CC_GENERATED.stunned.has(id), id).toBe(true);
  });

  it("user re-ruling 2026-09-04: Divine Shield 642 / Ice Block 45438 / Icebound Fortitude 48792 are NOT usable while stunned", () => {
    for (const id of ["642", "45438", "48792"])
      expect(USABLE_WHILE_CC_GENERATED.stunned.has(id), id).toBe(false);
  });

  it("the signed conditional layer is withheld from the unconditional stunned set", () => {
    for (const id of Object.keys(USABLE_WHILE_CC_CONDITIONAL))
      expect(USABLE_WHILE_CC_GENERATED.stunned.has(id), id).toBe(false);
  });
});

describe("genUsableWhileCc pure functions", () => {
  const row = (
    attrs: Partial<Record<number, number>>,
  ): Record<string, string> => {
    const r: Record<string, string> = { SpellID: "1", DifficultyID: "0" };
    for (let i = 0; i < 17; i++) r[`Attributes_${i}`] = String(attrs[i] ?? 0);
    return r;
  };

  it("attrBit reads global index = column × 32 + bit, unsigned", () => {
    expect(attrBit(row({ 5: 0x8 }), 163)).toBe(true); // Attributes_5 bit 3
    expect(attrBit(row({ 5: 0x8 }), 164)).toBe(false);
    expect(attrBit(row({ 11: 1 << 26 }), 378)).toBe(true); // Attributes_11 bit 26
    expect(attrBit(row({ 5: 0x80000000 }), 5 * 32 + 31)).toBe(true); // top bit, no sign trap
    expect(attrBit(row({}), 999)).toBe(false); // beyond the 17 columns
  });

  it("usableWhile = OR over the dimension's named bits", () => {
    expect(NAMED_BITS.stunned.map((b) => b.index)).toEqual([163, 378]);
    expect(usableWhile(row({ 11: 1 << 26 }), "stunned")).toBe(true);
    expect(usableWhile(row({ 5: 1 << 17 }), "feared")).toBe(true);
    expect(usableWhile(row({ 5: 1 << 18 }), "confused")).toBe(true);
    expect(usableWhile(row({ 10: 1 << 13 }), "stunned")).toBe(false); // the old wrong bit
  });

  it("verifyAnchors reports disagreements and honours hand exemptions", () => {
    const byId = new Map<string, Record<string, string>>([
      ["1", row({ 5: 0x8 })],
      ["2", row({})],
    ]);
    const anchors = [
      {
        spellId: "1",
        name: "a",
        stunned: true,
        feared: null,
        confused: null,
        rationale: "",
        source: "",
      },
      {
        spellId: "2",
        name: "b",
        stunned: false,
        feared: true,
        confused: null,
        rationale: "",
        source: "",
      },
    ];
    const v = verifyAnchors(byId, anchors, {
      stunned: new Set(),
      feared: new Set(),
      confused: new Set(),
    });
    expect(v.checked).toBe(3);
    expect(v.disagreements).toEqual(["2 b: feared anchor=true bits=false"]);
    const v2 = verifyAnchors(byId, anchors, {
      stunned: new Set(),
      feared: new Set(["2"]),
      confused: new Set(),
    });
    expect(v2.disagreements).toEqual([]);
    expect(v2.exempted).toEqual(["2 b feared=true (hand gap layer)"]);
  });
});
