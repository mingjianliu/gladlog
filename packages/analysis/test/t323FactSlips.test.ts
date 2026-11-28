/**
 * Pipeline T323 — three fact slips from the scan5 in-total audit (B report):
 *  (a) a teammate's Leap of Faith stops a cast bar: `[CAST STOPPED]` read
 *      "no control, silence or knockback landed on you then" (7686e97d r5
 *      2:46), the STAYED IN yards read as the player's own;
 *  (b) a kicked bar's second SPELL_CAST_FAILED row, in the interruption
 *      row's own millisecond, was filed as a refused press (c27cae13 r3);
 *  (c) The Hunt into a pet, held by no player, read a 0-s span (0a118f43 r1
 *      5:29). User rulings 2026-11-28: (a) "as a teammate's Leap of Faith
 *      pulled you"; (c) read the pet's copy when no player holds one.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { postKickFact } from "../src/analysis/candidateFindings";
import { CAST_STOPPED_NEAR_TEXT } from "../src/context/timelineSections/castStopped";
import { ensureAnalysisData } from "../src/data/ensure";
import { castBarOutcomesOf } from "../src/utils/castBarOutcomes";
import {
  anyForcedStopMs,
  forcedStopInstantsMs,
} from "../src/utils/castStopEvidence";
import {
  observedEffectEndSeconds,
  reconstructEnemyCDTimeline,
} from "../src/utils/enemyCDs";
import {
  FORCED_MOVE_TEXT,
  forcedMovesInRenderedSpan,
} from "../src/utils/forcedDisplacement";
import { makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const leap = (srcUnitId: string, destUnitId: string, timestamp: number) => ({
  spellId: "73325",
  spellName: "Leap of Faith",
  srcUnitId,
  srcUnitName: srcUnitId,
  destUnitId,
  destUnitName: destUnitId,
  timestamp,
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp, parameters: [] },
});

describe("T323 (a) — a teammate's Leap of Faith stopped the bar", () => {
  it("its cast row naming the player is `allyPulled`, and a forced stop", () => {
    const u = makeUnit("P1", { actionIn: [leap("priest", "P1", 166_353)] });
    const forced = forcedStopInstantsMs(u);
    expect(forced.allyPulled).toEqual([166_353]);
    expect(forced.gripped).toEqual([]);
    expect(anyForcedStopMs(forced)).toContain(166_353);
  });

  it("a Leap of Faith the player cast on someone else pulled nobody here", () => {
    const u = makeUnit("P1", {
      actionIn: [leap("P1", "mate", 166_353), leap("priest", "mate", 166_400)],
    });
    expect(forcedStopInstantsMs(u).allyPulled).toEqual([]);
  });

  it("the [CAST STOPPED] words are the STAYED IN line's, as the user worded them", () => {
    expect(FORCED_MOVE_TEXT.allyPull).toBe(
      "a teammate's Leap of Faith pulled you",
    );
    expect(CAST_STOPPED_NEAR_TEXT.allyPulled).toBe(
      " as a teammate's Leap of Faith pulled you",
    );
  });

  it("STAYED IN: a pull inside the span is a forced move, not the player's yards", () => {
    const start = 100_000;
    const u = makeUnit("P1", {
      actionIn: [leap("priest", "P1", start + 12_400)],
    });
    expect(forcedMovesInRenderedSpan(u, [], start, 10, 15)).toEqual([
      { atSeconds: 12.4, kind: "allyPull" },
    ]);
    expect(forcedMovesInRenderedSpan(u, [], start, 13, 15)).toEqual([]);
  });

  // codex 85-tk-L6-T323-1 #8: through the one bar reading the cancel ledger
  // and [CAST STOPPED] share — a stop 18 ms after the pull is no cancel
  const POLY = "118";
  const barOf = (extra: object) =>
    castBarOutcomesOf({
      unit: {
        ...makeUnit("P1", {
          castStartEvents: [
            {
              spellId: POLY,
              spellName: "Polymorph",
              srcUnitId: "P1",
              srcUnitName: "P1",
              destUnitId: "e",
              destUnitName: "e",
              timestamp: 165_353,
              logLine: {
                event: LogEvent.SPELL_CAST_START,
                timestamp: 165_353,
                parameters: [],
              },
            },
          ] as never,
          actionIn: [leap("priest", "P1", 166_353)],
        }),
        ...extra,
      } as never,
      startMs: 0,
      failed: [
        {
          tSeconds: 166.371,
          unitGuid: "P1",
          spellId: Number(POLY),
          spellName: "Polymorph",
          reason: "Interrupted",
        },
      ],
    })[0]!.end;

  it("the bar the pull stopped reads `allyPulled`, not a cancel", () => {
    expect(barOf({})).toEqual({
      kind: "stopped",
      atS: 166.371,
      near: "allyPulled",
    });
  });

  it("a pull the player was immune to is no pull (codex #5)", () => {
    const immune = {
      missesIn: [
        {
          spellId: "73325",
          srcUnitId: "priest",
          timestamp: 166_353,
          missType: "IMMUNE",
        },
      ],
    };
    expect(
      forcedStopInstantsMs({
        ...makeUnit("P1", { actionIn: [leap("priest", "P1", 166_353)] }),
        ...immune,
      } as never).allyPulled,
    ).toEqual([]);
    expect(barOf(immune)).toEqual({
      kind: "stopped",
      atS: 166.371,
      near: null,
    });
  });
});

const failed = (t: number, spellId: number, reason: string) => ({
  tSeconds: t,
  unitGuid: "P1",
  spellId,
  spellName: `spell-${spellId}`,
  reason,
});

describe("T323 (b) — a kicked bar's second FAILED row is the bar, not a press", () => {
  // Spear Hand Strike on a Polymorph at 56.5; Disrupt kicks the Unstable
  // Affliction bar at 61.150, which writes "Interrupted" and "Another action
  // is in progress" in one millisecond
  const first = {
    atSeconds: 56.5,
    lockoutDurationSeconds: 6,
    postKick: "acted" as const,
    firstActionDelayS: 4.6,
    switchSpellName: "Unstable Affliction",
    switchDelayS: 4.6,
    switchWasHardCast: true,
    interruptedSpellId: "118",
    kickSpellName: "Spear Hand Strike",
  };
  const disrupt = {
    atSeconds: 61.15,
    lockoutDurationSeconds: 3,
    interruptedSpellId: "316099",
    kickSpellId: "183752",
    kickSpellName: "Disrupt",
  };

  it("one bar kicked again, nothing refused for another reason", () => {
    const f = postKickFact(
      first,
      [
        failed(61.15, 316099, "Interrupted"),
        failed(61.15, 316099, "Another action is in progress"),
      ],
      [],
      [first, disrupt],
    );
    expect(f).toContain("kicked again 1x");
    expect(f).not.toContain("refused for another reason");
  });

  it("a row of another millisecond stays a refused press (the control)", () => {
    const f = postKickFact(
      first,
      [
        failed(61.15, 316099, "Interrupted"),
        failed(61.187, 316099, "Out of range"),
      ],
      [],
      [first, disrupt],
    );
    expect(f).toContain("kicked again 1x");
    expect(f).toContain("refused for another reason 1x — out of range");
  });

  it("an 'Out of range' in the kicked row's own millisecond is still a press (codex #4)", () => {
    const f = postKickFact(
      first,
      [
        failed(61.15, 316099, "Interrupted"),
        failed(61.15, 316099, "Out of range"),
      ],
      [],
      [first, disrupt],
    );
    expect(f).toContain("kicked again 1x");
    expect(f).toContain("refused for another reason 1x — out of range");
  });

  it("the companion reason in another locale is the bar too", () => {
    const f = postKickFact(
      first,
      [
        failed(61.15, 316099, "Interrupted"),
        failed(61.15, 316099, "另外一个动作正在进行中"),
      ],
      [],
      [first, disrupt],
    );
    expect(f).not.toContain("refused for another reason");
  });
});

const T0 = 1_000_000;
const HUNT = "370965";
const huntCaster = (s: number) =>
  ({
    id: "dh",
    name: "DH",
    type: CombatUnitType.Player,
    reaction: CombatUnitReaction.Friendly,
    class: CombatUnitClass.DemonHunter,
    spec: CombatUnitSpec.DemonHunter_Havoc,
    spellCastEvents: [
      {
        spellId: HUNT,
        spellName: "The Hunt",
        srcUnitId: "dh",
        logLine: {
          event: LogEvent.SPELL_CAST_SUCCESS,
          timestamp: T0 + s * 1000,
        },
      },
    ],
    // the charge: the cast's own aura on the caster, 0.37 s (0a118f43 r1)
    auraEvents: [
      aura("dh", HUNT, LogEvent.SPELL_AURA_APPLIED, s),
      aura("dh", HUNT, LogEvent.SPELL_AURA_REMOVED, s + 0.367),
    ],
    damageIn: [],
    damageOut: [],
    healOut: [],
    healIn: [],
  }) as never;
function aura(dest: string, spellId: string, event: LogEvent, s: number) {
  return {
    spellId,
    spellName: "The Hunt",
    srcUnitId: "dh",
    srcUnitName: "DH",
    destUnitId: dest,
    timestamp: T0 + s * 1000,
    logLine: { event, timestamp: T0 + s * 1000 },
  };
}
const holder = (id: string, type: CombatUnitType, auraEvents: unknown[]) => ({
  id,
  name: id,
  type,
  reaction: CombatUnitReaction.Hostile,
  auraEvents,
});
const huntSpan = (units: Record<string, unknown>) => {
  const u = huntCaster(329.05);
  const combat = {
    startTime: T0,
    endTime: T0 + 400_000,
    units: { dh: u, ...units },
  } as never;
  const cd = reconstructEnemyCDTimeline([u], combat).players[0]!
    .offensiveCDs[0]!;
  return { from: cd.castTimeSeconds, to: cd.buffEndSeconds };
};
const dotRows = (dest: string, from: number, to: number) => [
  aura(dest, "370970", LogEvent.SPELL_AURA_APPLIED, from),
  aura(dest, "370969", LogEvent.SPELL_AURA_APPLIED, from),
  aura(dest, "370970", LogEvent.SPELL_AURA_REMOVED, from + 1.5),
  aura(dest, "370969", LogEvent.SPELL_AURA_REMOVED, to),
];

describe("T323 (c) — The Hunt held by no player runs on the pet's copy", () => {
  it("into a Water Elemental: 5:29 to the DoT's end on the pet, not the charge's end", () => {
    const s = huntSpan({
      pet: holder(
        "pet",
        CombatUnitType.Guardian,
        dotRows("pet", 329.42, 335.43),
      ),
    });
    expect(s.from).toBeCloseTo(329.05, 3);
    expect(s.to).toBeCloseTo(335.43, 2);
  });

  it("with the caster's charge alone (no pet copy) the span stays the charge's", () => {
    expect(huntSpan({}).to).toBeCloseTo(329.417, 2);
  });

  it("a copy on the caster's OWN pet is not read (Bestial Wrath's longer pet copy)", () => {
    const own = holder(
      "pet",
      CombatUnitType.Guardian,
      dotRows("pet", 329.42, 335.43),
    );
    expect(
      huntSpan({ pet: { ...own, reaction: CombatUnitReaction.Friendly } }).to,
    ).toBeCloseTo(329.417, 2);
  });

  it("FT F13 stands: a player's copy is the span, the pet's longer one is not", () => {
    const s = huntSpan({
      v: holder("v", CombatUnitType.Player, dotRows("v", 329.42, 333.9)),
      pet: holder(
        "pet",
        CombatUnitType.Guardian,
        dotRows("pet", 329.42, 335.43),
      ),
    });
    expect(s.to).toBeCloseTo(333.9, 2);
  });

  const pet = (rows: unknown[], extra: object = {}) => ({
    pet: { ...holder("pet", CombatUnitType.Guardian, rows), ...extra },
  });

  it("codex #2: a player's copy the press refreshed keeps the players' chain", () => {
    const s = huntSpan({
      v: holder("v", CombatUnitType.Player, [
        aura("v", "370969", LogEvent.SPELL_AURA_APPLIED, 325),
        aura("v", "370969", LogEvent.SPELL_AURA_REFRESH, 329.1),
        aura("v", "370969", LogEvent.SPELL_AURA_REMOVED, 329.3),
      ]),
      ...pet(dotRows("pet", 329.42, 335.43)),
    });
    expect(s.to).toBeLessThan(330);
  });

  it("codex #3: a pet's re-applied DoT is stitched as a player's would be", () => {
    const rows = [
      aura("X", "370969", LogEvent.SPELL_AURA_APPLIED, 329.42),
      aura("X", "370969", LogEvent.SPELL_AURA_REMOVED, 332.0),
      aura("X", "370969", LogEvent.SPELL_AURA_APPLIED, 332.2),
      aura("X", "370969", LogEvent.SPELL_AURA_REMOVED, 335.43),
    ];
    const on = (dest: string) => rows.map((r) => ({ ...r, destUnitId: dest }));
    const asPlayer = huntSpan({
      v: holder("v", CombatUnitType.Player, on("v")),
    }).to;
    const asPet = huntSpan(pet(on("pet"))).to;
    expect(asPet).toBeCloseTo(asPlayer, 3);
  });

  it("codex #3: the pet reading picks the aura the player reading picks", () => {
    const rows = [
      aura("X", "370969", LogEvent.SPELL_AURA_APPLIED, 329.42),
      aura("X", "370970", LogEvent.SPELL_AURA_APPLIED, 329.42),
      aura("X", "370969", LogEvent.SPELL_AURA_REMOVED, 330.12),
      aura("X", "370970", LogEvent.SPELL_AURA_REMOVED, 330.92),
    ];
    const on = (dest: string) => rows.map((r) => ({ ...r, destUnitId: dest }));
    const asPlayer = huntSpan({
      v: holder("v", CombatUnitType.Player, on("v")),
    }).to;
    expect(huntSpan(pet(on("pet"))).to).toBeCloseTo(asPlayer, 3);
  });

  it("codex #6: a neutral unit is not the other side", () => {
    expect(
      huntSpan(
        pet(dotRows("pet", 329.42, 335.43), {
          reaction: CombatUnitReaction.Neutral,
        }),
      ).to,
    ).toBeCloseTo(329.417, 2);
  });

  it("codex #7: another caster's copy with the same name is not this press's", () => {
    const rows = dotRows("pet", 329.42, 335.43).map((r) => ({
      ...r,
      srcUnitId: "other-dh",
    }));
    expect(huntSpan(pet(rows)).to).toBeCloseTo(329.417, 2);
  });
});

describe("T323 (c) — codex #1: an effect aura with the cast's own id", () => {
  // Deathmark 360194: the target's aura is the cast's id
  const DM = "360194";
  const rogue = {
    id: "dh",
    name: "DH",
    type: CombatUnitType.Player,
    reaction: CombatUnitReaction.Friendly,
    class: CombatUnitClass.Rogue,
    spec: CombatUnitSpec.Rogue_Assassination,
    spellCastEvents: [
      {
        spellId: DM,
        spellName: "Deathmark",
        srcUnitId: "dh",
        logLine: {
          event: LogEvent.SPELL_CAST_SUCCESS,
          timestamp: T0 + 329.05 * 1000,
        },
      },
    ],
    auraEvents: [],
    damageIn: [],
    damageOut: [],
    healOut: [],
    healIn: [],
  } as never;
  const dm = (dest: string, event: LogEvent, s: number) => ({
    ...aura(dest, DM, event, s),
    spellName: "Deathmark",
  });
  const spanWith = (id: string, type: CombatUnitType) => {
    const combat = {
      startTime: T0,
      endTime: T0 + 400_000,
      units: {
        dh: rogue,
        [id]: holder(id, type, [
          dm(id, LogEvent.SPELL_AURA_APPLIED, 329.06),
          dm(id, LogEvent.SPELL_AURA_REMOVED, 333),
        ]),
      },
    } as never;
    return reconstructEnemyCDTimeline([rogue], combat).players[0]!
      .offensiveCDs[0]!.buffEndSeconds;
  };
  it("on a pet it ends where it ended on a player", () => {
    expect(spanWith("v", CombatUnitType.Player)).toBeCloseTo(333, 2);
    expect(spanWith("pet", CombatUnitType.Guardian)).toBeCloseTo(333, 2);
  });
});

describe("T323 (c) — codex 85-tk-L6-T323-2", () => {
  const pet = (rows: unknown[]) => ({
    pet: holder("pet", CombatUnitType.Guardian, rows),
  });

  it("#1: only the offensive timeline reads the pet; another reader keeps the caster's copy", () => {
    const u = huntCaster(329.05);
    const combat = {
      startTime: T0,
      endTime: T0 + 400_000,
      units: { dh: u, ...pet(dotRows("pet", 329.42, 335.43)) },
    } as never;
    expect(
      observedEffectEndSeconds(u, HUNT, 329.05, Infinity, combat),
    ).toBeCloseTo(329.417, 2);
    expect(huntSpan(pet(dotRows("pet", 329.42, 335.43))).to).toBeCloseTo(
      335.43,
      2,
    );
  });

  it("#2: a pet copy refreshed with no removal is no observed end, not the charge's", () => {
    const s = huntSpan(
      pet([
        aura("pet", "370969", LogEvent.SPELL_AURA_APPLIED, 329.42),
        aura("pet", "370969", LogEvent.SPELL_AURA_REFRESH, 332),
      ]),
    );
    expect(s.to).toBeGreaterThan(334);
  });

  it("#5: a same-name caster's player copy does not veto this press's pet copy", () => {
    const other = holder("v", CombatUnitType.Player, [
      {
        ...aura("v", "370969", LogEvent.SPELL_AURA_APPLIED, 326),
        srcUnitId: "dh2",
      },
      {
        ...aura("v", "370969", LogEvent.SPELL_AURA_REMOVED, 330),
        srcUnitId: "dh2",
      },
    ]);
    const s = huntSpan({ v: other, ...pet(dotRows("pet", 329.42, 335.43)) });
    expect(s.to).toBeCloseTo(335.43, 2);
  });

  // #3 / #4: an effect laid along the press's flight (Breath of Eons 442204,
  // Temporal Wound 409560, T122)
  const BOE = "442204";
  const WOUND = "409560";
  const evoker = {
    id: "dh",
    name: "DH",
    type: CombatUnitType.Player,
    reaction: CombatUnitReaction.Friendly,
    class: CombatUnitClass.Evoker,
    spec: CombatUnitSpec.Evoker_Augmentation,
    spellCastEvents: [
      {
        spellId: BOE,
        spellName: "Breath of Eons",
        srcUnitId: "dh",
        logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + 10_000 },
      },
    ],
    auraEvents: [
      {
        ...aura("dh", BOE, LogEvent.SPELL_AURA_APPLIED, 10),
        spellName: "Breath of Eons",
      },
      {
        ...aura("dh", BOE, LogEvent.SPELL_AURA_REMOVED, 13.75),
        spellName: "Breath of Eons",
      },
    ],
    damageIn: [],
    damageOut: [],
    healOut: [],
    healIn: [],
  } as never;
  const wound = (dest: string, from: number, to?: number) => [
    {
      ...aura(dest, WOUND, LogEvent.SPELL_AURA_APPLIED, from),
      spellName: "Temporal Wound",
    },
    ...(to === undefined
      ? []
      : [
          {
            ...aura(dest, WOUND, LogEvent.SPELL_AURA_REMOVED, to),
            spellName: "Temporal Wound",
          },
        ]),
  ];
  const boeSpan = (units: Record<string, unknown>) => {
    const combat = {
      startTime: T0,
      endTime: T0 + 200_000,
      units: { dh: evoker, ...units },
    } as never;
    const cd = reconstructEnemyCDTimeline([evoker], combat).players[0]!
      .offensiveCDs[0];
    return cd?.buffEndSeconds;
  };

  it("#3: a wound laid on the pet during the flight ends the span, as on a player", () => {
    const onPlayer = boeSpan({
      v: holder("v", CombatUnitType.Player, wound("v", 12.004, 22.457)),
    });
    expect(onPlayer).toBeCloseTo(22.457, 2);
    expect(boeSpan(pet(wound("pet", 12.004, 22.457)))).toBeCloseTo(22.457, 2);
  });

  it("#4: a player's open wound keeps the players' reading over a pet's closed one", () => {
    const withPlayer = boeSpan({
      v: holder("v", CombatUnitType.Player, wound("v", 12.004)),
      ...pet(wound("pet", 11, 17)),
    });
    expect(withPlayer).not.toBeCloseTo(17, 1);
  });
});
