/**
 * FT F22 (c) — Hypothermia, read off the unit's own 41425 aura.
 *
 * Ice Block puts Hypothermia on its caster and the game refuses Ice Block
 * under it (DB2 SpellAuraRestrictions: 45438 and 414658, ExcludeCasterAuraSpell
 * = 41425). The cooldown can be back inside the debuff (a second charge, a
 * Cold Snap reset), and the product then called Ice Block ready: 94 [RES]
 * rows in 76 of 3,520 contexts of the 605-file capture of 8c3275fa.
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { emitFriendlyDeathEntries } from "../src/context/matchTimelineSections";
import {
  buildResourceSnapshot,
  computeOnCDDisplayNames,
  computeReadyNames,
  RES_HYPOTHERMIA_RE_SRC,
} from "../src/context/resourceSnapshot";
import { buildKillSequenceBlock } from "../src/context/timelineHelpers";
import { ensureAnalysisData } from "../src/data/ensure";
import { spellEffectData } from "../src/data/spellEffectData";
import {
  HYPOTHERMIA_AURA_ID,
  HYPOTHERMIA_FALLBACK_SECONDS,
  HYPOTHERMIA_GATED_IDS,
  HYPOTHERMIA_SECONDS,
  hypothermiaStopsPress,
  hypothermiaUntil,
  ICE_BLOCK_SPELL_ID,
  type IMajorCooldownInfo,
  lockoutDebuffStopsPress,
  ownPressLockout,
} from "../src/utils/cooldowns";
import {
  buildDeathOutcomeSummary,
  IMMUNITY_SPELLS,
} from "../src/utils/deathOutcomeAnalysis";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const A = LogEvent.SPELL_AURA_APPLIED;
const R = LogEvent.SPELL_AURA_REMOVED;

const mage = (
  auras: Array<[LogEvent, number]>,
  diedAtS?: number,
): ReturnType<typeof makeUnit> =>
  makeUnit("M", {
    class: CombatUnitClass.Mage,
    spec: CombatUnitSpec.Mage_Frost,
    auraEvents: auras.map(([ev, s]) =>
      makeAuraEvent(ev, HYPOTHERMIA_AURA_ID, T0 + s * 1000, "M", "M", "DEBUFF"),
    ),
    deathRecords:
      diedAtS === undefined ? [] : [{ timestamp: T0 + diedAtS * 1000 }],
  } as never);

describe("Hypothermia: the official reads", () => {
  it("41425's official duration equals the fallback", () => {
    expect(spellEffectData[HYPOTHERMIA_AURA_ID]?.durationSeconds).toBe(
      HYPOTHERMIA_FALLBACK_SECONDS,
    );
    expect(HYPOTHERMIA_SECONDS).toBe(30);
  });

  it("one aura id: the immunity table's lockout for Ice Block is the same constant", () => {
    expect(IMMUNITY_SPELLS[ICE_BLOCK_SPELL_ID]?.lockoutSpellId).toBe(
      HYPOTHERMIA_AURA_ID,
    );
    expect(HYPOTHERMIA_GATED_IDS.has(ICE_BLOCK_SPELL_ID)).toBe(true);
  });
});

describe("hypothermiaUntil — both ends from the log", () => {
  it("applied → the REMOVED that closes it (a 20 s run is 20 s, not the official 30)", () => {
    const m = mage([
      [A, 10],
      [R, 30],
    ]);
    expect(hypothermiaUntil(m, 9.9, T0)).toBeUndefined();
    expect(hypothermiaUntil(m, 10, T0)).toBe(30);
    expect(hypothermiaUntil(m, 29.9, T0)).toBe(30);
    expect(hypothermiaUntil(m, 30.1, T0)).toBeUndefined();
  });

  it("0068182d: an APPLIED the log re-writes inside the run is not a new application", () => {
    // applied 84.2 (the press), re-written at 103.9, removed at 104.2
    const m = mage([
      [A, 84.2],
      [A, 103.9],
      [R, 104.2],
    ]);
    expect(hypothermiaUntil(m, 90, T0)).toBe(104.2);
    expect(hypothermiaUntil(m, 104, T0)).toBe(104.2);
    expect(hypothermiaUntil(m, 105, T0)).toBeUndefined();
  });

  it("no REMOVED in the log: the official length caps it", () => {
    const m = mage([[A, 10]]);
    expect(hypothermiaUntil(m, 39, T0)).toBe(10 + HYPOTHERMIA_SECONDS);
    expect(hypothermiaUntil(m, 41, T0)).toBeUndefined();
    // …and a re-written APPLIED does not move the cap
    const again = mage([
      [A, 10],
      [A, 25],
    ]);
    expect(hypothermiaUntil(again, 39, T0)).toBe(10 + HYPOTHERMIA_SECONDS);
    expect(hypothermiaUntil(again, 41, T0)).toBeUndefined();
  });

  it("the REMOVED the unit's own death wrote did not end it", () => {
    // removed at 25.386, UNIT_DIED at 25.400 (the cascade)
    const m = mage(
      [
        [A, 10],
        [R, 25.386],
      ],
      25.4,
    );
    expect(hypothermiaUntil(m, 20, T0)).toBe(10 + HYPOTHERMIA_SECONDS);
    expect(hypothermiaUntil(m, 25.4, T0)).toBe(10 + HYPOTHERMIA_SECONDS);
  });

  it("a second run after the first one's removal is its own", () => {
    const m = mage([
      [A, 10],
      [R, 30],
      [A, 49],
      [R, 69],
    ]);
    expect(hypothermiaUntil(m, 40, T0)).toBeUndefined();
    expect(hypothermiaUntil(m, 50, T0)).toBe(69);
  });
});

describe("the press predicates", () => {
  const m = mage([
    [A, 10],
    [R, 30],
  ]);
  const mate = makeUnit("X");
  it("hypothermiaStopsPress: Ice Block and Ice Cold under it; nothing else, and not after it", () => {
    expect(hypothermiaStopsPress(m, ICE_BLOCK_SPELL_ID, 20, T0)).toBe(true);
    expect(hypothermiaStopsPress(m, "414658", 20, T0)).toBe(true);
    expect(hypothermiaStopsPress(m, "342245", 20, T0)).toBe(false); // Alter Time
    expect(hypothermiaStopsPress(m, ICE_BLOCK_SPELL_ID, 31, T0)).toBe(false);
  });

  it("lockoutDebuffStopsPress (cd-hoarded, [DEFENSIVE AVAILABLE], [DEATH] Unused) holds both debuffs", () => {
    expect(
      lockoutDebuffStopsPress(m, ICE_BLOCK_SPELL_ID, m, [m, mate], 20, T0),
    ).toBe(true);
    expect(
      lockoutDebuffStopsPress(m, ICE_BLOCK_SPELL_ID, m, [m, mate], 31, T0),
    ).toBe(false);
    expect(lockoutDebuffStopsPress(m, "342245", m, [m, mate], 20, T0)).toBe(
      false,
    );
  });

  it("ownPressLockout names the debuff and its end", () => {
    expect(ownPressLockout(m, ICE_BLOCK_SPELL_ID, [m], 20, T0)).toEqual({
      debuff: "Hypothermia",
      untilS: 30,
    });
    expect(ownPressLockout(m, ICE_BLOCK_SPELL_ID, [m], 31, T0)).toBeUndefined();
    expect(ownPressLockout(m, "342245", [m], 20, T0)).toBeUndefined();
  });
});

describe("[RES]: Ice Block off cooldown under Hypothermia is `cd:Ice Block(Hypothermia Ns)`", () => {
  // two charges, one press at 10 s: the second charge is ready the whole time
  const iceBlock = {
    spellId: ICE_BLOCK_SPELL_ID,
    spellName: "Ice Block",
    tag: "Defensive",
    cooldownSeconds: 240,
    charges: 2,
    maxChargesDetected: 2,
    casts: [{ timeSeconds: 10 }],
    availableWindows: [],
    neverUsed: false,
  } as unknown as IMajorCooldownInfo;
  const owner = mage([
    [A, 10],
    [R, 30],
  ]);
  const deaths = { matchStartMs: T0, ownerUnit: owner };
  const row = (
    timeSeconds: number,
    extra: Partial<Parameters<typeof buildResourceSnapshot>[0]> = {},
  ) =>
    buildResourceSnapshot({
      timeSeconds,
      ownerCDs: [iceBlock],
      ownerName: "M-R",
      ownerSpec: "Frost Mage",
      teammateCDs: [],
      ccTrinketSummaries: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] },
      matchStartMs: T0,
      ownerUnit: owner,
      ...extra,
    } as never);

  it("under it: not in rdy, in cd with the debuff's remaining; after it: back in rdy with its charge", () => {
    expect(computeReadyNames(18, [iceBlock], [], deaths)).toEqual([]);
    expect(computeReadyNames(31, [iceBlock], [], deaths)).toEqual([
      "Ice Block",
    ]);
    const line = row(18.4);
    // the row is read at its rendered second (0:18): 30 − 18
    expect(line).toContain("Ice Block(Hypothermia 12s)");
    expect(line).toMatch(new RegExp(RES_HYPOTHERMIA_RE_SRC));
    expect(line).not.toMatch(/rdy:[^ ]*Ice Block/);
    expect(row(31)).toMatch(/rdy:Ice Block\[1\/2\]/);
  });

  it("Δ rows: the lockout is printed once, and the return is announced", () => {
    const first = row(11, {
      prevReadyNames: ["Ice Block"],
      prevOnCDNames: [],
    });
    expect(first).toContain("-Ice Block");
    expect(first).toContain("Ice Block(Hypothermia 19s)");
    const again = row(20, {
      prevReadyNames: [],
      prevOnCDNames: computeOnCDDisplayNames(11, [iceBlock], [], deaths),
    });
    expect(again).not.toContain("Hypothermia");
    const back = row(31, {
      prevReadyNames: [],
      prevOnCDNames: computeOnCDDisplayNames(20, [iceBlock], [], deaths),
    });
    expect(back).toContain("+Ice Block");
  });

  it("mutation: without the holder unit (a hand-built fixture) the entry reads ready, as before", () => {
    expect(computeReadyNames(18, [iceBlock], [])).toEqual(["Ice Block"]);
  });
});

// The three readers that name a save as pressable ask one predicate
// (`lockoutDebuffStopsPress`); two of them through real builders here. The
// mage pressed Ice Block at 10 s (one of two charges) and died at 25 s, under
// Hypothermia — its REMOVED written 14 ms before the death.
describe("a death under Hypothermia does not name Ice Block as available", () => {
  const DEATH_T = 25;
  const dyingMage = (withAura: boolean) => {
    const m = makeUnit("M", {
      name: "M-R",
      class: CombatUnitClass.Mage,
      spec: CombatUnitSpec.Mage_Frost,
      auraEvents: withAura
        ? [
            makeAuraEvent(A, HYPOTHERMIA_AURA_ID, 10_000, "M", "M", "DEBUFF"),
            makeAuraEvent(R, HYPOTHERMIA_AURA_ID, 24_986, "M", "M", "DEBUFF"),
          ]
        : [],
      deathRecords: [{ timestamp: DEATH_T * 1000 }],
    } as never);
    return m;
  };
  const iceBlock = {
    spellId: ICE_BLOCK_SPELL_ID,
    spellName: "Ice Block",
    tag: "Defensive",
    cooldownSeconds: 240,
    charges: 2,
    maxChargesDetected: 2,
    casts: [{ timeSeconds: 10 }],
    availableWindows: [],
    neverUsed: false,
  };

  const killSequence = (withAura: boolean) => {
    const m = dyingMage(withAura);
    return buildKillSequenceBlock({
      matchStartMs: 0,
      matchEndSeconds: DEATH_T + 5,
      owner: m,
      friends: [m],
      enemies: [],
      ownerCDs: [iceBlock],
      teammateCDs: [],
      enemyCDTimeline: { alignedBurstWindows: [], players: [] },
      ccTrinketSummaries: [],
      friendlyDeaths: [{ spec: "x", name: m.name, atSeconds: DEATH_T }],
      enemyDeaths: [],
      isHealer: false,
      pid: (n: string) => n,
      actorLabel: (n: string) => n,
    } as never).filter((l) => l.includes("[DEFENSIVE AVAILABLE]"));
  };
  it("kill sequence [DEFENSIVE AVAILABLE]: named without the debuff (the control), not under it", () => {
    expect(killSequence(false).join("\n")).toContain(
      "Ice Block available but unused",
    );
    expect(killSequence(true)).toEqual([]);
  });

  const deathLine = (withAura: boolean) => {
    const m = dyingMage(withAura);
    const entries: string[] = [];
    emitFriendlyDeathEntries<string>({
      friendlyDeaths: [{ spec: "Frost", name: m.name, atSeconds: DEATH_T }],
      unitsByName: new Map([[m.name, m]]),
      ccTrinketSummaries: [],
      owner: m,
      ownerCDs: [iceBlock] as never,
      teammateCDs: [],
      matchStartMs: 0,
      pid: (n) => n,
      requestSnapshotPlaceholder: () => "snap",
      addEntry: (_t, ...lines) => {
        entries.push(String(lines[0]));
      },
    });
    return entries.find((l) => l.includes("[DEATH]")) ?? "";
  };
  it("[DEATH] Unused: listed without the debuff (the control), not under it", () => {
    expect(deathLine(false)).toContain("Ice Block");
    expect(deathLine(true)).toContain("[DEATH]");
    expect(deathLine(true)).not.toContain("Ice Block");
  });
});

// `IMMUNITY_SPELLS[Ice Block].lockoutSpellId` read through the same reader:
// the interval walk it replaced ended the lockout at the REMOVED the mage's
// own death writes, a few ms before the death it was asked about.
describe("the immunity path (died with Ice Block available) asks hypothermiaUntil", () => {
  const died = (withAura: boolean) => {
    const m = makeUnit("p1", {
      spec: CombatUnitSpec.Mage_Frost,
      spellCastEvents: [
        makeSpellCastEvent("45438", T0 + 10_000, "p1", "Self", "p1", "Mage"),
        // Cold Snap brings the cooldown straight back; the debuff stays
        makeSpellCastEvent("235219", T0 + 12_000, "p1", "Self", "p1", "Mage"),
      ],
      auraEvents: withAura
        ? [
            makeAuraEvent(A, HYPOTHERMIA_AURA_ID, T0 + 10_000, "p1", "p1"),
            makeAuraEvent(R, HYPOTHERMIA_AURA_ID, T0 + 24_986, "p1", "p1"),
          ]
        : [],
    } as never);
    (m as unknown as { deathRecords: unknown[] }).deathRecords = [
      { timestamp: T0 + 25_000, event: LogEvent.UNIT_DIED, parameters: [] },
    ];
    return buildDeathOutcomeSummary(
      {
        startTime: T0,
        endTime: T0 + 300_000,
        startInfo: { zoneId: "1505" },
      } as never,
      [m],
      [{ playerName: "p1", ccInstances: [] }] as never,
    ).events.flatMap((e) => e.availableImmunities.map((i) => i.spellName));
  };
  it("the control: no debuff in the log → Ice Block is named; under it → not", () => {
    expect(died(false)).toEqual(["Ice Block"]);
    expect(died(true)).toEqual([]);
  });
});

// predicate-index 2026-10-11 (FT F22, item (1)), fixed 2026-10-24: the same
// gap for Forbearance — the interval walk ended it at the REMOVED the
// paladin's own death writes, so a death under a self Blessing of
// Protection's Forbearance read "died with Divine Shield available".
describe("the immunity path (died with Divine Shield available) asks selfForbearanceActiveAt", () => {
  const died = (withAura: boolean) => {
    const p = makeUnit("p1", {
      spec: CombatUnitSpec.Paladin_Holy,
      spellCastEvents: [
        makeSpellCastEvent("1022", T0 + 10_000, "p1", "Self", "p1", "Pala"),
      ],
      auraEvents: withAura
        ? [
            makeAuraEvent(A, "25771", T0 + 10_000, "p1", "p1"),
            makeAuraEvent(R, "25771", T0 + 24_986, "p1", "p1"),
          ]
        : [],
    } as never);
    (p as unknown as { deathRecords: unknown[] }).deathRecords = [
      { timestamp: T0 + 25_000, event: LogEvent.UNIT_DIED, parameters: [] },
    ];
    return buildDeathOutcomeSummary(
      {
        startTime: T0,
        endTime: T0 + 300_000,
        startInfo: { zoneId: "1505" },
      } as never,
      [p],
      [{ playerName: "p1", ccInstances: [] }] as never,
    ).events.flatMap((e) => e.availableImmunities.map((i) => i.spellName));
  };
  it("under Forbearance (its REMOVED written by the death) Divine Shield is not named", () => {
    expect(died(true)).not.toContain("Divine Shield");
  });
});
