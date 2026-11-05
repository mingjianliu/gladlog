/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Work order 2026-10-14d Part 1 (second acceptance of PV390) — the fact
 * readings the batch aligned that no other test file pins:
 *  - #1: a CC re-APPLIED while its application is still open is that
 *    application (holder-side windows, the outgoing chain, the shared
 *    predicates);
 *  - #3: an aura the opposing side applied is not the victim's mitigation;
 *  - #9: an interrupt-immunity window reads through a re-broadcast;
 *  - #10: a unit in its own flying breath is held (`castBlockingAuraAt`).
 * #2 is in enemyDefChannelTarget.test.ts, #4 in ccTrinketAnalysis.test.ts,
 * #8 in castStopped.test.ts and eval's promptQuality.test.ts.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  castBlockingAuraAt,
  ownFlightIntervals,
} from "../src/utils/cannotCastIntervals";
import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import { whitelistedIntervalsInDeathWindow } from "../src/utils/counterfactual";
import {
  CAST_BACKED_REFRESH_MS,
  ccRecastBetween,
  reAppliedIsSameApplication,
} from "../src/utils/drAnalysis";
import { analyzeOutgoingCCChains } from "../src/utils/outgoingCcChains";
import {
  INTERRUPT_IMMUNE_MIN_LEFT_S,
  interruptImmuneLeftS,
  interruptImmuneNoteAt,
  interruptImmuneWindowAt,
  interruptImmuneWindows,
} from "../src/utils/talentBehaviors";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const S = (sec: number) => T0 + sec * 1000;
const combat = {
  startTime: T0,
  endTime: T0 + 300_000,
  startInfo: { zoneId: "1672" },
} as any;

const aura = (
  event: LogEvent,
  spellId: string,
  sec: number,
  src: string,
  dest: string,
  auraType = "DEBUFF",
) => {
  const parameters: unknown[] = [];
  parameters[11] = auraType;
  return {
    logLine: { event, timestamp: S(sec), parameters },
    timestamp: S(sec),
    spellId,
    spellName: spellId,
    srcUnitId: src,
    srcUnitName: src,
    destUnitId: dest,
    destUnitName: dest,
    effectiveAmount: 0,
  };
};

