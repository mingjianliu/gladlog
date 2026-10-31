/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the checks read them untyped */
import { ensureAnalysisData } from "@gladlog/analysis";
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { run as runCastThroughStun } from "../scripts/scan5/castThroughStun";
import { run as runDamageBasis } from "../scripts/scan5/damageBasis";
import { run as runKillAttemptFacts } from "../scripts/scan5/killAttemptFacts";
import { run as runPressFiling } from "../scripts/scan5/pressFiling";
import { run as runSpanFacts } from "../scripts/scan5/spanFacts";

// fact7 r1: six corpus checks that kept firing after their 15-round fixes hit 0.
// Each `reads` case is a shape the raw log proved right while the check flagged
// it; each `flags` case is the audited defect, which must stay caught.

const START = 1_000_000;
const at = (ms: number): number => START + ms;

const rowOf = (event: string, ms: number, extra: Record<string, unknown>) => ({
  timestamp: at(ms),
  logLine: { event, timestamp: at(ms) },
  ...extra,
});
const aura = (event: string, ms: number, spellId: string, spellName: string) =>
  rowOf(event, ms, { spellId, spellName, srcUnitId: "ext" });
const landed = (ms: number, srcUnitId: string, amount: number, spellId = "1") =>
  rowOf(LogEvent.SPELL_DAMAGE, ms, {
    srcUnitId,
    spellId,
    spellName: "Hit",
    effectiveAmount: -amount,
  });
const absorbed = (
  ms: number,
  attackerId: string,
  amount: number,
  spellId = "17",
) =>
  rowOf(LogEvent.SPELL_ABSORBED, ms, {
    attackerId,
    spellId,
    spellName: "Shield",
    attackSpellId: "1",
    absorbedAmount: amount,
  });
const cast = (
  ms: number,
  srcUnitId: string,
  spellId: string,
  spellName: string,
  destUnitId?: string,
) =>
  rowOf(LogEvent.SPELL_CAST_SUCCESS, ms, {
    srcUnitId,
    srcUnitName: srcUnitId,
    spellId,
    spellName,
    destUnitId,
    destUnitName: destUnitId,
  });

interface IViolation {
  check: string;
  kind: string;
  detail: string;
}

