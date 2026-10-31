/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the checks read them untyped */
import { ensureAnalysisData } from "@gladlog/analysis";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { run as runDamageBasis } from "../scripts/scan5/damageBasis";
import { run as runPressFiling } from "../scripts/scan5/pressFiling";

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
  detail: string;
}

function scan(
  run: (ctx: any) => void,
  players: any[],
  lines: string[],
  menu = "",
  rawLines: string[] = [],
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
    roundEndAt: at(600_000),
    violate: (
      check: string,
      _k: string,
      _t: number,
      _f: string,
      detail: string,
    ) => seen.push({ check, detail }),
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
