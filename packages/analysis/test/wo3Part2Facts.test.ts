/**
 * Work order 2026-10-14c Part 2 (user 2026-10-14: 「都可以落地」) — the fact
 * readings each group changed, one block per group:
 *  - G1: one aura re-broadcast is one application in the uncleansed window;
 *  - G2: Summon Infernal lasts as the aura its cast triggers;
 *  - G3: a cast BAR of the locked school inside the lock ends it;
 *  - G4: kick-eaten `ccInWindowS` counts only what stops every cast spell;
 *  - G5: a channelled control whose caster was interrupted at its removal
 *    ended with the channel, not by the holder's press;
 *  - G7: the rest of DB2 SpellMechanic 3 (disarm) in the disarm set;
 *  - G8: a Stasis release's replayed casts are not the post-kick switch.
 * G3's pressure half (`kickPressureFor`) is in `kickPressure.test.ts`.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { triggeredEffectAurasOfCast } from "../src/data/castEffectAuras";
import { ensureAnalysisData } from "../src/data/ensure";
import { SPELL_CATEGORIES } from "../src/data/spellCategories";
import { spellEffectData } from "../src/data/spellEffectData";
import { buffFullDurationForCaster } from "../src/utils/buffDuration";
import {
  analyzePlayerCCAndTrinket,
  ccEndedByOwnPress,
  CHANNEL_STOP_LEAD_MS,
  channelStoppedAtRemoval,
} from "../src/utils/ccTrinketAnalysis";
import { reconstructDispelSummary } from "../src/utils/dispelAnalysis";
import {
  makeAuraEvent,
  makeInterruptEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const combat = {
  startTime: T0,
  endTime: T0 + 300_000,
  startInfo: { zoneId: "1672" },
};
const enemy = () =>
  makeUnit("enemy-1", {
    name: "EnemyRogue",
    spec: CombatUnitSpec.Rogue_Subtlety,
    reaction: CombatUnitReaction.Hostile,
  });

describe("G1 — a re-broadcast is one application in the uncleansed window", () => {
  const aura = (event: LogEvent, s: number) => ({
    ...makeAuraEvent(event, "118", T0 + s * 1000, "enemy-1", "m"),
    spellName: "Polymorph",
  });
  const windows = (auraEvents: object[]) =>
    reconstructDispelSummary(
      [
        makeUnit("h", { name: "Healer", spec: CombatUnitSpec.Paladin_Holy }),
        makeUnit("m", {
          name: "Melee",
          spec: CombatUnitSpec.Warrior_Arms,
          auraEvents,
        }),
      ] as never,
      [enemy()] as never,
      combat as never,
    ).missedCleanseWindows;

  it("REMOVED + APPLIED in one ms mid-CC is one 6 s window, not two halves (s1/191-1-1049 Chaos Nova shape)", () => {
    const w = windows([
      aura(LogEvent.SPELL_AURA_APPLIED, 20),
      aura(LogEvent.SPELL_AURA_REMOVED, 22.4),
      aura(LogEvent.SPELL_AURA_APPLIED, 22.4),
      aura(LogEvent.SPELL_AURA_REMOVED, 26),
    ]);
    expect(w).toHaveLength(1);
    expect(w[0].durationSeconds).toBeCloseTo(6, 3);
  });

  it("control: a REMOVED and an APPLIED 50 ms apart are two applications — two short halves, no 6 s window (the old reading of the one-ms pair)", () => {
    const w = windows([
      aura(LogEvent.SPELL_AURA_APPLIED, 20),
      aura(LogEvent.SPELL_AURA_REMOVED, 22.4),
      aura(LogEvent.SPELL_AURA_APPLIED, 22.45),
      aura(LogEvent.SPELL_AURA_REMOVED, 26),
    ]);
    expect(w.some((x) => x.durationSeconds > 5)).toBe(false);
  });
});

describe("G2 — Summon Infernal lasts as the aura its cast triggers", () => {
  it("1122 (cast row 0.25 s) → 111685 (30 s), chained by EffectTriggerSpell", () => {
    expect(spellEffectData["1122"]?.durationSeconds).toBeLessThan(1);
    expect(triggeredEffectAurasOfCast("1122")).toContain("111685");
    expect(buffFullDurationForCaster("1122", undefined)).toBe(
      spellEffectData["111685"]!.durationSeconds,
    );
    expect(buffFullDurationForCaster("1122", undefined)).toBe(30);
  });

  it("the triggered aura itself and a cast with no triggered aura keep their own row", () => {
    expect(buffFullDurationForCaster("111685", undefined)).toBe(30);
    // Avenging Wrath: no sub-second row, nothing to read through
    expect(buffFullDurationForCaster("31884", undefined)).toBe(
      spellEffectData["31884"]!.durationSeconds,
    );
  });
});

/** A kick at 10 s on `interrupted`; `casts` / `starts` / the Stasis ready
 * aura's removal in seconds after the kick. */
