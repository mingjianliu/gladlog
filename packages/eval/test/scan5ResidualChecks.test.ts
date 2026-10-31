/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the checks read them untyped */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  addCastToIndex,
  buildCastMatchIndex,
  createCastMatchIndex,
  ensureAnalysisData,
  reconstructDispelSummary,
} from "@gladlog/analysis";
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { makeUnit } from "../../analysis/test/ported/testHelpers";
import { dispelKindOfRow } from "../scripts/dispelKindOfRow";
import { run as runCastThroughStun } from "../scripts/scan5/castThroughStun";
import { run as runDamageBasis } from "../scripts/scan5/damageBasis";
import { run as runFriendlyOffensiveTag } from "../scripts/scan5/friendlyOffensiveTag";
import { run as runKillAttemptFacts } from "../scripts/scan5/killAttemptFacts";
import { run as runListGap } from "../scripts/scan5/listGap";
import { run as runOverrideVariant } from "../scripts/scan5/overrideVariant";
import { run as runPressFiling } from "../scripts/scan5/pressFiling";
import { run as runSilenceKick } from "../scripts/scan5/silenceKick";
import { run as runSingles14b } from "../scripts/scan5/singles14b";
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
    legacy: {
      startTime: START,
      endTime: at(600_000),
      units: Object.fromEntries(players.map((p) => [p.id, p])),
      startInfo: players[0]?.startInfo,
    },
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

    it("flags a spell a parry can stop, whatever its reach and with no PARRY row this round (Final Verdict, 12 yd)", () => {
      expect(
        of(
          scan(runDamageBasis, players("383328", "Final Verdict"), lines),
          "abilityIntoWallShare",
        ),
      ).toHaveLength(1);
    });

    it("leaves out a melee-range attack a parry cannot stop (Garrote, 5 yd)", () => {
      expect(
        of(
          scan(runDamageBasis, players("703", "Garrote"), lines),
          "abilityIntoWallShare",
        ),
      ).toEqual([]);
    });

    const parryRow = (src: string, id: string, name: string) =>
      `10/28/2026 16:54:36.317-7  SPELL_MISSED,${src},"${src}",0x511,0x80000000,Target,"Target",0x10548,0x80000000,${id},"${name}",0x1,PARRY,nil,ST`;

    it("flags a spell the log parried, whatever the tables say of it (Lightning Bolt, unparryable in DB2)", () => {
      expect(
        of(
          scan(runDamageBasis, players("188196", "Lightning Bolt"), lines, "", [
            parryRow("Ally", "188196", "Lightning Bolt"),
          ]),
          "abilityIntoWallShare",
        ),
      ).toHaveLength(1);
    });

    it("a PARRY row of the id speaks whoever cast it", () => {
      expect(
        of(
          scan(runDamageBasis, players("188196", "Lightning Bolt"), lines, "", [
            parryRow("Someone", "188196", "Lightning Bolt"),
          ]),
          "abilityIntoWallShare",
        ),
      ).toHaveLength(1);
    });

    it("a pet's PARRY row under another id speaks for its owner's press of that name", () => {
      const pet = { ...unit("Pet", "9", 1), ownerId: "Ally" };
      expect(
        of(
          scan(
            runDamageBasis,
            [...players("188196", "Lightning Bolt"), pet],
            lines,
            "",
            [parryRow("Pet", "999991", "Lightning Bolt")],
          ),
          "abilityIntoWallShare",
        ),
      ).toHaveLength(1);
    });

    it("another player's PARRY row of a same-named id says nothing of this press", () => {
      expect(
        of(
          scan(runDamageBasis, players("188196", "Lightning Bolt"), lines, "", [
            parryRow("Someone", "999991", "Lightning Bolt"),
          ]),
          "abilityIntoWallShare",
        ),
      ).toEqual([]);
    });

    it("with no PARRY row, DB2 reads the row a press landed as (Kill Command: press 34026, row 83381)", () => {
      const roster = team(
        {
          damageOut: [
            dmg("12294", "Mortal Strike", 500),
            dmg("83381", "Kill Command", 500),
          ],
          spellCastEvents: presses("34026", "Kill Command"),
        },
        low,
      );
      expect(
        of(scan(runDamageBasis, roster, lines), "abilityIntoWallShare"),
      ).toHaveLength(1);
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

  const immune = "forced a full immunity (a win — re-open after it drops)";
  const onTarget = (event: string, ms: number, id: string, name: string) => ({
    ...aura(event, ms, id, name),
    destUnitId: "Target",
  });

  it("flags an immunity the rows do not hold", () => {
    expect(
      of(
        scan(runKillAttemptFacts, team(), [line(immune)]),
        "killOwnAreaSaveUncredited",
      ),
    ).toHaveLength(1);
  });

  it("flags an immunity that ended before the bracket", () => {
    const over = [
      onTarget(APPLIED_ROW, 1_000, "642", "Divine Shield"),
      onTarget(REMOVED_ROW, 8_000, "642", "Divine Shield"),
    ];
    expect(
      of(
        scan(runKillAttemptFacts, team(over), [line(immune)]),
        "killOwnAreaSaveUncredited",
      ),
    ).toHaveLength(1);
  });

  it("a non-immunity aura is no immunity's row", () => {
    expect(
      of(
        scan(runKillAttemptFacts, team([suppression]), [line(immune)]),
        "killOwnAreaSaveUncredited",
      ),
    ).toHaveLength(1);
  });

  it("the immunity's rows hold: inside the bracket, or already up from before it", () => {
    for (const rows of [
      [onTarget(APPLIED_ROW, 30_000, "642", "Divine Shield")],
      [
        onTarget(APPLIED_ROW, 5_000, "45438", "Ice Block"),
        onTarget(REMOVED_ROW, 15_000, "45438", "Ice Block"),
      ],
      // the five seconds after the bracket the product gives an immunity
      [onTarget(APPLIED_ROW, 42_000, "11327", "Vanish")],
    ])
      expect(
        of(
          scan(runKillAttemptFacts, team(rows), [line(immune)]),
          "killOwnAreaSaveUncredited",
        ),
      ).toEqual([]);
  });

  it("flags a wall that ended before the bracket", () => {
    const over = [
      onTarget(APPLIED_ROW, 1_000, "33206", "Pain Suppression"),
      onTarget(REMOVED_ROW, 8_000, "33206", "Pain Suppression"),
    ];
    expect(
      of(
        scan(runKillAttemptFacts, team(over), [
          line("popped Pain Suppression"),
        ]),
        "killOwnAreaSaveUncredited",
      ),
    ).toHaveLength(1);
  });

  it("`target trinketed out` needs the trinket's own row", () => {
    const players = team();
    expect(
      of(
        scan(runKillAttemptFacts, players, [line("target trinketed out")]),
        "killOwnAreaSaveUncredited",
      ),
    ).toHaveLength(1);
    (players[1] as any).spellCastEvents.push(
      cast(20_000, "Target", "336126", "Gladiator's Medallion"),
    );
    expect(
      of(
        scan(runKillAttemptFacts, players, [line("target trinketed out")]),
        "killOwnAreaSaveUncredited",
      ),
    ).toEqual([]);
    const adaptation = team([
      onTarget(APPLIED_ROW, 20_000, "283167", "PvP Trinket"),
    ]);
    expect(
      of(
        scan(runKillAttemptFacts, adaptation, [line("target trinketed out")]),
        "killOwnAreaSaveUncredited",
      ),
    ).toEqual([]);
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

  it("a Holy Paladin's Avenging Wrath opens no attempt (signed), a Retribution's does", () => {
    const seen = scan(
      runKillAttemptFacts,
      team({
        ...wings,
        spec: CombatUnitSpec.Paladin_Holy,
        damageOut: [hit(86_000, "Target", 100)],
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

  const flashHeal = (ms: number) => ({
    ...cast(ms, "Priest", "2061", "Flash Heal"),
  });
  const flashHealLine =
    "[1:14] Dead died — Priest had Flash Heal available, caster's longest stretch free to cast it 0.0s of the last 5s";
  const flashChecked = (ms: number) =>
    of(
      scan(runCastThroughStun, team({ spellCastEvents: [flashHeal(ms)] }), [
        flashHealLine,
      ]),
      "freeToPressBelowLog",
    );

  it("a SUCCESS inside a stun says the spell goes out through it, whatever the attribute says", () => {
    expect(flashChecked(61_000)).toHaveLength(1);
  });

  it("a SUCCESS on the stun's edge says nothing: it may be logged across it", () => {
    expect(flashChecked(60_050)).toEqual([]);
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

// fact7 r4: the four checks that still fired on the 605 capture after the 15
// rounds reached 0.

describe("intoDefenseLanded", () => {
  const wallRows = (from: number, to: number) =>
    [
      [LogEvent.SPELL_AURA_APPLIED, from],
      [LogEvent.SPELL_AURA_REMOVED, to],
    ].map(([event, ms]) => ({
      ...aura(event as string, ms as number, "22812", "Barkskin"),
      destUnitId: "Target",
      srcUnitId: "Target",
      srcUnitName: "Target",
    }));
  const hitOn = (ms: number, spellId: string, spellName: string) =>
    rowOf(LogEvent.SPELL_DAMAGE, ms, {
      spellId,
      spellName,
      destUnitId: "Target",
    });
  const line = (list: string) =>
    `  [0:30] Assassination Rogue (Ally): ${list} into Target's Barkskin`;
  const players = (ally: any, wall = wallRows(30_000, 40_000)) => [
    unit("Ally", "1", 1, ally),
    unit("Target", "2", 2, { auraEvents: wall }),
  ];
  const seen = (ally: any, list: string, wall?: any[]) =>
    of(
      scan(runSingles14b, players(ally, wall), [line(list)]),
      "intoDefenseLanded",
    );

  it("one press under two ids in one instant is one press (Mutilate 1329 + 27576, 0a7d35e2 r1)", () => {
    const ally = {
      spellCastEvents: [
        cast(31_000, "Ally", "27576", "Mutilate", "Target"),
        cast(31_000, "Ally", "1329", "Mutilate", "Target"),
      ],
      damageOut: [
        hitOn(31_001, "5374", "Mutilate"),
        hitOn(31_001, "27576", "Mutilate"),
      ],
    };
    expect(seen(ally, "Mutilate")).toEqual([]);
  });

  it("a reflected cast landed on nobody here (Fire Blast into Time Dilation, 8-1 0:32)", () => {
    const ally = {
      spellCastEvents: [
        cast(31_000, "Ally", "108853", "Fire Blast", "Target"),
        cast(33_000, "Ally", "108853", "Fire Blast", "Target"),
      ],
      damageOut: [hitOn(33_100, "108853", "Fire Blast")],
      missesOut: [
        rowOf(LogEvent.SPELL_MISSED, 31_080, {
          spellId: "108853",
          spellName: "Fire Blast",
          destUnitId: "Target",
          missType: "REFLECT",
        }),
      ],
    };
    expect(seen(ally, "Fire Blast")).toEqual([]);
  });

  it("a DoT lands as its aura, and an eaten tick is nobody's press (Drain Soul 60.5 s, the wall to 60.8 s)", () => {
    const ally = {
      spellCastEvents: [cast(39_700, "Ally", "198590", "Drain Soul", "Target")],
      damageOut: [],
      missesOut: [
        rowOf(LogEvent.SPELL_PERIODIC_MISSED, 40_400, {
          spellId: "198590",
          spellName: "Drain Soul",
          destUnitId: "Target",
          missType: "ABSORB",
        }),
      ],
    };
    const target = [
      ...wallRows(30_000, 40_000),
      {
        ...aura(LogEvent.SPELL_AURA_APPLIED, 39_702, "198590", "Drain Soul"),
        destUnitId: "Target",
        srcUnitId: "Ally",
      },
    ].sort((a, b) => a.timestamp - b.timestamp);
    expect(seen(ally, "Drain Soul", target)).toEqual([]);
  });

  it("a press after the round's ending death is in the log's tail, not the round (Rake 104.8 s, 34-5)", () => {
    const ally = {
      startInfo: { bracket: "Rated Solo Shuffle" },
      spellCastEvents: [31_000, 36_000].map((t) =>
        cast(t, "Ally", "1822", "Rake", "Target"),
      ),
      damageOut: [hitOn(31_001, "1822", "Rake"), hitOn(36_001, "1822", "Rake")],
    };
    const seenAfterDeath = of(
      scan(
        runSingles14b,
        [
          unit("Ally", "1", 1, ally),
          unit("Target", "2", 2, {
            info: {},
            auraEvents: wallRows(30_000, 40_000),
            deathRecords: [{ timestamp: at(35_000) }],
          }),
        ],
        [line("Rake")],
      ),
      "intoDefenseLanded",
    );
    expect(seenAfterDeath).toEqual([]);
  });

  it("a wall the log re-applied inside its second is two intervals, the line one of them (4-1 0:19)", () => {
    const ally = {
      spellCastEvents: [31_000, 33_000].map((t) =>
        cast(t, "Ally", "34026", "Kill Command", "Target"),
      ),
      damageOut: [],
    };
    const wall = [...wallRows(30_100, 30_700), ...wallRows(30_800, 40_000)];
    expect(seen(ally, "Kill Command ×2", wall)).toEqual([]);
  });

  it("flags a cast that landed inside and was left off (D52)", () => {
    const ally = {
      spellCastEvents: [31_000, 33_000].map((t) =>
        cast(t, "Ally", "11366", "Pyroblast", "Target"),
      ),
      damageOut: [
        hitOn(31_500, "11366", "Pyroblast"),
        hitOn(33_500, "11366", "Pyroblast"),
      ],
    };
    expect(seen(ally, "Pyroblast")).toHaveLength(1);
  });
});

describe("intoDefenseLanded: the wall's span is its own rows", () => {
  const rows = (...pairs: Array<[string, number]>) =>
    pairs.map(([event, ms]) => ({
      ...aura(event, ms, "22812", "Barkskin"),
      destUnitId: "Target",
      srcUnitId: "Target",
    }));
  const press = (ms: number) => cast(ms, "Ally", "1329", "Mutilate", "Target");
  const hit = (ms: number) =>
    rowOf(LogEvent.SPELL_DAMAGE, ms, {
      spellId: "1329",
      spellName: "Mutilate",
      destUnitId: "Target",
    });
  const seen = (wall: any[], list: string) =>
    of(
      scan(
        runSingles14b,
        [
          unit("Ally", "1", 1, {
            spellCastEvents: [press(31_000), press(36_000)],
            damageOut: [hit(31_100), hit(36_100)],
          }),
          unit("Target", "2", 2, { auraEvents: wall }),
        ],
        [`  [0:30] Assassination Rogue (Ally): ${list} into Target's Barkskin`],
      ),
      "intoDefenseLanded",
    );

  it("a REMOVED and APPLIED a millisecond apart are one wall", () => {
    const wall = rows(
      [APPLIED_ROW, 30_000],
      [REMOVED_ROW, 33_000],
      [APPLIED_ROW, 33_001],
      [REMOVED_ROW, 40_000],
    );
    expect(seen(wall, "Mutilate ×2")).toEqual([]);
  });

  it("a real end and a later application are two: the second's hit is no hit into the first", () => {
    const wall = rows(
      [APPLIED_ROW, 30_000],
      [REMOVED_ROW, 33_000],
      [APPLIED_ROW, 35_000],
      [REMOVED_ROW, 40_000],
    );
    expect(seen(wall, "Mutilate ×2")).toHaveLength(1);
    expect(seen(wall, "Mutilate")).toEqual([]);
  });
});

describe("offensiveTagWrong", () => {
  const line =
    "0:27  [ENEMY DEF]   2(RPaladin) (Retribution Paladin): Divine Protection (20%, 8.0s) [friendly offensive CD active] (at 71% HP)";
  const up = (spellId: string) =>
    rowOf(LogEvent.SPELL_AURA_APPLIED, 12_000, {
      spellId,
      spellName: "x",
      srcUnitId: "Ally",
    });
  const seen = (allyAuras: string[], enemyAuras: string[]) =>
    of(
      scan(
        runFriendlyOffensiveTag,
        [
          unit("Ally", "1", 1, { info: {}, auraEvents: allyAuras.map(up) }),
          unit("Enemy", "2", 2, { info: {}, auraEvents: enemyAuras.map(up) }),
        ],
        [line],
      ),
      "offensiveTagWrong",
    );

  it("an aura whose cast is logged apart is its cooldown (Arcane Surge 365362, 4-2 0:27)", () => {
    expect(seen(["365362"], ["12654"])).toEqual([]);
  });
  it("a recharge is a cooldown (Ray of Frost 205021, 60 s charge)", () => {
    expect(seen([], ["205021"])).toEqual([]);
  });
  it("an activation has its cooldown's (Radiant Glory 454351 → 31884)", () => {
    expect(seen(["454351"], [])).toEqual([]);
  });
  it("flags a tag only Curse of Tongues stands behind", () => {
    expect(seen([], ["1714"])).toHaveLength(1);
  });
});

describe("rotDotCount", () => {
  const debuff = (event: string, ms: number, spellId: string, src: string) => ({
    ...aura(event, ms, spellId, "x"),
    srcUnitId: src,
    logLine: {
      event,
      timestamp: at(ms),
      parameters: { 11: "DEBUFF" },
    },
  });
  const tick = (ms: number, spellId: string, src: string) =>
    rowOf(LogEvent.SPELL_PERIODIC_DAMAGE, ms, { spellId, srcUnitId: src });
  const line = (n: number) =>
    `0:40  [ROT PRESSURE]   1(FMage) (Fire Mage) at 22% HP with ${n} active DoTs`;
  const seen = (more: any, n: number, rawLines: string[] = []) =>
    of(
      scan(
        runSingles14b,
        [unit("Mage", "1", 1, more)],
        [line(n)],
        "",
        rawLines,
      ),
      "rotDotCount",
    );

  it("a tick eaten whole is a tick (Expurgation, every row SPELL_PERIODIC_MISSED, 10-6 0:18)", () => {
    const raw =
      '8/22/2026 15:18:05.000-4  SPELL_PERIODIC_MISSED,Ret,"Ret",0x0,0x0,Mage,"Mage",0x0,0x0,383346,"Expurgation",0x6,ABSORB,nil,4639,3041,1,ST';
    expect(
      seen(
        {
          auraEvents: [
            debuff(LogEvent.SPELL_AURA_APPLIED, 12_000, "383346", "Ret"),
          ],
          damageIn: [],
        },
        1,
        [raw],
      ),
    ).toEqual([]);
  });

  it("a DB2 DoT gone before its first tick was on the unit (Moonfire up 1 s, 5-3 0:33)", () => {
    expect(
      seen(
        {
          auraEvents: [
            debuff(LogEvent.SPELL_AURA_APPLIED, 39_600, "164812", "Druid"),
            debuff(LogEvent.SPELL_AURA_REMOVED, 40_600, "164812", "Druid"),
          ],
          damageIn: [],
        },
        1,
      ),
    ).toEqual([]);
  });

  it("a DoT that ends on the grid's own millisecond is still on at that second (Shared Fate, 3-6-36 r6 1:33)", () => {
    expect(
      seen(
        {
          auraEvents: [
            debuff(LogEvent.SPELL_AURA_APPLIED, 30_000, "450591", "Warlock"),
            debuff(LogEvent.SPELL_AURA_REMOVED, 40_000, "450591", "Warlock"),
            debuff(LogEvent.SPELL_AURA_APPLIED, 40_335, "450591", "Warlock"),
          ],
          damageIn: [tick(32_000, "450591", "Warlock")],
        },
        1,
      ),
    ).toEqual([]);
  });

  it("flags a DoT ended a millisecond before the second and still counted", () => {
    expect(
      seen(
        {
          auraEvents: [
            debuff(LogEvent.SPELL_AURA_APPLIED, 30_000, "450591", "Warlock"),
            debuff(LogEvent.SPELL_AURA_REMOVED, 39_999, "450591", "Warlock"),
          ],
          damageIn: [tick(32_000, "450591", "Warlock")],
        },
        1,
      ),
    ).toHaveLength(1);
  });

  it("flags a DoT ended under the controller's name and still counted (D32, 87ba9256 4:33)", () => {
    expect(
      seen(
        {
          auraEvents: [
            debuff(LogEvent.SPELL_AURA_APPLIED, 5_000, "34914", "Controlled"),
            debuff(LogEvent.SPELL_AURA_REMOVED, 26_000, "34914", "Controller"),
          ],
          damageIn: [tick(7_000, "34914", "Controller")],
        },
        1,
      ),
    ).toHaveLength(1);
  });
});

describe("kitRangeBelowSeen", () => {
  const lines = [
    '  <unit id="1" name="Priest" spec="Holy Priest" role="enemy">',
    "    <cooldowns>Holy Word: Chastise [0–40s], Fade [30s]</cooldowns>",
  ];
  const seen = (more: any) =>
    of(
      scan(runOverrideVariant, [unit("Priest", "1", 1, more)], lines),
      "kitRangeBelowSeen",
    );
  const press = cast(157_543, "Priest", "88625", "Holy Word: Chastise");

  it("a reset inside the press's own second is a true 0 (Apotheosis 0.95 s on, d5f35ce9 r6)", () => {
    expect(
      seen({
        spellCastEvents: [press],
        auraEvents: [
          rowOf(LogEvent.SPELL_AURA_APPLIED, 158_490, {
            spellId: "200183",
            spellName: "Apotheosis",
            srcUnitId: "Priest",
          }),
        ],
      }),
    ).toEqual([]);
  });

  it("flags a 0 with no reset under a second after a press (D71)", () => {
    expect(
      seen({
        spellCastEvents: [press],
        auraEvents: [
          rowOf(LogEvent.SPELL_AURA_APPLIED, 170_000, {
            spellId: "200183",
            spellName: "Apotheosis",
            srcUnitId: "Priest",
          }),
        ],
      }),
    ).toHaveLength(1);
  });
});

describe("listGapPress", () => {
  // Ravager: 90 s, on the roster
  const pressAt = (who: string, ms: number) =>
    cast(ms, who, "228920", "Ravager");
  const players = () => [
    unit("Owner", "1", 1, {
      info: { teamId: "0" },
      spec: CombatUnitSpec.Warrior_Arms,
      spellCastEvents: [pressAt("Owner", 10_200)],
    }),
    unit("Enemy", "4", 2, {
      info: { teamId: "1" },
      spec: CombatUnitSpec.Warrior_Fury,
      spellCastEvents: [pressAt("Enemy", 10_400)],
    }),
  ];
  const gaps = (lines: string[], roster = players()) =>
    of(scan(runListGap, roster, lines), "listGapPress");
  const youLine = "  0:10  [YOU] [CD]   Ravager (self: 91% HP, +1%/s, 26k DPS)";
  const enemyLine = "  0:10  [ENEMY CD]   4(FWarrior) (Fury Warrior): Ravager";

  it("flags a press hidden behind another player's line of the same spell", () => {
    const seen = gaps([enemyLine]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^Owner /);
  });

  it("each press its own line", () => {
    expect(gaps([youLine, enemyLine])).toEqual([]);
  });

  it("`(by N)` names the caster, not the line's first unit", () => {
    const cc = (by: string) =>
      `  0:10  [CC ON ENEMY]   4(FWarrior) ← Ravager (by ${by}) (2s) [DR: Stun Full]`;
    expect(gaps([cc("1(AWarrior)"), enemyLine])).toEqual([]);
    expect(gaps([cc("4(FWarrior)")])).toHaveLength(1);
  });

  it("`your X` is the owner's", () => {
    expect(
      gaps([
        "  0:10  [KICK]   your Ravager on 4(FWarrior) — hit nothing",
        enemyLine,
      ]),
    ).toEqual([]);
  });

  it("`N's X` names the caster, wherever N stands in the line", () => {
    const broken = (by: string) =>
      `  0:10  [CC ON ENEMY]   4(FWarrior) ← Hammer of Justice (by 2(RPaladin)) (2s) | broken by ${by}'s Ravager`;
    expect(gaps([broken("1(AWarrior)"), enemyLine])).toEqual([]);
    expect(gaps([broken("4(FWarrior)")])).toHaveLength(1);
  });

  it("a removal naming a debuff is no line of the debuff's press (Mass Entanglement)", () => {
    expect(
      gaps([
        "  0:10  [CLEANSE]   1(AWarrior) dispelled Ravager off 1(AWarrior) (Purify)",
        youLine,
      ]),
    ).toHaveLength(1);
  });

  it("a trinket line is its own subject's", () => {
    const roster = [
      unit("Owner", "1", 1, {
        info: { teamId: "0" },
        spec: CombatUnitSpec.Warrior_Arms,
        spellCastEvents: [cast(10_200, "Owner", "336126", "Medallion")],
      }),
      unit("Enemy", "4", 2, {
        info: { teamId: "1" },
        spec: CombatUnitSpec.Warrior_Fury,
      }),
    ];
    expect(
      gaps(["  0:10  [ENEMY TRINKET]   4(FWarrior) used PvP trinket"], roster),
    ).toHaveLength(1);
    expect(
      gaps(["  0:10  [TRINKET]   1(AWarrior) used PvP trinket"], roster),
    ).toEqual([]);
  });
});

describe("silenceFiledAsKick", () => {
  // the check reads SpellEffect from the datagen cache, which CI has not got:
  // a two-row table of its own. Silence has aura 27 and no effect 68.
  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), "silence-kick-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "SpellEffect-12.1.5.1.csv"),
      "SpellID,Effect,EffectAura\n15487,6,27\n47528,68,0\n",
    );
    process.env.DATAGEN_CACHE = dir;
  });

  const players = () => [
    unit("Owner", "1", 1, {
      info: { teamId: "0" },
      spec: CombatUnitSpec.Mage_Frost,
    }),
    unit("Priest", "2", 2, {
      info: { teamId: "1" },
      spec: CombatUnitSpec.Priest_Shadow,
      spellCastEvents: [cast(10_000, "Priest", "15487", "Silence", "Owner")],
    }),
  ];
  const row = (yd: number) =>
    `- id=kick-eaten:1 type=kick-eaten t=10.0s units=Owner facts={maxKickRangeYd=${yd}}`;

  it("flags a silence's own range read as a kicker's, from the DB2 rows and the casts alone", () => {
    expect(
      scan(runSilenceKick, players(), [], row(40)).map((v) => v.kind),
    ).toEqual(["kickersInRange"]);
  });

  it("reads a range no silence of the round has", () => {
    expect(scan(runSilenceKick, players(), [], row(25))).toEqual([]);
  });

  it("flags a `[KICK] … missed` line of a silence", () => {
    expect(
      scan(runSilenceKick, players(), [
        "  0:10  [KICK]   2(SPriest)'s Silence on 1(FMage) missed — IMMUNE",
      ]).map((v) => v.kind),
    ).toEqual(["[KICK] miss"]);
  });
});

describe("dispelKindOfRow: the audit readers' kind is the product's", () => {
  const BANDAGE = "212640";
  const T = 1_026_200;
  const dispelCast = (srcUnitId: string, ms: number, destUnitId?: string) => ({
    spellId: BANDAGE,
    spellName: "Mending Bandage",
    srcUnitId,
    destUnitId,
    timestamp: ms,
    logLine: {
      event: LogEvent.SPELL_CAST_SUCCESS,
      timestamp: ms,
      parameters: [],
    },
  });
  /** one SPELL_DISPEL, source `lock`, in the fixture of each D18 shape */
  const shape = (casts: Record<string, any[]>) => {
    const fill = (id: string) => {
      const u = makeUnit(id, {
        name: id,
        spec: CombatUnitSpec.Warlock_Affliction,
        spellCastEvents: casts[id] ?? [],
      } as any) as any;
      return u;
    };
    const hunter = fill("hunter");
    const lock = fill("lock");
    const foe = fill("foe");
    foe.reaction = 2;
    hunter.reaction = lock.reaction = 1;
    lock.actionOut = [
      {
        timestamp: T,
        logLine: { event: LogEvent.SPELL_DISPEL, timestamp: T, parameters: [] },
        spellId: BANDAGE,
        spellName: "Mending Bandage",
        extraSpellId: "8122",
        extraSpellName: "Psychic Scream",
        srcUnitId: "lock",
        destUnitId: "lock",
        destUnitName: "lock",
      },
    ];
    const product = reconstructDispelSummary(
      [hunter, lock] as any,
      [foe] as any,
      { startTime: 1_000_000, endTime: 1_100_000 },
    ).allyCleanse[0]!.dispelKind;
    const units = [hunter, lock, foe];
    const audit = dispelKindOfRow(
      buildCastMatchIndex(units),
      {
        srcUnitId: "lock",
        spellId: BANDAGE,
        spellName: "Mending Bandage",
        timestamp: T,
      },
      (id) => units.find((u) => u.id === id)?.reaction === lock.reaction,
    );
    return { product, audit };
  };

  it("a teammate's press logged self → self (D18): deliberate on both", () => {
    expect(shape({ hunter: [dispelCast("hunter", T - 100, "lock")] })).toEqual({
      product: "deliberate",
      audit: "deliberate",
    });
  });

  it("the source's own press: deliberate on both", () => {
    expect(shape({ lock: [dispelCast("lock", T - 100, "lock")] })).toEqual({
      product: "deliberate",
      audit: "deliberate",
    });
  });

  it("an enemy's press aimed at the source: proc on both, the actor stays", () => {
    expect(shape({ foe: [dispelCast("foe", T - 100, "lock")] })).toEqual({
      product: "proc",
      audit: "proc",
    });
  });

  it("no press at all: proc on both", () => {
    expect(shape({})).toEqual({ product: "proc", audit: "proc" });
  });

  it("a press outside the window: proc", () => {
    const i = createCastMatchIndex();
    addCastToIndex(i, "hunter", BANDAGE, "Mending Bandage", T - 5_000, "lock");
    expect(
      dispelKindOfRow(
        i,
        {
          srcUnitId: "lock",
          spellId: BANDAGE,
          spellName: "Mending Bandage",
          timestamp: T,
        },
        () => true,
      ),
    ).toBe("proc");
  });
});