function scan(
  run: (ctx: any) => void,
  players: any[],
  lines: string[],
  menu = "",
  rawLines: string[] = [],
  roundEndAt = at(600_000),
): IViolation[] {
  const seen: IViolation[] = [];
  const byName = new Map(players.map((p) => [p.name, p]));
  run({
    lines,
    menu,
    rawLines,
    players,
    units: players,
    byName,
    owner: players[0],
    unitOfPid: (pid: string | undefined) => players.find((p) => p.pid === pid),
    pidOf: (name: string) => players.find((p) => p.name === name)?.pid,
    start: START,
    end: at(600_000),
    roundEndAt,
    violate: (
      check: string,
      kind: string,
      _t: number,
      _f: string,
      detail: string,
    ) => seen.push({ check, kind, detail }),
    bump: () => {},
  });
  return seen;
}
const unit = (name: string, pid: string, reaction: number, more = {}) => ({
  id: name,
  name,
  pid,
  reaction,
  ...more,
});
const of = (seen: IViolation[], check: string): string[] =>
  seen.filter((v) => v.check === check).map((v) => v.detail);

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("duringExternalShare", () => {
  const during = (name: string, seconds: string, share: number) =>
    `0:10  [ENEMY DEF] 3(Healer) (monk): ${name} → 2(Target) (${seconds}s) | during it: 1(Ally) 10k on target · ${share}% of their enemy-player damage`;
  const team = (target: any[], other: any[]) => [
    unit("Ally", "1", 1),
    unit("Target", "2", 2, { ...target[0], damageIn: target[1] }),
    unit("Other", "4", 2, { damageIn: other }),
  ];
  const other = [landed(10_050, "Ally", 90_000)];

  it("reads to the aura's own REMOVED: the printed length is rounded (7b07c1de r6, 160 ms printed 0.2 s)", () => {
    const players = team(
      [
        {
          auraEvents: [
            aura(LogEvent.SPELL_AURA_APPLIED, 10_000, "116849", "Life Cocoon"),
            aura(LogEvent.SPELL_AURA_REMOVED, 10_160, "116849", "Life Cocoon"),
          ],
        },
        [landed(10_100, "Ally", 10_000), landed(10_160, "Ally", 66_000)],
      ],
      other,
    );
    expect(
      of(
        scan(runDamageBasis, players, [during("Life Cocoon", "0.2", 10)]),
        "duringExternalShare",
      ),
    ).toEqual([]);
  });

  it("opens at a REFRESH: a press on a holder writes no APPLIED (cb6f3e66 r5)", () => {
    const players = team(
      [
        {
          auraEvents: [
            aura(LogEvent.SPELL_AURA_APPLIED, 2_000, "357170", "Time Dilation"),
            aura(
              LogEvent.SPELL_AURA_REFRESH,
              10_871,
              "357170",
              "Time Dilation",
            ),
          ],
        },
        [landed(10_200, "Ally", 80_000), landed(11_000, "Ally", 10_000)],
      ],
      [landed(11_000, "Ally", 90_000)],
    );
    expect(
      of(
        scan(runDamageBasis, players, [during("Time Dilation", "5.0", 10)]),
        "duringExternalShare",
      ),
    ).toEqual([]);
  });

  it("opens at an aura up to 3 s after the printed press (45e12c2b r3, Blessing of Protection +1.2 s)", () => {
    const players = team(
      [
        {
          auraEvents: [
            aura(
              LogEvent.SPELL_AURA_APPLIED,
              11_571,
              "33206",
              "Pain Suppression",
            ),
          ],
        },
        [landed(10_500, "Ally", 80_000), landed(12_000, "Ally", 10_000)],
      ],
      [landed(12_000, "Ally", 90_000)],
    );
    expect(
      of(
        scan(runDamageBasis, players, [during("Pain Suppression", "8.0", 10)]),
        "duringExternalShare",
      ),
    ).toEqual([]);
  });

  it("sums a deferral row signed: a negative Fel Armor row is the rest of one hit (7308d15a r2)", () => {
    const players = team(
      [
        {
          auraEvents: [
            aura(LogEvent.SPELL_AURA_APPLIED, 10_000, "116849", "Life Cocoon"),
          ],
          absorbsIn: [
            absorbed(10_100, "Ally", -1480, "386124"),
            absorbed(10_100, "Ally", 1458),
            absorbed(10_100, "Ally", 247),
          ],
        },
        [],
      ],
      [landed(10_100, "Ally", 7_275)],
    );
    expect(
      of(
        scan(runDamageBasis, players, [during("Life Cocoon", "5.0", 3)]),
        "duringExternalShare",
      ),
    ).toEqual([]);
  });

  it("flags a share that left the absorbed part out (D6, D29)", () => {
    const players = team(
      [
        {
          auraEvents: [
            aura(LogEvent.SPELL_AURA_APPLIED, 10_000, "116849", "Life Cocoon"),
          ],
          absorbsIn: [absorbed(10_100, "Ally", 70_000)],
        },
        [],
      ],
      [landed(10_100, "Ally", 30_000)],
    );
    expect(
      of(
        scan(runDamageBasis, players, [during("Life Cocoon", "5.0", 0)]),
        "duringExternalShare",
      ),
    ).toHaveLength(1);
  });
});

describe("allyOverlapDeferral", () => {
  const lines = (printed: string) => [
    "Burst #1 — 0:10–0:30",
    `  Ally CDs overlapping: Ally Avatar 10.0s (their top target in it: Target ${printed}M)`,
  ];
  const players = (damageIn: any[], absorbsIn: any[], press: number) => [
    unit("Owner", "9", 1),
    unit("Ally", "1", 1, {
      spellCastEvents: [cast(press, "Ally", "107574", "Avatar", "Target")],
    }),
    unit("Target", "2", 2, { damageIn, absorbsIn }),
  ];

  it("clears an item the press's own span reads with no deferral row, whatever another span sums to", () => {
    const rows = players(
      [landed(15_500, "Ally", 1_000_000), landed(21_000, "Ally", 800_000)],
      [absorbed(25_000, "Ally", 200_000, "386124")],
      15_471,
    );
    expect(
      of(scan(runDamageBasis, rows, lines("1.00")), "allyOverlapDeferral"),
    ).toEqual([]);
  });

  it("flags a figure only the deferral rows by magnitude reach (D22, d2e6e70b 1.29M against 1.28M)", () => {
    const rows = players(
      [landed(15_500, "Ally", 1_280_000)],
      [absorbed(16_000, "Ally", -10_000, "386124")],
      15_471,
    );
    expect(
      of(scan(runDamageBasis, rows, lines("1.29")), "allyOverlapDeferral"),
    ).toHaveLength(1);
  });
});

