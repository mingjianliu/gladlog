import { readFileSync } from "node:fs";
import { join } from "node:path";

import { decodeCombatantInfo } from "../src/l1/combatantInfo";
import { splitLine } from "../src/l1/splitTopLevel";

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
      // talents: non-empty, each entry a 3-element number tuple
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

describe("decodeCombatantInfo: leading empty element in talents array (Blizzard quirk)", () => {
  it("line 3: '[,(a,b,c),...]' decodes, spec=253, team=1, rating=2439", () => {
    const parsed = splitLine(lines[3]!)!;
    const c = decodeCombatantInfo(parsed.params)!;
    expect(c).not.toBeNull();
    expect(c.specId).toBe(253);
    expect(c.teamId).toBe(1);
    // trailer = honor750, season41, rating2439, tier303 (the first derivation
    // wrongly read 750; corrected against the raw log line)
    expect(c.personalRating).toBe(2439);
    expect(c.talents.length).toBeGreaterThan(5);
  });
});

// Real-log regression (public wowarenalogs testlogs, 2024: 21 of 165 lines
// across shuffle_reloads / shuffle_early_leaver): the interesting-auras list
// is (caster, spellId) pairs OR (caster, spellId, stacks) triples, and the
// old decoder chose by `length % 3`. Three pairs are six elements — read as
// two triples, "1459" became a caster, the line decoded to null and the
// player fell out of the round's roster. The lines here are the fixture's
// own line 0 with only its aura segment swapped.
describe("decodeCombatantInfo: interesting-auras shape is read off the structure", () => {
  const AURAS =
    "[Player-1329-0A8DFA0D,386208,1,Player-1329-0A8DFA0D,386628,1,Player-1596-0645EB62,462854,1,Player-1329-0A8DFA0D,6673,1]";
  const withAuras = (seg: string) => {
    const line = lines[0]!;
    expect(line).toContain(AURAS);
    return decodeCombatantInfo(splitLine(line.replace(AURAS, seg))!.params);
  };

  it("three pairs (six elements) are three pairs, not two triples", () => {
    const c = withAuras(
      "[Player-78-0F864CB8,373456,Player-163-0BD301A2,1459,Player-78-0F864CB8,21562]",
    );
    expect(c).not.toBeNull();
    expect(c!.interestingAuras).toEqual([
      { casterGuid: "Player-78-0F864CB8", spellId: 373456 },
      { casterGuid: "Player-163-0BD301A2", spellId: 1459 },
      { casterGuid: "Player-78-0F864CB8", spellId: 21562 },
    ]);
    expect(c!.personalRating).toBe(2273);
  });

  it("two triples (six elements) keep their (caster, spellId) and drop the stacks", () => {
    const c = withAuras(
      "[Player-60-0FBAAEF3,381748,1,Player-5-0E6A77BA,462854,1]",
    );
    expect(c!.interestingAuras).toEqual([
      { casterGuid: "Player-60-0FBAAEF3", spellId: 381748 },
      { casterGuid: "Player-5-0E6A77BA", spellId: 462854 },
    ]);
  });

  it("the fixture's own four triples still decode", () => {
    expect(withAuras(AURAS)!.interestingAuras).toHaveLength(4);
  });

  it("an aura list of neither shape drops the auras, not the player", () => {
    const c = withAuras("[Player-1-0A,12,Player-2-0B]");
    expect(c).not.toBeNull();
    expect(c!.playerGuid).toMatch(/^Player-/);
    expect(c!.interestingAuras).toEqual([]);
  });
});