function kicked(opts: {
  interrupted: [string, string];
  casts?: Array<[string, number]>;
  starts?: Array<[string, number]>;
  stasisRemovedAfterS?: number;
  spec?: CombatUnitSpec;
  moreInterrupts?: Array<[string, string, number]>;
  auras?: object[];
}) {
  const at = (dt: number) => T0 + 10_000 + dt * 1000;
  const player = makeUnit("player-1", {
    name: "Owner",
    spec: opts.spec ?? CombatUnitSpec.Shaman_Restoration,
    reaction: CombatUnitReaction.Friendly,
    actionIn: [
      makeInterruptEvent(
        "1766",
        "Kick",
        opts.interrupted[0],
        opts.interrupted[1],
        at(0),
        "enemy-1",
        "EnemyRogue",
      ),
      ...(opts.moreInterrupts ?? []).map(([id, name, dt]) =>
        makeInterruptEvent("1766", "Kick", id, name, at(dt), "enemy-1"),
      ),
    ],
    castStartEvents: (opts.starts ?? []).map(([id, dt]) => ({
      logLine: {
        event: LogEvent.SPELL_CAST_START,
        timestamp: at(dt),
        parameters: [],
      },
      spellId: id,
    })),
    spellCastEvents: (opts.casts ?? []).map(([id, dt]) =>
      makeSpellCastEvent(
        id,
        at(dt),
        "player-1",
        "Owner",
        "player-1",
        "Owner",
        0,
        `spell-${id}`,
      ),
    ),
    auraEvents: [
      ...(opts.auras ?? []),
      ...(opts.stasisRemovedAfterS === undefined
        ? []
        : [
            {
              logLine: {
                event: LogEvent.SPELL_AURA_REMOVED,
                timestamp: at(opts.stasisRemovedAfterS),
                parameters: [],
              },
              timestamp: at(opts.stasisRemovedAfterS),
              spellId: "370562",
              spellName: "Stasis",
              srcUnitId: "player-1",
              destUnitId: "player-1",
            },
          ]),
    ],
  });
  return analyzePlayerCCAndTrinket(player, [enemy()], combat)
    .interruptInstances;
}

describe("G3 — a locked-school cast bar inside the lock ends it", () => {
  // Cyclone 33786 / Healing Wave 77472 = Nature, silenceable
  it("a Nature bar that began 1.98 s into a Nature lock ends it there (6062daf2 shape)", () => {
    const [k] = kicked({
      interrupted: ["33786", "Cyclone"],
      starts: [["77472", 1.98]],
      // its SUCCESS after the modelled end (a SUCCESS inside would cut too)
      casts: [["77472", 3.5]],
    });
    expect(k!.lockEndedBySuccessS).toBeCloseTo(1.98, 5);
    // the modelled lockout is untouched
    expect(k!.lockoutDurationSeconds).toBe(3);
  });

  it("the earlier of a bar start and a SUCCESS is the end", () => {
    const [k] = kicked({
      interrupted: ["33786", "Cyclone"],
      starts: [["77472", 2.4]],
      casts: [["61295", 1.2]],
    });
    expect(k!.lockEndedBySuccessS).toBeCloseTo(1.2, 5);
  });

  it("a bar at or after the modelled end, or of a school outside the lock, is no cut", () => {
    expect(
      kicked({
        interrupted: ["33786", "Cyclone"],
        starts: [["77472", 3.0]],
      })[0]!.lockEndedBySuccessS,
    ).toBeNull();
    // Flash Heal 2061 = Holy, not locked by a Nature kick
    expect(
      kicked({ interrupted: ["33786", "Cyclone"], starts: [["2061", 1.0]] })[0]!
        .lockEndedBySuccessS,
    ).toBeNull();
  });

  it("a bar inside a Stasis replay is not a press", () => {
    expect(
      kicked({
        interrupted: ["33786", "Cyclone"],
        starts: [["77472", 1.3]],
        stasisRemovedAfterS: 1.02,
      })[0]!.lockEndedBySuccessS,
    ).toBeNull();
  });
});

describe("G4 — ccInWindowS counts only what stops every spell cast this round", () => {
  // Priest: Flash Heal 2061 = Holy, Mind Blast 8092 = Shadow
  const casts: Array<[string, number]> = [
    ["2061", -5],
    ["8092", -2],
  ];

  it("a second kick on the other school is not time the player could not act (r1008-128)", () => {
    const [k] = kicked({
      spec: CombatUnitSpec.Priest_Discipline,
      interrupted: ["2061", "Flash Heal"],
      casts,
      moreInterrupts: [["8092", "Mind Blast", 1]],
    });
    expect(k!.ccInWindowS).toBe(0);
  });

  it("control: a stun inside the window stops every spell and counts", () => {
    const stun = (event: LogEvent, dt: number) =>
      makeAuraEvent(event, "408", T0 + 10_000 + dt * 1000, "enemy-1");
    const [k] = kicked({
      spec: CombatUnitSpec.Priest_Discipline,
      interrupted: ["2061", "Flash Heal"],
      casts,
      auras: [
        stun(LogEvent.SPELL_AURA_APPLIED, 1),
        stun(LogEvent.SPELL_AURA_REMOVED, 3),
      ],
    });
    expect(k!.ccInWindowS).toBe(2);
  });
});

