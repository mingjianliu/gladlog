/**
 * Triage 2026-09-29 missed-cleanse F-P2 / F-P3 (ruling A18 = A) and F-P1:
 * the [MINOR DISPELS] fold lists casts with what they removed; the owner's
 * purge skip uses the gap filler's own match predicate.
 */
import { CombatUnitReaction } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { purgeMatchesCast } from "../src/context/timelineSections/healerCastGapFiller";
import {
  emitMinorDispelEntries,
  formatMinorDispelPart,
  MINOR_DISPEL_PASSIVE_TAG,
  MINOR_DISPEL_RIDER_TAG,
  minorDispelPartTag,
} from "../src/context/timelineSections/minorDispels";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  type IDispelEvent,
  reconstructDispelSummary,
} from "../src/utils/dispelAnalysis";
import {
  addCastToIndex,
  classifyDispel,
  createCastMatchIndex,
  dispelCameWithOwnCast,
  dispelPressedBy,
} from "../src/utils/dispelKind";
import {
  makeDispelAction,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const ev = (t: number, id: string, name: string) => ({
  timeSeconds: t,
  removedSpellId: id,
  removedSpellName: name,
});

describe("formatMinorDispelPart", () => {
  it("f4647408: two Greater Purges, three removals → ×2 casts with names", () => {
    expect(
      formatMinorDispelPart({
        spellName: "Greater Purge",
        passive: false,
        events: [
          ev(60.066, "21562", "Power Word: Fortitude"),
          ev(112.649, "21562", "Power Word: Fortitude"),
          ev(112.649, "65081", "Body and Soul"),
        ],
      }),
    ).toBe(
      "Greater Purge ×2 (1:00 Power Word: Fortitude; 1:52 Power Word: Fortitude、Body and Soul)",
    );
  });
  it("WO3 #18 (eb8041ce): an Unstable Affliction removal says whether its silence landed, and is never folded into +N", () => {
    const ua = (t: number, landed: boolean) => ({
      ...ev(t, "1259790", "痛苦无常"),
      hasDispelPenalty: true,
      ...(landed ? { backlashCcSpellId: "196364" } : {}),
    });
    const out = formatMinorDispelPart({
      spellName: "Purify",
      passive: false,
      events: [
        ev(10, "172", "Corruption"),
        ev(20, "172", "Corruption"),
        ev(30, "172", "Corruption"),
        ev(40, "172", "Corruption"),
        ev(50, "172", "Corruption"),
        ua(140.76, false),
        ua(168.47, true),
      ],
    });
    expect(out).toBe(
      "Purify ×7 (0:10 Corruption; 0:20 Corruption; 0:30 Corruption; 0:40 Corruption; 2:20 Unstable Affliction — no backlash silence landed; 2:48 Unstable Affliction — backlash silence landed, +1)",
    );
  });
  it("more than four casts end in +N; removals ≤ 50 ms apart are one cast", () => {
    const out = formatMinorDispelPart({
      spellName: "Dispel Magic",
      passive: false,
      events: [
        ev(74.164, "48438", "Wild Growth"),
        ev(181.164, "33763", "Lifebloom"),
        ev(182.431, "774", "Rejuvenation"),
        ev(183.669, "774", "Rejuvenation"),
        ev(183.7, "1126", "Mark of the Wild"),
        ev(184.951, "1126", "Mark of the Wild"),
      ],
    });
    expect(out).toBe(
      "Dispel Magic ×5 (1:14 Wild Growth; 3:01 Lifebloom; 3:02 Rejuvenation; 3:03 Rejuvenation、Mark of the Wild, +1)",
    );
  });
  it("a passive part keeps the bare count", () => {
    expect(
      formatMinorDispelPart({
        spellName: "Phantasm (passive)",
        passive: true,
        events: [ev(1, "1", "a"), ev(2, "1", "a")],
      }),
    ).toBe("Phantasm (passive) x2");
  });
});

describe("F11: a rider that came with its own cast is not `(passive)`", () => {
  const TELEPORT = "48020"; // Demonic Circle: Teleport — on the rider list
  const TREE = "33891"; // Incarnation: Tree of Life — on the rider list
  const index = createCastMatchIndex();
  addCastToIndex(index, "lock", TELEPORT, "Demonic Circle: Teleport", 51_000);
  const d = (src: string, id: string, name: string, t: number) => ({
    srcUnitId: src,
    spellId: id,
    spellName: name,
    timestamp: t,
  });

  it("the list still makes it a rider, cast or no cast", () => {
    const pressed = d("lock", TELEPORT, "Demonic Circle: Teleport", 51_040);
    const unpressed = d("druid", TREE, "Incarnation: Tree of Life", 90_000);
    expect(classifyDispel(index, pressed)).toBe("rider");
    expect(classifyDispel(index, unpressed)).toBe("rider");
    expect(dispelCameWithOwnCast(index, pressed)).toBe(true);
    // leaving the form: the removal is credited to 33891, no cast of it
    expect(dispelCameWithOwnCast(index, unpressed)).toBe(false);
    // the window is the classifier's own: 1 s either side, not 1.001
    expect(
      dispelCameWithOwnCast(
        index,
        d("lock", TELEPORT, "Demonic Circle: Teleport", 52_001),
      ),
    ).toBe(false);
  });

  it("the tag follows the cast, and only on a rider", () => {
    expect(
      minorDispelPartTag({ dispelKind: "rider", riderOfOwnCast: true }),
    ).toBe(MINOR_DISPEL_RIDER_TAG);
    expect(minorDispelPartTag({ dispelKind: "rider" })).toBe(
      MINOR_DISPEL_PASSIVE_TAG,
    );
    expect(minorDispelPartTag({ dispelKind: "proc" })).toBe(
      MINOR_DISPEL_PASSIVE_TAG,
    );
    expect(minorDispelPartTag({ dispelKind: "deliberate" })).toBeUndefined();
    expect(MINOR_DISPEL_RIDER_TAG).not.toMatch(/passive/);
  });

  it("the fold keeps the two apart for one unit and one spell", () => {
    const e = (t: number, over: Partial<IDispelEvent>): IDispelEvent =>
      ({
        timeSeconds: t,
        sourceName: "Druid",
        dispelSpellName: "Incarnation: Tree of Life",
        removedSpellId: "1",
        removedSpellName: "Chilled",
        priority: "Low",
        dispelKind: "rider",
        ...over,
      }) as IDispelEvent;
    const lines: string[] = [];
    emitMinorDispelEntries({
      dispelSummary: {
        allyCleanse: [
          e(22, { riderOfOwnCast: true }),
          e(126, { riderOfOwnCast: true }),
          e(60, {}),
        ],
        ourPurges: [],
        hostilePurges: [],
      } as never,
      pid: (n: string) => `2(${n})`,
      enemyPid: (n: string) => `4(${n})`,
      enemyDispelSummary: undefined,
      addEntry: ((_: number, line: string) => lines.push(line)) as never,
      _allUnits: [],
    });
    expect(lines).toEqual([
      "0:22  [MINOR DISPELS]   2(Druid): Incarnation: Tree of Life (side effect of the cast) x2, Incarnation: Tree of Life (passive) (low-priority, folded)",
    ]);
  });
});

describe("purgeMatchesCast (F-P1)", () => {
  it("same target within 50 ms", () => {
    const p = { targetName: "X", timeSeconds: 10 };
    expect(purgeMatchesCast(p, { destUnitName: "X", timeSeconds: 10.04 })).toBe(
      true,
    );
    expect(purgeMatchesCast(p, { destUnitName: "X", timeSeconds: 10.06 })).toBe(
      false,
    );
    expect(purgeMatchesCast(p, { destUnitName: "Y", timeSeconds: 10 })).toBe(
      false,
    );
  });
});

describe("purgeMatchesCast — the cast must be the dispel (5677ba13 Holy Fire)", () => {
  it("a different spell on the same target in the same 50 ms does not match", () => {
    const p = { targetName: "X", timeSeconds: 10, dispelSpellId: "528" };
    expect(
      purgeMatchesCast(p, {
        destUnitName: "X",
        timeSeconds: 10,
        spellId: "14914",
      }),
    ).toBe(false);
    expect(
      purgeMatchesCast(p, {
        destUnitName: "X",
        timeSeconds: 10,
        spellId: "528",
      }),
    ).toBe(true);
    expect(purgeMatchesCast(p, { destUnitName: "X", timeSeconds: 10 })).toBe(
      true,
    );
  });
  it("codex review: two different ids that are both missing from the name table are not the same spell", () => {
    const p = { targetName: "X", timeSeconds: 10, dispelSpellId: "999999901" };
    expect(
      purgeMatchesCast(p, {
        destUnitName: "X",
        timeSeconds: 10,
        spellId: "999999902",
      }),
    ).toBe(false);
    // the same unknown id still matches itself
    expect(
      purgeMatchesCast(p, {
        destUnitName: "X",
        timeSeconds: 10,
        spellId: "999999901",
      }),
    ).toBe(true);
  });
});

describe("dispelPressedBy — a press on a teammate logged as the recipient's dispel (fact7 D18)", () => {
  const BANDAGE = "212640";
  const index = () => {
    const i = createCastMatchIndex();
    addCastToIndex(i, "hunter", BANDAGE, "Mending Bandage", 26_100, "warlock");
    return i;
  };
  const row = (timestamp: number, srcUnitId = "warlock") => ({
    srcUnitId,
    spellId: BANDAGE,
    spellName: "Mending Bandage",
    timestamp,
  });

  it("d2e6e70b 0:26: the hunter's cast aimed at the warlock explains the warlock's self rows", () => {
    expect(dispelPressedBy(index(), row(26_200))).toBe("hunter");
  });
  it("out of the match window, or a cast of the unit's own, names nobody", () => {
    expect(dispelPressedBy(index(), row(40_000))).toBeUndefined();
    const own = index();
    addCastToIndex(own, "warlock", BANDAGE, "Mending Bandage", 26_100);
    expect(dispelPressedBy(own, row(26_200))).toBeUndefined();
  });
  it("a cast aimed at another unit is not this unit's press", () => {
    expect(dispelPressedBy(index(), row(26_200, "priest"))).toBeUndefined();
  });
});

describe("reconstructDispelSummary — a pet's press on its owner is the owner's dispel", () => {
  const T0 = 1_000_000;
  const CHILLED = "205708";
  const MASTERS_CALL = "Master's Call";
  const summary = (ownerId: string) => {
    const hunter = makeUnit("hunter", {
      name: "Hunter-R-US",
      reaction: CombatUnitReaction.Friendly,
      actionOut: [
        {
          ...makeDispelAction(
            T0 + 23_000,
            "hunter",
            "hunter",
            "357148",
            CHILLED,
            "Chilled",
          ),
          spellName: MASTERS_CALL,
        },
      ],
    });
    const pet = makeUnit("pet", {
      name: "Raptor",
      ownerId,
      reaction: CombatUnitReaction.Friendly,
      spellCastEvents: [
        {
          ...makeSpellCastEvent(
            "53271",
            T0 + 23_000,
            "hunter",
            "Hunter-R-US",
            "pet",
            "Raptor",
          ),
          spellName: MASTERS_CALL,
        },
      ],
    });
    return reconstructDispelSummary(
      [hunter] as never,
      [] as never,
      { startTime: T0, endTime: T0 + 120_000 },
      [pet] as never,
    ).allyCleanse;
  };

  it("85a6cad9 0:23: the pet's cast is the hunter's press, filed under the hunter", () => {
    const [e] = summary("hunter");
    expect(e?.sourceName).toBe("Hunter-R-US");
    expect(e?.dispelKind).toBe("deliberate");
  });
  it("a pet with no owner on the log stays the actor", () => {
    expect(summary("0000000000000000")[0]?.sourceName).toBe("Raptor");
  });
});