describe("abilityIntoWallShare", () => {
  const dmg = (spellId: string, spellName: string, amount: number) =>
    rowOf(LogEvent.SPELL_DAMAGE, 5_000, {
      spellId,
      spellName,
      destUnitId: "Target",
      effectiveAmount: -amount,
    });
  const wall = (spellId: string, spellName: string) => [
    aura(LogEvent.SPELL_AURA_APPLIED, 30_000, spellId, spellName),
    aura(LogEvent.SPELL_AURA_REMOVED, 40_000, spellId, spellName),
  ];
  const presses = (spellId: string, spellName: string) =>
    [31_000, 33_000, 35_000].map((t) =>
      cast(t, "Ally", spellId, spellName, "Target"),
    );
  const line = (list: string, wallName: string) =>
    `  [0:30] Frost Mage (Ally): ${list} into Target's ${wallName}`;
  const team = (ally: any, target: any) => [
    unit("Ally", "1", 1, ally),
    unit("Target", "2", 2, target),
  ];

  it("a school the immunity leaves out is no cast into it (Obliterate into Spellwarding)", () => {
    const players = team(
      {
        damageOut: [
          dmg("49020", "Obliterate", 500),
          dmg("49143", "Frost Strike", 500),
        ],
        spellCastEvents: presses("49020", "Obliterate"),
      },
      { auraEvents: wall("204018", "Blessing of Spellwarding") },
    );
    expect(
      of(
        scan(runDamageBasis, players, [
          line("Frost Strike", "Blessing of Spellwarding"),
        ]),
        "abilityIntoWallShare",
      ),
    ).toEqual([]);
  });

  it("the 5 % is the legend's: absorbed hits count under their attack spell", () => {
    const eaten = rowOf(LogEvent.SPELL_ABSORBED, 5_000, {
      spellId: "17",
      spellName: "Shield",
      attackSpellId: "133",
      attackSpellName: "Fireball",
      destUnitId: "Target",
      effectiveAmount: 100_000,
    });
    const players = team(
      {
        damageOut: [
          dmg("108853", "Fire Blast", 6_000),
          dmg("133", "Fireball", 94_000),
          eaten,
        ],
        spellCastEvents: presses("108853", "Fire Blast"),
      },
      { auraEvents: wall("33206", "Pain Suppression") },
    );
    expect(
      of(
        scan(runDamageBasis, players, [line("Fireball", "Pain Suppression")]),
        "abilityIntoWallShare",
      ),
    ).toEqual([]);
  });

  it("one wall's list is both of its lines (Die by the Sword)", () => {
    const players = team(
      {
        damageOut: [
          dmg("12294", "Mortal Strike", 500),
          dmg("7384", "Overpower", 500),
        ],
        spellCastEvents: presses("7384", "Overpower"),
      },
      { auraEvents: wall("118038", "Die by the Sword") },
    );
    expect(
      of(
        scan(runDamageBasis, players, [
          line("Mortal Strike", "Die by the Sword"),
          line("Overpower", "Die by the Sword"),
        ]),
        "abilityIntoWallShare",
      ),
    ).toEqual([]);
  });

  describe("a wall's kill-live-gated part, with the target at 15 %", () => {
    const low = {
      auraEvents: wall("118038", "Die by the Sword"),
      advancedActions: [
        {
          ...rowOf(LogEvent.SPELL_DAMAGE, 32_000, {}),
          advancedActorId: "Target",
          advancedActorCurrentHp: 15,
          advancedActorMaxHp: 100,
        },
      ],
    };
    const players = (id: string, name: string) =>
      team(
        {
          damageOut: [dmg("12294", "Mortal Strike", 500), dmg(id, name, 500)],
          spellCastEvents: presses(id, name),
        },
        low,
      );
    const lines = [line("Mortal Strike", "Die by the Sword")];

    it("leaves out a ranged spell the wall only thins", () => {
      expect(
        of(
          scan(runDamageBasis, players("188196", "Lightning Bolt"), lines),
          "abilityIntoWallShare",
        ),
      ).toEqual([]);
    });

    it("flags a spell the log shows parried, whatever its reach (Final Verdict, 12 yd)", () => {
      const parry =
        '10/30/2026 12:00:32.000-4  SPELL_MISSED,Player-1-A,"Ally",0x511,0x0,Player-1-B,"Target",0x548,0x0,383328,"Final Verdict",0x2,PARRY,nil';
      const seen = (raw: string[]) =>
        of(
          scan(
            runDamageBasis,
            players("383328", "Final Verdict"),
            lines,
            "",
            raw,
          ),
          "abilityIntoWallShare",
        );
      expect(seen([])).toEqual([]);
      expect(seen([parry])).toHaveLength(1);
    });
  });

  it("flags a high-value spell cast into the wall and left off the line (D53)", () => {
    const players = team(
      {
        damageOut: [
          dmg("108853", "Fire Blast", 500),
          dmg("133", "Fireball", 500),
        ],
        spellCastEvents: presses("108853", "Fire Blast"),
      },
      { auraEvents: wall("33206", "Pain Suppression") },
    );
    expect(
      of(
        scan(runDamageBasis, players, [line("Fireball", "Pain Suppression")]),
        "abilityIntoWallShare",
      ),
    ).toHaveLength(1);
  });
});