describe("#1 — a re-APPLIED CC with no REMOVED is the same application", () => {
  it("the shared predicate: same unless recast, or past the official length; unknown length → same", () => {
    expect(reAppliedIsSameApplication(S(10), S(11.4), 5, false)).toBe(true);
    expect(reAppliedIsSameApplication(S(10), S(11.4), 5, true)).toBe(false);
    expect(reAppliedIsSameApplication(S(10), S(16), 5, false)).toBe(false);
    expect(reAppliedIsSameApplication(S(10), S(60), null, false)).toBe(true);
  });

  it("ccRecastBetween: a cast after the opening, inside CAST_BACKED_REFRESH_MS, at the holder or untargeted", () => {
    const rogue = makeUnit("rogue", {
      spellCastEvents: [
        makeSpellCastEvent("408", S(10.001), "hunter"), // the opening cast
        makeSpellCastEvent("408", S(20), "hunter"),
      ],
    });
    // the opening cast itself is not a recast
    expect(ccRecastBetween([rogue], "408", "hunter", S(10), S(11.4))).toBe(
      false,
    );
    expect(ccRecastBetween([rogue], "408", "hunter", S(10), S(20.5))).toBe(
      true,
    );
    // too long before the re-application, or at another unit
    expect(
      ccRecastBetween(
        [rogue],
        "408",
        "hunter",
        S(10),
        S(20) + CAST_BACKED_REFRESH_MS + 1,
      ),
    ).toBe(false);
    expect(ccRecastBetween([rogue], "408", "mage", S(10), S(20.5))).toBe(false);
  });

  it("holder side: 483f7433's Kidney Shot re-sent 1.37 s in (no cast) is one 4.99 s window from 35.59", () => {
    const rogue = makeUnit("rogue", {
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [makeSpellCastEvent("408", S(35.593), "hunter")],
    });
    const hunter = makeUnit("hunter", {
      spec: CombatUnitSpec.Hunter_BeastMastery,
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "408", 35.594, "rogue", "hunter"),
        aura(LogEvent.SPELL_AURA_APPLIED, "408", 36.963, "rogue", "hunter"),
        aura(LogEvent.SPELL_AURA_REMOVED, "408", 40.584, "rogue", "hunter"),
      ],
    });
    const cc = analyzePlayerCCAndTrinket(hunter, [rogue], combat).ccInstances;
    expect(cc).toHaveLength(1);
    expect(cc[0]!.atSeconds).toBeCloseTo(35.594, 3);
    expect(cc[0]!.durationSeconds).toBeCloseTo(4.99, 2);
  });

  it("holder side: a recast after a lost REMOVED closes the open one at its official length, never at the recast (the 605 preview's 77 s Scatter Shot)", () => {
    const hunter = makeUnit("hunter", {
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [
        makeSpellCastEvent("213691", S(79), "pal"),
        makeSpellCastEvent("213691", S(155), "pal"),
      ],
    });
    const pal = makeUnit("pal", {
      spec: CombatUnitSpec.Paladin_Holy,
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "213691", 79.01, "hunter", "pal"),
        // no REMOVED logged
        aura(LogEvent.SPELL_AURA_APPLIED, "213691", 155.01, "hunter", "pal"),
        aura(LogEvent.SPELL_AURA_REMOVED, "213691", 156.0, "hunter", "pal"),
      ],
    });
    const cc = analyzePlayerCCAndTrinket(pal, [hunter], combat).ccInstances;
    expect(cc.map((c) => Math.round(c.atSeconds))).toEqual([79, 155]);
    expect(cc[0]!.durationSeconds).toBeLessThanOrEqual(3.01);
  });

  it("outgoing chain: the re-send keeps the first application (fa5e6c66 Psychic Scream 13.755, re-APPLIED 15.714)", () => {
    const pal = makeUnit("pal", {
      spec: CombatUnitSpec.Paladin_Holy,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "8122", 13.755, "priest", "pal"),
        aura(LogEvent.SPELL_AURA_APPLIED, "8122", 15.714, "priest", "pal"),
        aura(LogEvent.SPELL_AURA_REMOVED, "8122", 16.605, "priest", "pal"),
      ],
    });
    (pal as any).type = CombatUnitType.Player;
    const apps = analyzeOutgoingCCChains(
      [makeUnit("priest")] as any,
      [pal] as any,
      combat,
    )[0]!.applications;
    expect(apps).toHaveLength(1);
    expect(apps[0]!.atSeconds).toBeCloseTo(13.755, 3);
    expect(apps[0]!.durationSeconds).toBeCloseTo(2.85, 2);
  });
});

describe("#3 — an aura the opposing side applied is not the victim's mitigation", () => {
  const victimWith = (src: string) =>
    ({
      id: "mage",
      name: "Mage",
      reaction: CombatUnitReaction.Friendly,
      damageIn: [],
      advancedActions: [],
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "122470", 50, src, "mage"),
        aura(LogEvent.SPELL_AURA_REMOVED, "122470", 59, src, "mage"),
      ],
    }) as unknown as ICombatUnit;
  const player = CombatUnitType.Player;
  const units = {
    monk: {
      id: "monk",
      name: "monk",
      reaction: CombatUnitReaction.Hostile,
      type: player,
    },
    mage: {
      id: "mage",
      name: "Mage",
      reaction: CombatUnitReaction.Friendly,
      type: player,
    },
    // an enemy pet with a bare name that equals ours (agy 40-FT-90)
    pet: {
      id: "pet",
      name: "Mage",
      reaction: CombatUnitReaction.Hostile,
      type: CombatUnitType.Pet,
    },
  } as unknown as Record<string, ICombatUnit>;

  it("b711d4ac 4:33: an enemy Windwalker's Touch of Karma tether on our mage is dropped", () => {
    expect(
      whitelistedIntervalsInDeathWindow(
        victimWith("monk"),
        { ...combat, units },
        60,
      ).filter((iv) => iv.spellId === "122470"),
    ).toEqual([]);
  });

  it("an own pet named like the enemy player does not let the enemy's aura back in (agy 40-FT-91)", () => {
    const withPet = {
      ...units,
      ownPet: {
        id: "ownPet",
        name: "monk",
        reaction: CombatUnitReaction.Friendly,
        type: CombatUnitType.Pet,
      },
    } as unknown as Record<string, ICombatUnit>;
    expect(
      whitelistedIntervalsInDeathWindow(
        victimWith("monk"),
        { ...combat, units: withPet },
        60,
      ).filter((iv) => iv.spellId === "122470"),
    ).toEqual([]);
  });

  it("control: the same aura from the victim's own side is kept", () => {
    expect(
      whitelistedIntervalsInDeathWindow(
        victimWith("Mage"),
        { ...combat, units },
        60,
      ).map((iv) => iv.spellId),
    ).toEqual(["122470"]);
  });
});

