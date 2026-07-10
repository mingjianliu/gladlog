import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitLine } from "../src/l1/splitTopLevel";
import { decodeCombatantInfo } from "../src/l1/combatantInfo";

const lines = readFileSync(
  join(__dirname, "fixtures", "combatant_info_sample.txt"),
  "utf8",
)
  .split("\n")
  .filter(Boolean);

describe("decodeCombatantInfo (structural contract on real lines)", () => {
  it("fixture has two full lines", () => {
    expect(lines.slice(0, 2).length).toBe(2);
  });

  for (const [i, line] of lines.slice(0, 2).entries()) {
    it(`line ${i}: decodes structurally`, () => {
      const parsed = splitLine(line)!;
      expect(parsed.eventName).toBe("COMBATANT_INFO");
      const c = decodeCombatantInfo(parsed.params)!;
      expect(c).not.toBeNull();
      expect(c.playerGuid).toMatch(/^Player-/);
      expect([0, 1]).toContain(c.teamId);
      expect(Number.isInteger(c.specId) && c.specId > 0).toBe(true);
      // talents: 非空,每项 3 元 number 组
      expect(c.talents.length).toBeGreaterThan(10);
      for (const t of c.talents.slice(0, 3)) {
        expect(t).toHaveLength(3);
        expect(t.every((n) => Number.isInteger(n))).toBe(true);
      }
      expect(c.pvpTalents).toHaveLength(4);
      expect(c.equipment.length).toBeGreaterThan(5);
      for (const a of c.interestingAuras) {
        expect(a.casterGuid).toMatch(/^(Player|Creature|Pet)-|^0{16}$/);
        expect(Number.isInteger(a.spellId)).toBe(true);
      }
      expect(Number.isInteger(c.personalRating) && c.personalRating >= 0).toBe(
        true,
      );
    });
  }

  it("line 0: personalRating is 2273 (controller-derived from raw tail; implementer must verify against wowpedia field order and STOP if it disagrees)", () => {
    const parsed = splitLine(lines[0]!)!;
    const c = decodeCombatantInfo(parsed.params)!;
    expect(c.personalRating).toBe(2273);
  });

  it("returns null on truncated params instead of throwing", () => {
    const parsed = splitLine(lines[0]!)!;
    expect(decodeCombatantInfo(parsed.params.slice(0, 5))).toBeNull();
  });
});

describe("decodeCombatantInfo: 2024-vintage format (talents as flat tuple, no auras segment)", () => {
  it("line 2 (1/18/2024): specId 65, rating 1515, equipment present", () => {
    const parsed = splitLine(lines[2]!)!;
    const c = decodeCombatantInfo(parsed.params)!;
    expect(c).not.toBeNull();
    expect(c.playerGuid).toMatch(/^Player-/);
    expect(c.specId).toBe(65);
    expect(c.personalRating).toBe(1515);
    expect(c.equipment.length).toBeGreaterThan(3);
    expect([0, 1]).toContain(c.teamId);
  });
});