describe("postCcAbsorbedUnsaid", () => {
  const menu = (facts: string) =>
    `  - id=missed-cleanse:Mate:8 type=missed-cleanse t=7.6s units=Mate facts={t=7.6, target=Mate, cc=Hammer of Justice, duration=5.0, postCcDamageK=0${facts}}`;
  const auras = [
    aura(LogEvent.SPELL_AURA_APPLIED, 7_614, "69369", "Predatory Swiftness"),
    aura(LogEvent.SPELL_AURA_APPLIED, 7_692, "853", "Hammer of Justice"),
  ];
  const absorbs = [
    absorbed(8_000, "Foe", 145_000),
    absorbed(12_650, "Foe", 11_800),
  ];

  it("runs the 5 s from the aura `cc=` names, not the second's first aura (b9aae137 r1)", () => {
    const players = [
      unit("Mate", "1", 1, { auraEvents: auras, absorbsIn: absorbs }),
    ];
    expect(
      of(
        scan(runDamageBasis, players, [], menu(", postCcAbsorbedK=157")),
        "postCcAbsorbedUnsaid",
      ),
    ).toEqual([]);
  });

  it("flags a row with no absorbed fact (D70)", () => {
    const players = [
      unit("Mate", "1", 1, { auraEvents: auras, absorbsIn: absorbs }),
    ];
    expect(
      of(scan(runDamageBasis, players, [], menu("")), "postCcAbsorbedUnsaid"),
    ).toHaveLength(1);
  });
});

describe("dispelPressOnAlly", () => {
  const stolen = (ms: number) =>
    rowOf("SPELL_STOLEN", ms, { spellId: "30449", spellName: "Spellsteal" });
  const line = "0:12  [MINOR DISPELS] 1(Jdmx): Spellsteal (passive)";
  const players = (from: any, mine: any[], actionOut: any[]) => [
    unit("Jdmx", "1", 1, { actionOut, spellCastEvents: mine }),
    from,
  ];

  it("a teammate's press long before is not behind this row (30846f8e r2, the repeat 4 s after his own press)", () => {
    const mate = unit("Aschoni", "2", 1, {
      spellCastEvents: [cast(1_000, "Aschoni", "30449", "Spellsteal", "Jdmx")],
    });
    const mine = [cast(8_000, "Jdmx", "30449", "Spellsteal", "Foe")];
    expect(
      of(
        scan(
          runPressFiling,
          players(mate, mine, [stolen(8_001), stolen(12_001)]),
          [line],
        ),
        "dispelPressOnAlly",
      ),
    ).toEqual([]);
  });

  it("an enemy's press aimed at the unit is no press on an ally", () => {
    const foe = unit("Foe", "2", 2, {
      spellCastEvents: [cast(12_000, "Foe", "30449", "Spellsteal", "Jdmx")],
    });
    expect(
      of(
        scan(runPressFiling, players(foe, [], [stolen(12_001)]), [line]),
        "dispelPressOnAlly",
      ),
    ).toEqual([]);
  });

  it("flags a teammate's press on the unit in that second (D18)", () => {
    const mate = unit("Aschoni", "2", 1, {
      spellCastEvents: [cast(12_000, "Aschoni", "30449", "Spellsteal", "Jdmx")],
    });
    expect(
      of(
        scan(runPressFiling, players(mate, [], [stolen(12_001)]), [line]),
        "dispelPressOnAlly",
      ),
    ).toHaveLength(1);
  });
});