describe("#9 — an interrupt-immunity window reads through a re-broadcast", () => {
  it("a REMOVED + APPLIED of the condition aura 1 ms apart does not end the window", () => {
    // Obsidian Mettle 378444: interrupt-immune while Obsidian Scales 363916
    const owner = (events: any[]) =>
      ({
        id: "o",
        info: { pvpTalents: ["378444"] },
        auraEvents: events,
      }) as never;
    const base = interruptImmuneWindows(
      owner([
        aura(LogEvent.SPELL_AURA_APPLIED, "363916", 10, "o", "o", "BUFF"),
        aura(LogEvent.SPELL_AURA_REMOVED, "363916", 18, "o", "o", "BUFF"),
      ]),
      combat,
    );
    expect(base.map((w) => [w.from, w.to])).toEqual([[S(10), S(18)]]);
    const split = interruptImmuneWindows(
      owner([
        aura(LogEvent.SPELL_AURA_APPLIED, "363916", 10, "o", "o", "BUFF"),
        aura(LogEvent.SPELL_AURA_REMOVED, "363916", 13, "o", "o", "BUFF"),
        aura(LogEvent.SPELL_AURA_APPLIED, "363916", 13.0005, "o", "o", "BUFF"),
        aura(LogEvent.SPELL_AURA_REMOVED, "363916", 18, "o", "o", "BUFF"),
      ]),
      combat,
    );
    expect(split.map((w) => [w.from, w.to])).toEqual(
      base.map((w) => [w.from, w.to]),
    );
  });
});

