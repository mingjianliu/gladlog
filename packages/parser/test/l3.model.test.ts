import { specToClass, classIdOf } from "../src/l3/data/specToClass";
import type {
  GladUnit,
  GladMatch,
  GladShuffleRound,
  GladShuffle,
} from "../src/l3/model";

describe("specToClass (Blizzard spec IDs → class IDs)", () => {
  // classId 采用暴雪 ChrClasses ID:1 Warrior,2 Paladin,3 Hunter,4 Rogue,5 Priest,
  // 6 DeathKnight,7 Shaman,8 Mage,9 Warlock,10 Monk,11 Druid,12 DemonHunter,13 Evoker
  const cases: [number, number][] = [
    [257, 5], // Holy Priest
    [256, 5], // Discipline Priest
    [71, 1], // Arms Warrior
    [65, 2], // Holy Paladin
    [253, 3], // Beast Mastery Hunter
    [259, 4], // Assassination Rogue
    [250, 6], // Blood Death Knight
    [262, 7], // Elemental Shaman
    [64, 8], // Frost Mage
    [265, 9], // Affliction Warlock
    [270, 10], // Mistweaver Monk
    [105, 11], // Restoration Druid
    [577, 12], // Havoc Demon Hunter
    [1468, 13], // Preservation Evoker
  ];
  for (const [spec, cls] of cases) {
    it(`spec ${spec} → class ${cls}`, () => {
      expect(specToClass[spec]).toBe(cls);
      expect(classIdOf(spec)).toBe(cls);
    });
  }
  it("unknown spec → 0", () => {
    expect(classIdOf(999999)).toBe(0);
    expect(classIdOf(0)).toBe(0);
  });
  it("table covers all 40 retail specs", () => {
    expect(Object.keys(specToClass).length).toBe(40);
  });
});

describe("l3 model types compile and are structurally usable", () => {
  it("can construct a minimal GladUnit literal", () => {
    const u: GladUnit = {
      id: "Player-1-A",
      name: "Alice-X",
      kind: "Player",
      reaction: "Friendly",
      classId: 5,
      specId: 257,
      damageOut: [],
      damageIn: [],
      healOut: [],
      healIn: [],
      absorbsOut: [],
      absorbsIn: [],
      casts: [],
      castStarts: [],
      petCasts: [],
      auraEvents: [],
      actionsOut: [],
      actionsIn: [],
      deaths: [],
      unconsciousEvents: [],
      advancedSamples: [],
    };
    expect(u.specId).toBe(257);
    // 类型层面确认判别联合可用
    const kinds: GladMatch["kind"][] = ["match"];
    const rk: GladShuffleRound["kind"][] = ["shuffleRound"];
    const sk: GladShuffle["kind"][] = ["shuffle"];
    expect([kinds[0], rk[0], sk[0]]).toEqual([
      "match",
      "shuffleRound",
      "shuffle",
    ]);
  });
});