describe("selfOnlyHeldDualRole", () => {
  const note = (name: string) =>
    `NOTE: self-only defensive cooldowns (${name}) were correctly HELD`;
  const applied = (src: string, spellId: string, spellName: string) => ({
    ...aura(LogEvent.SPELL_AURA_APPLIED, 12_000, spellId, spellName),
    srcUnitId: src,
  });
  const press = (spellId: string, spellName: string) =>
    cast(12_000, "Hunter", spellId, spellName, "Mate");

  it("the aim alone is no reach: a self-buff's cast row names what the presser had targeted (ec7bd3f5 r3)", () => {
    const players = [
      unit("Hunter", "1", 1, {
        spellCastEvents: [press("264735", "Survival of the Fittest")],
      }),
      unit("Mate", "2", 1),
    ];
    expect(
      of(
        scan(runPressFiling, players, [note("Survival of the Fittest")]),
        "selfOnlyHeldDualRole",
      ),
    ).toEqual([]);
  });

  it("flags a press whose spell reached the unit it was aimed at (D62)", () => {
    const players = [
      unit("Hunter", "1", 1, {
        spellCastEvents: [press("421453", "Ultimate Penitence")],
      }),
      unit("Mate", "2", 1, {
        auraEvents: [applied("Hunter", "421453", "Ultimate Penitence")],
      }),
    ];
    expect(
      of(
        scan(runPressFiling, players, [note("Ultimate Penitence")]),
        "selfOnlyHeldDualRole",
      ),
    ).toHaveLength(1);
  });
});

// fact7 r3: the eight checks the 605 capture still fired on. Same split: `reads`
// is the shape the raw log proved right, `flags` the audited defect.
const APPLIED_ROW = LogEvent.SPELL_AURA_APPLIED;
const REMOVED_ROW = LogEvent.SPELL_AURA_REMOVED;
const onUnit = (
  event: string,
  ms: number,
  spellId: string,
  spellName: string,
) => ({ ...aura(event, ms, spellId, spellName), srcUnitId: "foe" });
const readAt = (name: string, ms: number) =>
  rowOf(LogEvent.SPELL_HEAL, ms, {
    advancedActorId: name,
    advancedActorMaxHp: 100,
  });

describe("conseqDroppedWithReadings", () => {
  const LINE =
    "0:39  [CC ON ENEMY]   2(HPriest) ← Cheap Shot (by 9(SRogue)) (still on them when the round ended, 1s in) [DR: Stun 50%]";
  const team = (auraEvents: any[], readMs: number) => [
    unit("Owner", "1", 1),
    unit("Healer", "2", 2, { spec: CombatUnitSpec.Priest_Holy, auraEvents }),
    unit("Mate", "3", 2, { advancedActions: [readAt("Mate", readMs)] }),
  ];
  const span = [
    onUnit(APPLIED_ROW, 39_273, "1833", "Cheap Shot"),
    onUnit(REMOVED_ROW, 41_289, "1833", "Cheap Shot"),
  ];

  it("a control the round's end cut under 2 s has no line to drop (f0a10402 r1, 0.7 s of 2.0 s)", () => {
    const seen = scan(
      runSpanFacts,
      team(span, 39_500),
      [LINE],
      "",
      [],
      at(39_966),
    );
    expect(of(seen, "conseqDroppedWithReadings")).toEqual([]);
  });

  it("a re-application ends the instance the line printed (05b762f1 r5, the second Sap)", () => {
    const sap = [
      onUnit(APPLIED_ROW, 6_268, "6770", "Sap"),
      onUnit(LogEvent.SPELL_AURA_REFRESH, 11_790, "6770", "Sap"),
      onUnit(REMOVED_ROW, 14_801, "6770", "Sap"),
    ];
    const line =
      "0:06  [CC ON ENEMY]   2(HPriest) ← Sap (by 9(ARogue)) (6s) [DR: Incapacitate Full]";
    expect(
      of(
        scan(runSpanFacts, team(sap, 13_000), [line]),
        "conseqDroppedWithReadings",
      ),
    ).toEqual([]);
    expect(
      of(
        scan(runSpanFacts, team(sap, 8_000), [line]),
        "conseqDroppedWithReadings",
      ),
    ).toHaveLength(1);
  });

  it("flags 2 s of the round with every teammate read and no line (D20)", () => {
    const seen = scan(runSpanFacts, team(span, 39_500), [LINE]);
    expect(of(seen, "conseqDroppedWithReadings")).toHaveLength(1);
  });
});