describe("G5 — a channel stopped at the removal ended the control", () => {
  const MIND_CONTROL = "605";
  const REMOVE_MS = T0 + 18_000;
  const priest = (interruptMs: number) =>
    makeUnit("priest", {
      name: "Priest",
      reaction: CombatUnitReaction.Hostile,
      actionIn: [
        {
          ...makeInterruptEvent(
            "6552",
            "Pummel",
            MIND_CONTROL,
            "Mind Control",
            interruptMs,
            "warrior",
          ),
          destUnitId: "priest",
        },
      ],
    });

  it("an interrupt on the caster from 50 ms before to 10 ms after the REMOVED (9c6ab747: 10 ms before)", () => {
    expect(CHANNEL_STOP_LEAD_MS).toBe(50);
    expect(
      channelStoppedAtRemoval(priest(REMOVE_MS - 10), MIND_CONTROL, REMOVE_MS),
    ).toBe(true);
    expect(
      channelStoppedAtRemoval(priest(REMOVE_MS + 10), MIND_CONTROL, REMOVE_MS),
    ).toBe(true);
    expect(
      channelStoppedAtRemoval(priest(REMOVE_MS - 60), MIND_CONTROL, REMOVE_MS),
    ).toBe(false);
    expect(
      channelStoppedAtRemoval(priest(REMOVE_MS + 11), MIND_CONTROL, REMOVE_MS),
    ).toBe(false);
    // not a channel (Polymorph), or no caster: never
    expect(
      channelStoppedAtRemoval(priest(REMOVE_MS - 10), "118", REMOVE_MS),
    ).toBe(false);
    expect(channelStoppedAtRemoval(undefined, MIND_CONTROL, REMOVE_MS)).toBe(
      false,
    );
  });

  it("ccEndedByOwnPress names no press for it when it is given the caster", () => {
    const mc = (event: LogEvent, ms: number) => ({
      ...makeAuraEvent(event, MIND_CONTROL, ms, "priest", "holder"),
      spellName: "Mind Control",
    });
    const holder = makeUnit("holder", {
      name: "Holder",
      auraEvents: [
        mc(LogEvent.SPELL_AURA_APPLIED, T0 + 12_000),
        mc(LogEvent.SPELL_AURA_REMOVED, REMOVE_MS),
      ],
      spellCastEvents: [
        makeSpellCastEvent(
          "7744",
          REMOVE_MS + 9,
          "holder",
          "Holder",
          "holder",
          "Holder",
          0,
          "Will of the Forsaken",
        ),
      ],
    });
    const cc = { spellId: MIND_CONTROL, atSeconds: 12, durationSeconds: 6 };
    // without the caster: the old reading
    expect(ccEndedByOwnPress(holder as never, cc, T0)).toEqual({
      kind: "press",
      spellName: "Will of the Forsaken",
    });
    expect(
      ccEndedByOwnPress(holder as never, cc, T0, priest(REMOVE_MS - 10)),
    ).toBeUndefined();
    // the caster's interrupt came long before: the press still ended it
    expect(
      ccEndedByOwnPress(holder as never, cc, T0, priest(REMOVE_MS - 500)),
    ).toEqual({ kind: "press", spellName: "Will of the Forsaken" });
  });
});

describe("G7 — DB2 SpellMechanic 3 (disarm) auras in the disarm set", () => {
  it("Faerie Swarm 209749 and Sticky Tar Bomb 407031 / 407032 are disarms", () => {
    for (const id of ["209749", "407031", "407032"])
      expect(SPELL_CATEGORIES[id]?.type).toBe("disarms");
    // the cast id 407028 puts up no aura of its own: not added
    expect(SPELL_CATEGORIES["407028"]).toBeUndefined();
  });
});

describe("G8 — a Stasis replay is not the post-kick switch", () => {
  // Cyclone 33786 = Nature lock; Flash Heal 2061 = Holy, outside it
  it("the first non-replayed cast of another school is the switch (141470d0 @198.2)", () => {
    const [k] = kicked({
      interrupted: ["33786", "Cyclone"],
      casts: [
        ["2061", 1.3],
        ["2061", 4.9],
      ],
      stasisRemovedAfterS: 1.02,
    });
    expect(k!.postKick).toBe("switched");
    expect(k!.switchDelayS).toBeCloseTo(4.9, 5);
  });

  it("control: without the Stasis release the 1.3 s cast is the switch", () => {
    const [k] = kicked({
      interrupted: ["33786", "Cyclone"],
      casts: [
        ["2061", 1.3],
        ["2061", 4.9],
      ],
    });
    expect(k!.switchDelayS).toBeCloseTo(1.3, 5);
  });
});
