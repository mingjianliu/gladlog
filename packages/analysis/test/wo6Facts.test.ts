/**
 * Work order 2026-10-15b (WO6) — fact items from the third re-eval's audits.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { extractOwnerCDBuffExpiry } from "../src/context/timelineHelpers";
import { emitBuffFadedEntries } from "../src/context/timelineSections/buffFaded";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  deathLockChain,
  deathLockChainText,
} from "../src/utils/cannotCastIntervals";
import { stasisReleasePressesMs } from "../src/utils/combatStates";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("WO6 #3 (n45) — a buff on several friendlies fades with the owner's copy", () => {
  const MI = "414664"; // Mass Invisibility: on the mage and on allies
  const broken = (s: number, by: string, byName: string, spell: string) => {
    const e = makeAuraEvent(
      LogEvent.SPELL_AURA_BROKEN_SPELL,
      MI,
      at(s),
      by,
      "player-1",
      "BUFF",
    );
    const parameters: (string | number)[] = [];
    parameters[11] = "469882";
    parameters[12] = spell;
    return {
      ...e,
      srcUnitName: byName,
      logLine: { ...e.logLine, parameters },
    };
  };
  const run = (ownerBroken: boolean, targetName?: string) => {
    const owner = makeUnit("player-1", {
      name: "Mage",
      class: CombatUnitClass.Mage,
      spec: CombatUnitSpec.Mage_Frost,
      info: {},
      spellCastEvents: [makeSpellCastEvent(MI, at(80), "player-1")],
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          MI,
          at(80),
          "player-1",
          "player-1",
          "BUFF",
        ),
        ...(ownerBroken
          ? [broken(81.2, "enemy-1", "Evoker", "Refining Fire")]
          : []),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          MI,
          at(81.2),
          "player-1",
          "player-1",
          "BUFF",
        ),
      ],
    });
    const mate = makeUnit("player-2", {
      name: "Mate",
      class: CombatUnitClass.Warrior,
      spec: CombatUnitSpec.Warrior_Arms,
      info: {},
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          MI,
          at(80),
          "player-1",
          "player-2",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          MI,
          at(80.5),
          "player-1",
          "player-2",
          "BUFF",
        ),
      ],
    });
    const enemy = makeUnit("enemy-1", {
      name: "Evoker",
      reaction: CombatUnitReaction.Hostile,
      info: {},
    });
    return extractOwnerCDBuffExpiry(
      [
        {
          spellId: MI,
          spellName: "Mass Invisibility",
          tag: "Defensive",
          casts: [{ timeSeconds: 80, ...(targetName ? { targetName } : {}) }],
          cooldownSeconds: 60,
          neverUsed: false,
          availableWindows: [],
        },
      ] as never,
      "player-1",
      [owner, mate] as never,
      T0,
      owner as never,
      [enemy] as never,
    );
  };

  it("reads the owner's own copy, not the first teammate's (dfcccbf2 1:20 → 1:21)", () => {
    const [e] = run(false);
    expect(e?.expiresAtSeconds).toBeCloseTo(81.2, 3);
  });

  it("a press on a teammate ends with the target's copy (Power Infusion: not the priest's talent copy)", () => {
    const [e] = run(false, "Mate");
    expect(e?.expiresAtSeconds).toBeCloseTo(80.5, 3);
  });

  it("states the break the log names (Refining Fire), not 'no dispel logged'", () => {
    const events = run(true);
    expect(events[0]).toMatchObject({
      cause: "broken",
      brokenBy: {
        spellName: "Refining Fire",
        unitId: "enemy-1",
        unitName: "Evoker",
      },
    });
    const lines: string[] = [];
    emitBuffFadedEntries({
      cdExpiryEvents: events,
      addEntry: (_s: number, line: string) => lines.push(line),
      actorLabel: (n: string) => n,
    } as never);
    expect(lines.join("\n")).toContain(
      "[BUFF FADED]   Mass Invisibility (broken by Evoker's Refining Fire)",
    );
  });
});

describe("agy 40-FT-98 #1 — two presses on two friendlies keep their own copies", () => {
  const IB = "102342"; // Ironbark, 12 s
  const copy = (dest: string, fromS: number, toS: number) => [
    makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      IB,
      at(fromS),
      "player-1",
      dest,
      "BUFF",
    ),
    makeAuraEvent(
      LogEvent.SPELL_AURA_REMOVED,
      IB,
      at(toS),
      "player-1",
      dest,
      "BUFF",
    ),
  ];
  it("B pressed at 10 (ran to 22), A at 12 (gone at 14): each press reads its own target's copy", () => {
    const owner = makeUnit("player-1", {
      name: "Druid",
      class: CombatUnitClass.Druid,
      spec: CombatUnitSpec.Druid_Restoration,
      info: {},
      spellCastEvents: [
        makeSpellCastEvent(IB, at(10), "player-2"),
        makeSpellCastEvent(IB, at(12), "player-3"),
      ],
    });
    const b = makeUnit("player-2", {
      name: "B",
      info: {},
      auraEvents: copy("player-2", 10, 22),
    });
    const a = makeUnit("player-3", {
      name: "A",
      info: {},
      auraEvents: copy("player-3", 12, 14),
    });
    const events = extractOwnerCDBuffExpiry(
      [
        {
          spellId: IB,
          spellName: "Ironbark",
          tag: "External",
          casts: [
            { timeSeconds: 10, targetName: "B" },
            { timeSeconds: 12, targetName: "A" },
          ],
          cooldownSeconds: 45,
          neverUsed: false,
          availableWindows: [],
        },
      ] as never,
      "player-1",
      [owner, b, a] as never,
      T0,
      owner as never,
    );
    expect(
      events.map((e) => [e.castAtSeconds, e.expiresAtSeconds, e.isEstimated]),
    ).toEqual([
      [10, 22, false],
      [12, 14, false],
    ]);
  });
});

describe("WO6 #4 (n25) — [HEALER CC]: two cannot-cast runs are not one chain", () => {
  const iv = (from: number, to: number, name: string) => ({
    from: at(from),
    to: at(to),
    lockout: false,
    name,
  });
  it("prints the free time between runs (82a2d681: Hex, 4.5 s free, Polymorph)", () => {
    const chain = deathLockChain(
      [iv(162.656, 163.709, "Hex"), iv(168.196, 171.199, "Polymorph")],
      at(172),
      12_000,
    );
    expect(deathLockChainText(chain, (l) => l.name)).toBe(
      "Hex … 4.5s free … Polymorph",
    );
  });
  it("agy 40-FT-98 #2: a lockout-only run between two CCs is not free time", () => {
    const lockout = { ...iv(106, 110, "Wind Shear"), lockout: true };
    const chain = deathLockChain(
      [iv(100, 104, "Psychic Scream"), lockout, iv(114, 120, "Polymorph")],
      at(120),
      30_000,
    );
    expect(deathLockChainText(chain, (l) => l.name)).toBe(
      "Psychic Scream … 6.0s free + 4.0s kick lockout / own flight … Polymorph",
    );
  });
  it("one run reads as before (Sleet → Scream → Polymorph)", () => {
    const chain = deathLockChain(
      [
        iv(104, 108, "Blinding Sleet"),
        iv(107.5, 112, "Psychic Scream"),
        iv(111.9, 116.4, "Polymorph"),
      ],
      at(118),
      12_000,
    );
    expect(deathLockChainText(chain, (l) => l.name)).toBe(
      "Blinding Sleet → Psychic Scream → Polymorph",
    );
  });
});

describe("WO6 #5 (n9) — the Stasis release is a press", () => {
  const READY = "370562";
  const evoker = (removedS: number, casts: Array<[string, number]>) =>
    makeUnit("player-1", {
      name: "Evoker",
      class: CombatUnitClass.Evoker,
      spec: CombatUnitSpec.Evoker_Preservation,
      info: {},
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          READY,
          at(193.037),
          "player-1",
          "player-1",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          READY,
          at(removedS),
          "player-1",
          "player-1",
          "BUFF",
        ),
      ],
      spellCastEvents: casts.map(([id, s]) =>
        makeSpellCastEvent(id, at(s), "player-1"),
      ),
    });
  it("141470d0: the ready aura off 6.25 s in, replays after, no SUCCESS → a press at the REMOVED", () => {
    expect(
      stasisReleasePressesMs(
        evoker(199.288, [
          ["355941", 199.307],
          ["364343", 199.569],
        ]) as never,
      ),
    ).toEqual([at(199.288)]);
  });
  it("a ready aura that ran its 30 s released on its own — no press", () => {
    expect(
      stasisReleasePressesMs(evoker(223.037, [["355941", 223.05]]) as never),
    ).toEqual([]);
  });
  it("one that came off with nothing replayed was lost, not released", () => {
    expect(stasisReleasePressesMs(evoker(199.288, []) as never)).toEqual([]);
  });
  it("0e0663e6: a logged 370564 SUCCESS in the REMOVED ms is the one press", () => {
    expect(
      stasisReleasePressesMs(
        evoker(199.288, [
          ["370564", 199.288],
          ["355941", 199.307],
        ]) as never,
      ),
    ).toEqual([at(199.288)]);
  });
});