describe("killFocusOverSpan", () => {
  const line = (focus: number) =>
    `  [1:53–1:55] on Target — Stun opener (Full DR), 1 stun | opportunity: PRIME | team focus ${focus}% (0.1M on target inside it, 0.1M incl. the 5 s after) | KILL`;
  const hit = (ms: number, dest: string, amount: number, more = {}) =>
    rowOf(LogEvent.SPELL_DAMAGE, ms, {
      destUnitId: dest,
      effectiveAmount: -amount,
      ...more,
    });
  const rows = [
    hit(113_100, "Target", 30),
    hit(113_700, "Other", 20),
    hit(114_500, "Target", 60),
    hit(115_000, "Other", 10),
  ];
  const team = (damageOut: any[]) => [
    unit("Owner", "1", 1, { info: {}, damageOut }),
    unit("Target", "2", 2, {
      info: {},
      deathRecords: [{ timestamp: at(115_142) }],
    }),
    unit("Other", "3", 2, { info: {} }),
  ];

  it("a start inside the printed second is neither end's share (ec7bd3f5 1:53: 81 / 84 at the ends, 78 printed)", () => {
    expect(
      of(
        scan(runKillAttemptFacts, team(rows), [line(67)]),
        "killFocusOverSpan",
      ),
    ).toEqual([]);
  });

  it("a deferral shield's row is no damage yet (5c48e842 1:09, Stretch Time)", () => {
    const held = rowOf(LogEvent.SPELL_ABSORBED, 114_600, {
      destUnitId: "Target",
      effectiveAmount: 400,
      spellId: "410355",
    });
    expect(
      of(
        scan(runKillAttemptFacts, team([...rows, held]), [line(75)]),
        "killFocusOverSpan",
      ),
    ).toEqual([]);
  });

  it("flags a figure no span of those seconds reaches (D67)", () => {
    expect(
      of(
        scan(runKillAttemptFacts, team(rows), [line(40)]),
        "killFocusOverSpan",
      ),
    ).toHaveLength(1);
  });
});

describe("killOwnAreaSaveUncredited", () => {
  const line = (clause: string) =>
    `  [0:09–0:39] on Target — Stun opener (Full DR), 1 stun | opportunity: PRIME | team focus 0% (0.1M on target inside it, 0.1M incl. the 5 s after) | FAILED: ${clause}`;
  const team = (auraEvents: any[] = []) => [
    unit("Owner", "1", 1, { info: {} }),
    unit("Target", "2", 2, {
      info: {},
      spellCastEvents: [cast(27_584, "Target", "97462", "Rallying Cry")],
      auraEvents: [
        {
          ...aura(APPLIED_ROW, 27_590, "97463", "Rallying Cry"),
          destUnitId: "Target",
        },
        ...auraEvents,
      ],
    }),
  ];
  const suppression = {
    ...aura(APPLIED_ROW, 26_000, "33206", "Pain Suppression"),
    destUnitId: "Target",
  };

  it("the clause is the first cause, not a list: a wall in the rows outranks an own save (287ee68f r3)", () => {
    expect(
      of(
        scan(runKillAttemptFacts, team([suppression]), [
          line("popped Pain Suppression"),
        ]),
        "killOwnAreaSaveUncredited",
      ),
    ).toEqual([]);
  });

  it("flags a wall the rows do not hold", () => {
    expect(
      of(
        scan(runKillAttemptFacts, team(), [line("popped Pain Suppression")]),
        "killOwnAreaSaveUncredited",
      ),
    ).toHaveLength(1);
  });

  it("flags the save read as pressure (D10)", () => {
    expect(
      of(
        scan(runKillAttemptFacts, team(), [line("not enough damage")]),
        "killOwnAreaSaveUncredited",
      ),
    ).toHaveLength(1);
  });
});

