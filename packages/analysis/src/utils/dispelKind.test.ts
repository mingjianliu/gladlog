import { describe, expect, it } from "vitest";

import {
  addCastToIndex,
  addRepeatEndToIndex,
  buildCastMatchIndex,
  classifyDispel,
  createCastMatchIndex,
  DISPEL_CAST_MATCH_WINDOW_MS,
  dispelRodeOwnPress,
  MOVEMENT_ROOT_BREAK_DISPEL_IDS,
} from "./dispelKind";

const PET = "Pet-0-1234";
const PLAYER = "Player-1-ABCD";

describe("classifyDispel (UI review 2026-08-21 #3)", () => {
  it("cast-matched by id within the window → deliberate", () => {
    const idx = createCastMatchIndex();
    addCastToIndex(idx, PLAYER, "527", "Purify", 10_000);
    expect(
      classifyDispel(idx, {
        srcUnitId: PLAYER,
        spellId: "527",
        spellName: "Purify",
        timestamp: 10_400,
      }),
    ).toBe("deliberate");
  });

  it("no cast from that source → proc (Cleanse the Weak shape)", () => {
    const idx = createCastMatchIndex();
    addCastToIndex(idx, PLAYER, "19750", "Flash of Light", 10_000);
    expect(
      classifyDispel(idx, {
        srcUnitId: PLAYER,
        spellId: "199427",
        spellName: "Cleanse the Weak",
        timestamp: 10_050,
      }),
    ).toBe("proc");
  });

  it("outside the ±window → proc", () => {
    const idx = createCastMatchIndex();
    addCastToIndex(idx, PLAYER, "527", "Purify", 10_000);
    expect(
      classifyDispel(idx, {
        srcUnitId: PLAYER,
        spellId: "527",
        spellName: "Purify",
        timestamp: 10_000 + DISPEL_CAST_MATCH_WINDOW_MS + 1,
      }),
    ).toBe("proc");
  });

  it("name match covers the Mass Dispel effect id (32592 vs cast 32375)", () => {
    const idx = createCastMatchIndex();
    addCastToIndex(idx, PLAYER, "32375", "Mass Dispel", 10_000);
    expect(
      classifyDispel(idx, {
        srcUnitId: PLAYER,
        spellId: "32592",
        spellName: "Mass Dispel",
        timestamp: 10_300,
      }),
    ).toBe("deliberate");
  });

  it("pet dispel matches the pet's own cast, not the owner's", () => {
    const idx = createCastMatchIndex();
    addCastToIndex(idx, PET, "19505", "Devour Magic", 10_000);
    expect(
      classifyDispel(idx, {
        srcUnitId: PET,
        spellId: "19505",
        spellName: "Devour Magic",
        timestamp: 10_100,
      }),
    ).toBe("deliberate");
    expect(
      classifyDispel(idx, {
        srcUnitId: PLAYER,
        spellId: "19505",
        spellName: "Devour Magic",
        timestamp: 10_100,
      }),
    ).toBe("proc");
  });

  it("cast-matched but a movement/form rider → rider", () => {
    const idx = createCastMatchIndex();
    addCastToIndex(idx, PLAYER, "768", "Cat Form", 10_000);
    expect(MOVEMENT_ROOT_BREAK_DISPEL_IDS.has("768")).toBe(true);
    expect(
      classifyDispel(idx, {
        srcUnitId: PLAYER,
        spellId: "768",
        spellName: "Cat Form",
        timestamp: 10_000,
      }),
    ).toBe("rider");
  });

  it("rider id without a cast is still rider, not proc (the list wins)", () => {
    const idx = createCastMatchIndex();
    expect(
      classifyDispel(idx, {
        srcUnitId: PLAYER,
        spellId: "114239",
        spellName: "Phantasm",
        timestamp: 10_000,
      }),
    ).toBe("rider");
  });
});

describe("buildCastMatchIndex (GH #32 — shared by product and the corpus-gate generator)", () => {
  it("indexes only SPELL_CAST_SUCCESS, keyed on the raw source GUID with unit id as fallback", () => {
    const idx = buildCastMatchIndex([
      {
        id: PLAYER,
        spellCastEvents: [
          {
            logLine: { event: "SPELL_CAST_SUCCESS" },
            srcUnitId: PLAYER,
            spellId: "527",
            spellName: "Purify",
            timestamp: 10_000,
          },
          // a cast START must not count as a decision
          {
            logLine: { event: "SPELL_CAST_START" },
            srcUnitId: PLAYER,
            spellId: "527",
            spellName: "Purify",
            timestamp: 20_000,
          },
          // missing srcUnitId falls back to the unit id
          {
            logLine: { event: "SPELL_CAST_SUCCESS" },
            spellId: "19505",
            spellName: "Devour Magic",
            timestamp: 30_000,
          },
        ],
      },
    ]);
    expect(idx.byId.get(`${PLAYER}|527`)).toEqual([10_000]);
    expect(idx.byName.get(`${PLAYER}|Purify`)).toEqual([10_000]);
    expect(idx.byId.get(`${PLAYER}|19505`)).toEqual([30_000]);
    expect(
      classifyDispel(idx, {
        srcUnitId: PLAYER,
        spellId: "527",
        spellName: "Purify",
        timestamp: 20_300,
      }),
    ).toBe("proc");
  });
});