describe("GH #168 — interrupt-immune windows read DB2, not a talent list", () => {
  const windows = (auraId: string, pvpTalents: string[]) =>
    interruptImmuneWindows(
      {
        id: "o",
        info: { pvpTalents },
        auraEvents: [
          aura(LogEvent.SPELL_AURA_APPLIED, auraId, 10, "o", "o", "BUFF"),
          aura(LogEvent.SPELL_AURA_REMOVED, auraId, 15, "o", "o", "BUFF"),
        ],
      } as never,
      combat,
    );

  it("Zen Focus Tea is its own 5 s aura; Thunder Focus Tea opens nothing", () => {
    const zen = windows("209584", ["468430"]);
    expect(zen.map((w) => [w.from, w.to])).toEqual([[S(10), S(15)]]);
    expect(zen[0]!.reason).toBe("Zen Focus Tea");
    expect(zen[0]!.auraName).toBe("Zen Focus Tea");
    expect(windows("116680", ["468430"])).toEqual([]);
  });

  it("a tree talent's aura opens a window with no PvP talent (Spiritwalker's Aegis)", () => {
    expect(windows("378078", []).map((w) => w.reason)).toEqual([
      "Spiritwalker's Aegis",
    ]);
  });

  it("a baseline immunity opens a window (Unending Resolve)", () => {
    expect(windows("104773", []).map((w) => w.auraName)).toEqual([
      "Unending Resolve",
    ]);
  });

  it("Obsidian Scales keeps the talent gate and its two-part reason", () => {
    expect(windows("363916", [])).toEqual([]);
    const w = windows("363916", ["378444"]);
    expect(w.map((x) => x.reason)).toEqual([
      "Obsidian Mettle + Obsidian Scales",
    ]);
    expect(w.map((x) => x.auraName)).toEqual(["Obsidian Scales"]);
  });

  // fact from the base scan: 2 / 13 kicks landed inside "Obsidian Mettle +
  // Obsidian Scales" windows, every one on an ally's copy
  it("Obsidian Mettle covers the holder's own Scales, not an ally's copy", () => {
    const windowsOf = (src: string) =>
      interruptImmuneWindows(
        {
          id: "o",
          info: { pvpTalents: ["378444"] },
          auraEvents: [
            aura(LogEvent.SPELL_AURA_APPLIED, "363916", 10, src, "o", "BUFF"),
            aura(LogEvent.SPELL_AURA_REMOVED, "363916", 15, src, "o", "BUFF"),
          ],
        } as never,
        combat,
      );
    expect(windowsOf("o")).toHaveLength(1);
    expect(windowsOf("ally")).toEqual([]);
  });

  // codex G1 #1: the shared pairing, not one of its own
  it("a duplicate APPLIED does not lengthen a window with no REMOVED, and BROKEN ends one", () => {
    const windowsOf = (rows: any[]) => {
      const owner: any = {
        id: "o",
        info: {},
        auraEvents: rows,
        spellCastEvents: [],
      };
      return interruptImmuneWindows(owner, combat, new Map([["o", owner]])).map(
        (w) => [w.from, w.to],
      );
    };
    expect(
      windowsOf([
        aura(LogEvent.SPELL_AURA_APPLIED, "104773", 10, "o", "o", "BUFF"),
        aura(LogEvent.SPELL_AURA_APPLIED, "104773", 14, "o", "o", "BUFF"),
      ]),
    ).toEqual([[S(10), S(18)]]);
    expect(
      windowsOf([
        aura(LogEvent.SPELL_AURA_APPLIED, "33786", 10, "e", "o", "DEBUFF"),
        aura(LogEvent.SPELL_AURA_BROKEN, "33786", 12, "e", "o", "DEBUFF"),
      ]),
    ).toEqual([[S(10), S(12)]]);
  });

  // codex G1 #2: a press logged in the REMOVED's millisecond
  it("a window's last millisecond is out, its first in", () => {
    const w = [{ from: S(10), to: S(15) }];
    expect(interruptImmuneWindowAt(w, S(10))).toBe(w[0]);
    expect(interruptImmuneWindowAt(w, S(15) - 1)).toBe(w[0]);
    expect(interruptImmuneWindowAt(w, S(15))).toBeUndefined();
  });

  // user 2026-11-02: the channel line says how long the immunity has left
  describe("the channel note's seconds left", () => {
    const w = [
      { from: S(10), to: S(15), reason: "Precognition" },
      { from: S(14), to: S(18), reason: "Unending Resolve" },
      { from: S(30), to: S(30.4), reason: "Sanctified Ground" },
    ];
    it("runs through an immunity that starts before the first ends", () => {
      expect(interruptImmuneLeftS(w, S(12))).toBeCloseTo(6, 6);
      expect(interruptImmuneNoteAt(w, S(12))).toBe(
        "interrupt-immune (Precognition, 6.0s left)",
      );
    });
    it("is undefined with no immunity up", () => {
      expect(interruptImmuneLeftS(w, S(20))).toBeUndefined();
      expect(interruptImmuneNoteAt(w, S(20))).toBeUndefined();
    });
    it("gives way to the kicks under half a second left", () => {
      expect(INTERRUPT_IMMUNE_MIN_LEFT_S).toBe(0.5);
      expect(interruptImmuneLeftS(w, S(30))).toBeCloseTo(0.4, 6);
      expect(interruptImmuneNoteAt(w, S(30))).toBeUndefined();
      expect(interruptImmuneNoteAt(w, S(17.5))).toBe(
        "interrupt-immune (Unending Resolve, 0.5s left)",
      );
    });
  });
});

describe("#10 — a unit in its own flying breath is held", () => {
  it("castBlockingAuraAt reads the unit's Deep Breath; ownFlightIntervals pairs it", () => {
    const evoker = makeUnit("evo", {
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "357210", 20, "evo", "evo", "BUFF"),
        aura(LogEvent.SPELL_AURA_REMOVED, "357210", 23, "evo", "evo", "BUFF"),
      ],
    }) as unknown as ICombatUnit;
    expect(ownFlightIntervals(evoker)).toEqual([
      { from: S(20), to: S(23), spellId: "357210" },
    ]);
    expect(castBlockingAuraAt(evoker, new Set(["x"]), S(21))).toMatchObject({
      spellId: "357210",
      srcUnitId: "evo",
    });
    expect(castBlockingAuraAt(evoker, new Set(["x"]), S(24))).toBeUndefined();
  });
});