describe("killAnchorSkippedOpener", () => {
  const line = (name: string, ends = "1:25–1:37") =>
    `  [${ends}] on Target — ${name} burst (no stun) | opportunity: PRIME | team focus 0% (0.1M on target inside it, 0.1M incl. the 5 s after) | KILL`;
  const selfAura = (ms: number, spellId: string, spellName: string) => ({
    ...aura(APPLIED_ROW, ms, spellId, spellName),
    destUnitId: "F",
    auraType: "BUFF",
  });
  const hit = (ms: number, dest: string, amount: number) =>
    rowOf(LogEvent.SPELL_DAMAGE, ms, {
      destUnitId: dest,
      effectiveAmount: -amount,
    });
  const team = (over: any) => [
    unit("F", "1", 1, {
      info: {},
      spec: CombatUnitSpec.Paladin_Retribution,
      ...over,
    }),
    unit("Target", "2", 2, { info: {} }),
    unit("Other", "3", 2, { info: {} }),
  ];
  const wings = {
    spellCastEvents: [
      cast(85_276, "F", "31884", "Avenging Wrath"),
      cast(90_855, "F", "421453", "Ultimate Penitence", "Target"),
    ],
    auraEvents: [selfAura(85_277, "31884", "Avenging Wrath")],
  };

  it("flags an offensive self-buff skipped for a later press (D4)", () => {
    const seen = scan(
      runKillAttemptFacts,
      team({ ...wings, damageOut: [hit(86_000, "Target", 100)] }),
      [line("Ultimate Penitence")],
    );
    expect(of(seen, "killAnchorSkippedOpener")).toHaveLength(1);
  });

  it("a caster who hit another enemy more did not open it on this target", () => {
    const seen = scan(
      runKillAttemptFacts,
      team({
        ...wings,
        damageOut: [hit(86_000, "Target", 100), hit(87_000, "Other", 900)],
      }),
      [line("Ultimate Penitence")],
    );
    expect(of(seen, "killAnchorSkippedOpener")).toEqual([]);
  });

  it("a press outside the offensive table opens no bracket (a Blink in its first second)", () => {
    const seen = scan(
      runKillAttemptFacts,
      team({
        spellCastEvents: [
          cast(85_276, "F", "1953", "Blink"),
          cast(90_855, "F", "421453", "Ultimate Penitence", "Target"),
        ],
        auraEvents: [selfAura(85_277, "1953", "Blink")],
        damageOut: [hit(86_000, "Target", 100)],
      }),
      [line("Ultimate Penitence")],
    );
    expect(of(seen, "killAnchorSkippedOpener")).toEqual([]);
  });

  it("an occurrence no press carries is named by its aura (Eye Beam's Metamorphosis (Demonic))", () => {
    const seen = scan(
      runKillAttemptFacts,
      team({
        spec: CombatUnitSpec.DemonHunter_Havoc,
        spellCastEvents: [cast(34_200, "F", "31884", "Avenging Wrath")],
        auraEvents: [
          selfAura(34_210, "31884", "Avenging Wrath"),
          selfAura(34_300, "162264", "Metamorphosis"),
        ],
        damageOut: [hit(35_000, "Target", 100)],
      }),
      [line("Metamorphosis (Demonic)", "0:34–0:41")],
    );
    expect(of(seen, "killAnchorSkippedOpener")).toEqual([]);
  });
});