describe("T130 — a press logged while its source was unresolved", () => {
  // 54251a4b r0: Nature's Cure rows at 16.755 with source flags 0x528 and no
  // cast row; the druid's Nature's Cure cast rows elsewhere in the round
  const idx = createCastMatchIndex();
  addCastToIndex(idx, PLAYER, "88423", "Nature's Cure", 28_940);
  const at = (
    srcFlags: number | undefined,
    spellId = "88423",
    spellName = "Nature's Cure",
  ) =>
    classifyDispel(idx, {
      srcUnitId: PLAYER,
      spellId,
      spellName,
      timestamp: 16_755,
      ...(srcFlags === undefined ? {} : { srcFlags }),
    });

  it("unresolved source + a button it presses elsewhere → deliberate", () => {
    expect(at(0x528)).toBe("deliberate");
  });
  it("a resolved source's missing cast row stays a proc", () => {
    expect(at(0x548)).toBe("proc");
    expect(at(0x10548)).toBe("proc");
    expect(at(undefined)).toBe("proc");
  });
  it("a spell the source never casts stays a proc, unresolved or not", () => {
    expect(at(0x528, "199427", "Cleanse the Weak")).toBe("proc");
  });
  it("a press of the same spell 4 s before makes it that press's repeat (Improved Spellsteal)", () => {
    const i2 = createCastMatchIndex();
    addCastToIndex(i2, PLAYER, "30449", "Spellsteal", 10_000);
    const d = {
      srcUnitId: PLAYER,
      spellId: "30449",
      spellName: "Spellsteal",
      srcFlags: 0x528,
    };
    expect(classifyDispel(i2, { ...d, timestamp: 14_000 })).toBe("proc");
    expect(classifyDispel(i2, { ...d, timestamp: 14_018 })).toBe("proc");
    // before the press (the druid's shape) or long after: a hidden press
    expect(classifyDispel(i2, { ...d, timestamp: 9_000 })).toBe("deliberate");
    expect(classifyDispel(i2, { ...d, timestamp: 16_000 })).toBe("deliberate");
  });
});

describe("T191: a delayed re-steal is the earlier press's, never a press of its own", () => {
  const steal = (timestamp: number, srcFlags = 0x511) => ({
    srcUnitId: PLAYER,
    spellId: "30449",
    spellName: "Spellsteal",
    timestamp,
    srcFlags,
  });

  it("7686e97d r3 2:24: the re-steal at the debuff's end, 672 ms before the next press, reads proc; the press stays deliberate", () => {
    const idx = createCastMatchIndex();
    addCastToIndex(idx, PLAYER, "30449", "Spellsteal", 140_117);
    addCastToIndex(idx, PLAYER, "30449", "Spellsteal", 144_798);
    // without the debuff's end the name match takes the next press
    expect(classifyDispel(idx, steal(144_126))).toBe("deliberate");
    addRepeatEndToIndex(idx, PLAYER, "Spellsteal", 144_125);
    expect(classifyDispel(idx, steal(144_126))).toBe("proc");
    expect(classifyDispel(idx, steal(144_798))).toBe("deliberate");
  });

  it("an unresolved source (T130's path) reads proc too, and another press at its instant does not make it a side effect", () => {
    const idx = createCastMatchIndex();
    addCastToIndex(idx, PLAYER, "30449", "Spellsteal", 64_337);
    addCastToIndex(idx, PLAYER, "133", "Fireball", 68_355);
    addRepeatEndToIndex(idx, PLAYER, "Spellsteal", 68_341);
    expect(classifyDispel(idx, steal(68_355, 0x528))).toBe("proc");
    expect(dispelRodeOwnPress(idx, steal(68_355))).toBe(false);
  });

  it("the debuff's end beyond 50 ms is no repeat", () => {
    const idx = createCastMatchIndex();
    addCastToIndex(idx, PLAYER, "30449", "Spellsteal", 10_500);
    addRepeatEndToIndex(idx, PLAYER, "Spellsteal", 10_000 - 51);
    expect(classifyDispel(idx, steal(10_000))).toBe("deliberate");
  });

  it("buildCastMatchIndex reads the end from any unit's aura rows — the target's, or the mage's own after a reflect", () => {
    const removed = (destId: string, timestamp: number) => ({
      logLine: { event: "SPELL_AURA_REMOVED" },
      srcUnitId: PLAYER,
      destUnitId: destId,
      spellId: "1270828",
      spellName: "Spellsteal",
      timestamp,
    });
    const idx = buildCastMatchIndex([
      {
        id: PLAYER,
        spellCastEvents: [],
        auraEvents: [removed(PLAYER, 20_000)],
      },
      {
        id: "Player-2-T",
        spellCastEvents: [],
        auraEvents: [removed("Player-2-T", 30_000)],
      },
    ]);
    addCastToIndex(idx, PLAYER, "30449", "Spellsteal", 20_300);
    addCastToIndex(idx, PLAYER, "30449", "Spellsteal", 30_300);
    expect(classifyDispel(idx, steal(20_000))).toBe("proc");
    expect(classifyDispel(idx, steal(30_000))).toBe("proc");
  });
});
