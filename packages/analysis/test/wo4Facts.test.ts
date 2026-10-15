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
  analyzeOutgoingCCChains,
  CAST_BACKED_REFRESH_MS,
  ccRecastBetween,
  reAppliedIsSameApplication,
} from "../src/utils/drAnalysis";
import { interruptImmuneWindows } from "../src/utils/talentBehaviors";
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
    const owner = (events: any[]) => ({
      info: { pvpTalents: ["378444"] },
      auraEvents: events,
    });
    const base = interruptImmuneWindows(
      owner([
        aura(LogEvent.SPELL_AURA_APPLIED, "363916", 10, "o", "o", "BUFF"),
        aura(LogEvent.SPELL_AURA_REMOVED, "363916", 18, "o", "o", "BUFF"),
      ]),
      S(300),
    );
    expect(base.map((w) => [w.from, w.to])).toEqual([[S(10), S(18)]]);
    const split = interruptImmuneWindows(
      owner([
        aura(LogEvent.SPELL_AURA_APPLIED, "363916", 10, "o", "o", "BUFF"),
        aura(LogEvent.SPELL_AURA_REMOVED, "363916", 13, "o", "o", "BUFF"),
        aura(LogEvent.SPELL_AURA_APPLIED, "363916", 13.0005, "o", "o", "BUFF"),
        aura(LogEvent.SPELL_AURA_REMOVED, "363916", 18, "o", "o", "BUFF"),
      ]),
      S(300),
    );
    expect(split.map((w) => [w.from, w.to])).toEqual(
      base.map((w) => [w.from, w.to]),
    );
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