describe("noDefensiveButPressed", () => {
  const LINE =
    "1:49–1:59 [Critical burst] 6.9→7.3yd from X — no defensive CD available";
  const seenWith = (id: string, name: string, ms: number) =>
    scan(
      runSpanFacts,
      [
        unit("Owner", "1", 1, {
          spellCastEvents: [cast(ms, "Owner", id, name)],
        }),
      ],
      [LINE],
    ).filter((v) => v.check === "noDefensiveButPressed");

  it("the sentence's CD is the tracked kit: a 15 s Feint is no row of it (0a6f0b0c r6)", () => {
    expect(seenWith("1966", "Feint", 115_237)).toEqual([]);
  });

  it("a press in an end second is shown, not counted: the span's ends are floored", () => {
    expect(seenWith("48707", "Anti-Magic Shell", 109_100)[0]?.kind).toBe(
      "edgeSecond",
    );
  });

  it("flags a tracked defensive pressed inside the span (D2)", () => {
    expect(seenWith("48707", "Anti-Magic Shell", 115_413)[0]?.kind).toBe(
      "pressInSpan",
    );
  });
});

describe("freeToPressBelowLog", () => {
  const line = (free: string) =>
    `[1:14] Dead died — Priest had Guardian Spirit available, caster's longest stretch free to cast it ${free}s of the last 5s`;
  const stun = [
    onUnit(APPLIED_ROW, 60_000, "853", "Hammer of Justice"),
    onUnit(REMOVED_ROW, 63_000, "853", "Hammer of Justice"),
  ];
  const team = (more: any) => [
    unit("Owner", "1", 1),
    unit("Priest", "2", 2, {
      info: { pvpTalents: [] },
      auraEvents: stun,
      ...more,
    }),
    unit("Dead", "3", 2, { deathRecords: [{ timestamp: at(74_245) }] }),
  ];
  const checked = (more: any, free: string) =>
    of(
      scan(runCastThroughStun, team(more), [line(free)]),
      "freeToPressBelowLog",
    );

  it("a school lockout is no free time (3035741a r2, Wind Shear)", () => {
    const kick = {
      timestamp: at(72_192),
      spellId: "57994",
      extraSpellId: "2061",
      logLine: { event: LogEvent.SPELL_INTERRUPT, timestamp: at(72_192) },
    };
    expect(checked({ actionIn: [kick] }, "2.9")).toEqual([]);
  });

  it("a control the death ended has no REMOVED and still runs (b81efd46 r6, Polymorph)", () => {
    const auraEvents = [
      ...stun,
      onUnit(APPLIED_ROW, 70_500, "118", "Polymorph"),
    ];
    expect(checked({ auraEvents }, "0.0")).toEqual([]);
  });

  it("a silence is no free time (4fb9ee24 r3, Garrote - Silence)", () => {
    const auraEvents = [
      ...stun,
      onUnit(APPLIED_ROW, 72_000, "1330", "Garrote - Silence"),
      onUnit(REMOVED_ROW, 75_000, "1330", "Garrote - Silence"),
    ];
    expect(checked({ auraEvents }, "0.0")).toEqual([]);
  });

  it("flags the stun counted against a spell that goes out through it (D21)", () => {
    expect(checked({}, "0.0")).toHaveLength(1);
  });
});

describe("ledgerProcImmunityMissing", () => {
  const lines = ["  Burst #2 — 1:48–2:02 | x", "    Target: Holder 40%"];
  const team = (auraEvents: any[]) => [unit("Holder", "1", 1, { auraEvents })];

  it("an APPLIED whose REMOVED the log lost is not closed by the next proc's (12c701da r1)", () => {
    const seen = scan(
      runSpanFacts,
      team([
        onUnit(APPLIED_ROW, 32_198, "353319", "Peaceweaver"),
        onUnit(APPLIED_ROW, 153_515, "353319", "Peaceweaver"),
        onUnit(REMOVED_ROW, 155_536, "353319", "Peaceweaver"),
      ]),
      lines,
    );
    expect(of(seen, "ledgerProcImmunityMissing")).toEqual([]);
  });

  it("flags the proc on the burst's target, unnamed (D40)", () => {
    const seen = scan(
      runSpanFacts,
      team([
        onUnit(APPLIED_ROW, 110_000, "353319", "Peaceweaver"),
        onUnit(REMOVED_ROW, 112_000, "353319", "Peaceweaver"),
      ]),
      lines,
    );
    expect(of(seen, "ledgerProcImmunityMissing")).toHaveLength(1);
  });
});
