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
import { run as runFact8 } from "../scripts/scan5/fact8";
import { run as runFact9 } from "../scripts/scan5/fact9";
import { run as runFact9b } from "../scripts/scan5/fact9b";
import { run as runFact10 } from "../scripts/scan5/fact10";
import { run as runFact11 } from "../scripts/scan5/fact11";
import { run as runFact12 } from "../scripts/scan5/fact12";
import { run as runFact12d } from "../scripts/scan5/fact12d";
import { run as runFriendlyOffensiveTag } from "../scripts/scan5/friendlyOffensiveTag";
import { run as runImmunity } from "../scripts/scan5/immunity";
import { run as runKillAttemptFacts } from "../scripts/scan5/killAttemptFacts";
import { run as runListGap } from "../scripts/scan5/listGap";
import { run as runOverrideVariant } from "../scripts/scan5/overrideVariant";
import { run as runPressFiling } from "../scripts/scan5/pressFiling";
import { run as runSilenceKick } from "../scripts/scan5/silenceKick";
import { run as runSingles2 } from "../scripts/scan5/singles2";
import { run as runSingles14b } from "../scripts/scan5/singles14b";
import { run as runSpanFacts } from "../scripts/scan5/spanFacts";
import {
  OUT_OF_TOTAL as T05_OUT_OF_TOTAL,
  run as runT05,
} from "../scripts/scan5/t05";

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
  end = at(600_000),
): IViolation[] {
  const seen: IViolation[] = [];
  const byName = new Map(players.map((p) => [p.name, p]));
  run({
    lines,
    text: lines.join("\n"),
    menu,
    rawLines,
    legacy: {
      startTime: START,
      endTime: end,
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
    end,
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

// codex 85-tk-I-T90-1b: the gate read the log's side off `logIsFrom` at the
// round's start while the producer asks `auraStandsForPressAt` at the aura's
// instant — a log inside the stated band after the 12.1.5 go-live (an
// Adelaide line, UTC+9:30/+10:30, states its instant late) sat on different
// sides for the two.
describe("doomWindsNoPressReading", () => {
  const GOLIVE = Date.UTC(2026, 9, 13, 15, 0, 0);
  const enemyCd = ["0:05 [ENEMY CD] 2(Shaman) Doom Winds"];
  const round = (statedAtAuraMs: number) => [
    // one offset per match: stated = parsed + offset
    unit("Owner", "1", 1, { logClockOffsetMs: statedAtAuraMs - at(5_000) }),
    unit("Shaman", "2", 2, {
      logClockOffsetMs: statedAtAuraMs - at(5_000),
      auraEvents: [
        {
          ...aura(LogEvent.SPELL_AURA_APPLIED, 5_000, "466772", "Doom Winds"),
          srcUnitId: "Shaman",
          destUnitId: "Shaman",
        },
      ],
    }),
  ];
  const seen = (statedAtAuraMs: number) =>
    scan(runFact11, round(statedAtAuraMs), enemyCd)
      .filter((v) => v.check === "doomWindsNoPressReading")
      .map((v) => v.kind);

  it("自述时刻落在上线后 45 分钟内:生产方读成按键,门规跟着读,不报 proc as press", () => {
    expect(seen(GOLIVE + 15 * 60_000)).toEqual([]);
    expect(seen(GOLIVE - 60_000)).toEqual([]);
  });

  it("上线 45 分钟以后:光环不再代表按键,[ENEMY CD] 行照旧被报", () => {
    expect(seen(GOLIVE + 45 * 60_000)).toEqual(["proc as press"]);
  });
});

describe("duringEndRow", () => {
  const line = (seconds: string) =>
    `0:10  [ENEMY DEF] 3(Healer) (monk): Obsidian Scales → 2(Target) (${seconds}s) | during it: 1(Ally) 10k on target · 100% of their enemy-player damage`;
  const scales = (event: LogEvent, ms: number) =>
    aura(event, ms, "363916", "Obsidian Scales");
  const rows = (auraEvents: any[], more = {}) => [
    unit("Ally", "1", 1),
    unit("Target", "2", 2, {
      auraEvents,
      damageIn: [landed(10_100, "Ally", 10_000)],
      ...more,
    }),
  ];
  const seen = (players: any[], seconds: string) =>
    of(scan(runDamageBasis, players, [line(seconds)]), "duringEndRow");

  it("the printed length lands on the wall's REMOVED row", () => {
    expect(
      seen(
        rows([
          scales(LogEvent.SPELL_AURA_APPLIED, 10_000),
          scales(LogEvent.SPELL_AURA_REMOVED, 22_007),
        ]),
        "12.0",
      ),
    ).toEqual([]);
  });

  it("a REMOVED with an APPLIED in its millisecond is the aura stated again, not its end (4cacc702 0:15)", () => {
    expect(
      seen(
        rows([
          scales(LogEvent.SPELL_AURA_APPLIED, 10_826),
          scales(LogEvent.SPELL_AURA_REMOVED, 14_258),
          scales(LogEvent.SPELL_AURA_APPLIED, 14_258),
          scales(LogEvent.SPELL_AURA_REMOVED, 22_840),
        ]),
        "12.0",
      ),
    ).toEqual([]);
  });

  it("a second press on a holder closes the line at its REFRESH (9-3 r3 0:30, 1.0 s)", () => {
    expect(
      seen(
        rows([
          scales(LogEvent.SPELL_AURA_APPLIED, 10_461),
          scales(LogEvent.SPELL_AURA_REFRESH, 11_502),
          scales(LogEvent.SPELL_AURA_REMOVED, 17_272),
        ]),
        "1.0",
      ),
    ).toEqual([]);
  });

  it("an aura still up at the target's death prints the length to it", () => {
    expect(
      seen(
        rows(
          [
            scales(LogEvent.SPELL_AURA_APPLIED, 10_903),
            scales(LogEvent.SPELL_AURA_REMOVED, 22_910),
          ],
          { deathRecords: [{ timestamp: at(22_512) }] },
        ),
        "11.6",
      ),
    ).toEqual([]);
  });

  it("an aura first stated in a re-stating batch and removed early is read from that row (135 r2 2:07, 4.4 s)", () => {
    const batch = [1, 2, 3, 4, 5].map((i) =>
      rowOf(LogEvent.SPELL_AURA_APPLIED, 11_167, {
        spellId: `90${i}`,
        spellName: `Other ${i}`,
        srcUnitId: "ext",
        destUnitId: "Target",
      }),
    );
    const players = [
      unit("Ally", "1", 1),
      unit("Target", "2", 2, {
        auraEvents: [
          ...batch,
          {
            ...scales(LogEvent.SPELL_AURA_APPLIED, 11_167),
            destUnitId: "Target",
          },
          scales(LogEvent.SPELL_AURA_REMOVED, 15_571),
        ],
        damageIn: [landed(12_000, "Ally", 10_000)],
      }),
      unit("Healer", "3", 2, {
        spellCastEvents: [
          cast(10_000, "Healer", "363916", "Obsidian Scales", "Target"),
        ],
      }),
    ];
    expect(seen(players, "4.4")).toEqual([]);
  });

  it("flags a printed length no row carries", () => {
    expect(
      seen(
        rows([
          scales(LogEvent.SPELL_AURA_APPLIED, 10_000),
          scales(LogEvent.SPELL_AURA_REMOVED, 22_007),
        ]),
        "8.0",
      ),
    ).toHaveLength(1);
  });

  it("flags a line with no opening row of the wall", () => {
    expect(
      seen(rows([scales(LogEvent.SPELL_AURA_REMOVED, 22_007)]), "12.0"),
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

  describe("a wall with no verdict against spells (Evasion: `never`)", () => {
    const players = (id: string, name: string) =>
      team(
        {
          damageOut: [dmg("12294", "Mortal Strike", 500), dmg(id, name, 500)],
          spellCastEvents: presses(id, name),
        },
        { auraEvents: wall("5277", "Evasion") },
      );
    const lines = [line("Mortal Strike", "Evasion")];

    it("leaves out a spell a dodge cannot stop (Hammer of Wrath, 30 yd)", () => {
      expect(
        of(
          scan(runDamageBasis, players("24275", "Hammer of Wrath"), lines),
          "abilityIntoWallShare",
        ),
      ).toEqual([]);
    });

    it("still flags a melee strike left out of the line (Final Verdict)", () => {
      expect(
        of(
          scan(runDamageBasis, players("383328", "Final Verdict"), lines),
          "abilityIntoWallShare",
        ),
      ).toHaveLength(1);
    });
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
  // GH #173 (44333434 r1 1:35): a Force of Nature (10 s) running into the
  // printed second is what the press instant read — the product's own
  // summon reading (`offensiveSummonActiveAt`), not Archangel
  it("a summon running at either end of the second stands behind the tag; one gone before it does not", () => {
    const withTreants = (pressMs: number) =>
      of(
        scan(
          runFriendlyOffensiveTag,
          [
            unit("Ally", "1", 1, {
              info: {},
              spec: "102",
              auraEvents: [up("81700")],
              spellCastEvents: [
                rowOf(LogEvent.SPELL_CAST_SUCCESS, pressMs, {
                  spellId: "205636",
                  spellName: "Force of Nature",
                  srcUnitId: "Ally",
                }),
              ],
            }),
            unit("Enemy", "2", 2, { info: {} }),
          ],
          [line],
        ),
        "offensiveTagWrong",
      );
    expect(withTreants(17_500)).toEqual([]);
    expect(withTreants(16_500)).toHaveLength(1);
  });
  // pipeline T30: an aura whose end the log never wrote is up for its
  // official length (+1 s), the product's reading — not to the round's end
  const untagged = (at: string) =>
    `${at}  [ENEMY DEF]   2(RPaladin) (Retribution Paladin): Divine Protection (20%, 8.0s) (at 71% HP)`;
  const untaggedSeen = (
    lines: string[],
    allyAuras: string[],
    enemyAuras: string[],
  ) =>
    of(
      scan(
        runFriendlyOffensiveTag,
        [
          unit("Ally", "1", 1, { info: {}, auraEvents: allyAuras.map(up) }),
          unit("Enemy", "2", 2, { info: {}, auraEvents: enemyAuras.map(up) }),
        ],
        lines,
      ),
      "offensiveTagWrong",
    );
  it("a Colossus Smash debuff with no REMOVED is gone after its length", () => {
    expect(untaggedSeen([untagged("0:15")], [], ["208086"])).toHaveLength(1);
    expect(untaggedSeen([untagged("0:27")], [], ["208086"])).toEqual([]);
  });
  // the product's window, not a copy of it (codex 85-tk-D-T30-1 / -1b): a
  // Metamorphosis form with no press runs Demonic's 5 s; one pressed into it
  // at 20 s is the press's occurrence, 20 s to 44 s
  const meta = (at: string, pressMs?: number) =>
    of(
      scan(
        runFriendlyOffensiveTag,
        [
          unit("Ally", "1", 1, {
            info: {},
            auraEvents: [
              { ...up("162264"), destUnitId: "Ally", auraType: "BUFF" },
            ],
            spellCastEvents:
              pressMs === undefined
                ? []
                : [
                    rowOf(LogEvent.SPELL_CAST_SUCCESS, pressMs, {
                      spellId: "200166",
                      spellName: "Metamorphosis",
                      srcUnitId: "Ally",
                    }),
                  ],
          }),
          unit("Enemy", "2", 2, { info: {} }),
        ],
        [untagged(at)],
      ),
      "offensiveTagWrong",
    );
  it("a Metamorphosis form is up while the product's occurrence is (codex 85-tk-D-T30-1 / -1b)", () => {
    expect(meta("0:40", 20_000)).toHaveLength(1);
    expect(meta("0:45", 20_000)).toEqual([]);
  });
  // user ruling 2026-11-09 (pipeline T30): the tag reads spent cooldowns
  // only, and a Demonic form (no press) spends none — inside its 5 s too
  it("a Metamorphosis form with no press is no running cooldown", () => {
    expect(meta("0:15")).toEqual([]);
    expect(meta("0:18")).toEqual([]);
  });
  it("an aura the product files under its cooldown is asked as that cooldown (383410 → 194223, codex 85-tk-D-T30-1c)", () => {
    const buff = (event: string, ms: number, spellId: string) => ({
      ...rowOf(event, ms, { spellId, spellName: "x", srcUnitId: "Ally" }),
      destUnitId: "Ally",
      auraType: "BUFF",
    });
    const found = scan(
      runFriendlyOffensiveTag,
      [
        unit("Ally", "1", 1, {
          info: {},
          auraEvents: [
            buff(LogEvent.SPELL_AURA_APPLIED, 12_000, "383410"),
            buff(LogEvent.SPELL_AURA_APPLIED, 25_000, "81700"),
            buff(LogEvent.SPELL_AURA_REFRESH, 31_000, "383410"),
          ],
        }),
        unit("Enemy", "2", 2, { info: {} }),
      ],
      [
        "0:29  [ENEMY DEF]   2(RPaladin) (Retribution Paladin): Divine Protection (20%, 8.0s) [friendly offensive CD active] (at 71% HP)",
      ],
    );
    expect(found.filter((v) => v.kind === "cdLessOnly")).toEqual([]);
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
            debuff(LogEvent.SPELL_AURA_REMOVED, 45_000, "383346", "Ret"),
          ],
          damageIn: [],
        },
        1,
        [raw],
      ),
    ).toEqual([]);
  });

  it("a run that lost its REMOVED ends at its official length (fact8 D19, 7-1-45 0:34)", () => {
    const rows = {
      auraEvents: [
        debuff(LogEvent.SPELL_AURA_APPLIED, 10_000, "589", "Priest"),
        debuff(LogEvent.SPELL_AURA_APPLIED, 45_000, "589", "Priest"),
      ],
      damageIn: [tick(11_000, "589", "Priest")],
    };
    expect(seen(rows, 0)).toEqual([]);
    expect(seen(rows, 1)).toHaveLength(1);
  });

  it("a REMOVED under the controller is the Mind-Controlled caster's run ending, not a lost one", () => {
    const rows = {
      auraEvents: [
        debuff(LogEvent.SPELL_AURA_APPLIED, 10_000, "589", "Priest"),
        debuff(LogEvent.SPELL_AURA_REMOVED, 45_000, "589", "Controller"),
      ],
      damageIn: [tick(11_000, "589", "Priest")],
    };
    expect(seen(rows, 1)).toEqual([]);
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

describe("kitRangeBelowSeen: a dated reset is its talent's (codex 20-F26-07 #5)", () => {
  const lines = [
    '  <unit id="2" name="Dh" spec="Devourer Demon Hunter" role="enemy">',
    "    <cooldowns>The Hunt [0–90s]</cooldowns>",
  ];
  const seen = (talents: any[]) =>
    of(
      scan(
        runOverrideVariant,
        [
          unit("Dh", "2", 1, {
            spec: CombatUnitSpec.DemonHunter_Devourer,
            info: { talents, pvpTalents: [] },
            spellCastEvents: [cast(10_000, "Dh", "1246167", "The Hunt")],
            auraEvents: [
              rowOf(LogEvent.SPELL_AURA_APPLIED, 10_500, {
                spellId: "1217607",
                spellName: "Void Metamorphosis",
                srcUnitId: "Dh",
                destUnitId: "Dh",
              }),
            ],
          }),
        ],
        lines,
      ),
      "kitRangeBelowSeen",
    );
  it("Violent Transformation held (node 110115): a true 0", () => {
    expect(seen([{ id1: 110115, id2: 0, count: 1 }])).toEqual([]);
  });
  it("not held: the 0 is flagged", () => {
    expect(seen([])).toHaveLength(1);
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

describe("listGapPress — a press that spent nothing (GH #179 batch 3b)", () => {
  // Cauterizing Flame: 60 s, its cooldown only when it removed something
  const flame = (dispelled: boolean) => [
    unit("Owner", "1", 1, {
      info: { teamId: "0" },
      spec: CombatUnitSpec.Evoker_Preservation,
      spellCastEvents: [cast(10_200, "Owner", "374251", "Cauterizing Flame")],
      actionOut: dispelled
        ? [
            rowOf(LogEvent.SPELL_DISPEL, 10_200, {
              srcUnitId: "Owner",
              spellId: "374251",
              extraSpellId: "703",
            }),
          ]
        : [],
    }),
  ];
  it("a Cauterizing Flame that removed nothing owes no line", () => {
    expect(of(scan(runListGap, flame(false), []), "listGapPress")).toEqual([]);
    expect(of(scan(runListGap, flame(true), []), "listGapPress")).toHaveLength(
      1,
    );
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

// GH #182: a Stasis release the log wrote no SUCCESS for (the ready aura's
// early REMOVED, `stasisReleasePressesMs`) ends another kick's lock in the
// analysis; the check must read it as well.
describe("pressOutsideButLocked: an inferred Stasis release ends a lock", () => {
  const kick = (ms: number, extraSpellId: string) =>
    rowOf("SPELL_INTERRUPT", ms, {
      srcUnitId: "rogue",
      spellId: "1766",
      spellName: "Kick",
      extraSpellId,
    });
  const run = (released: boolean): IViolation[] => {
    const evoker = unit("Evo", "1", 1, {
      actionIn: [kick(10_000, "355936"), kick(11_000, "356995")],
      auraEvents: released
        ? [
            aura(LogEvent.SPELL_AURA_APPLIED, 5_000, "370562", "Stasis"),
            aura(LogEvent.SPELL_AURA_REMOVED, 12_000, "370562", "Stasis"),
          ]
        : [],
      // a stored Living Flame replayed after the release
      spellCastEvents: released
        ? [cast(12_020, "Evo", "361469", "Living Flame", "Evo")]
        : [],
      castStartEvents: [],
    });
    const rogue = unit("rogue", "2", 2);
    const seen: IViolation[] = [];
    runFact9b({
      lines: [],
      menu: "- id=kick-eaten:Evo:10 type=kick-eaten t=10.00s facts={postKick=outside the locked school 1x (Disintegrate +2.5s)}",
      rawLines: [],
      players: [evoker, rogue],
      units: [evoker, rogue],
      byName: new Map([
        ["Evo", evoker],
        ["rogue", rogue],
      ]),
      owner: evoker,
      ownerName: "Evo",
      start: START,
      end: at(600_000),
      roundEndAt: at(600_000),
      pidOf: (n: string) => (n === "Evo" ? "1" : "2"),
      rawStreams: () => ({
        castFailed: [
          {
            unitGuid: "Evo",
            spellId: "356995",
            spellName: "Disintegrate",
            tSeconds: 12.5,
          },
        ],
      }),
      violate: (
        check: string,
        kind: string,
        _t: number,
        _f: string,
        detail: string,
      ) => seen.push({ check, kind, detail }),
      bump: () => {},
    } as any);
    return seen.filter((v) => v.check === "pressOutsideButLocked");
  };

  it("the release at 12 s ends the 11 s Disintegrate kick's lock", () => {
    expect(run(true)).toEqual([]);
  });

  it("without the release the later lock still covers the press", () => {
    expect(run(false).map((v) => v.kind)).toEqual(["laterLock"]);
  });
});

// GH #181: the 5 % floor reads the reflect chain's whole Nether Ward return at
// its FIRST reflect, as `reflectedSpells` does — not one row at the latest.
describe("wardReturnMisnamed: the floor is the chain's, at its first reflect", () => {
  const reflect = (ms: number) =>
    rowOf("SPELL_MISSED", ms, {
      srcUnitId: "Lock",
      destUnitId: "W",
      spellId: "980",
      spellName: "Agony",
      missType: "REFLECT",
    });
  const ward = (ms: number, amount: number) =>
    rowOf(LogEvent.SPELL_DAMAGE, ms, {
      srcUnitId: "W",
      spellId: "212295",
      spellName: "Nether Ward",
      effectiveAmount: -amount,
    });
  // the reflector's Agony put on the caster in the row's ms names it
  const agonyOn = (ms: number) => ({
    ...aura(LogEvent.SPELL_AURA_APPLIED, ms, "980", "Agony"),
    srcUnitId: "W",
  });
  const hp = (ms: number, max: number) => ({
    advancedActorMaxHp: max,
    advancedActorCurrentHp: max,
    timestamp: at(ms),
    logLine: { timestamp: at(ms) },
  });
  const run = (
    wards: Array<[number, number]>,
    hps: Array<[number, number]>,
    absorbsIn: any[] = [],
  ): string[] => {
    const caster = {
      ...makeUnit("Lock", {
        damageIn: wards.map(([ms, amt]) => ward(ms, amt)),
        auraEvents: wards.map(([ms]) => agonyOn(ms)),
        advancedActions: hps.map(([ms, max]) => hp(ms, max)),
      }),
      absorbsIn,
      missesOut: [reflect(10_000), reflect(11_000)],
      pid: "1",
    };
    const w = { ...makeUnit("W"), pid: "2" };
    return of(
      scan(
        (ctx) => runFact9({ ...ctx, firstOwnerOfRound: true }),
        [caster, w],
        [],
      ),
      "wardReturnMisnamed",
    );
  };

  it("one row over the floor at the latest reflect, under it at the first: no line is owed", () => {
    // 52k: 5.2 % of 1.0M at 11 s, 4.3 % of 1.2M at 10 s
    expect(
      run(
        [[11_200, 52_000]],
        [
          [10_000, 1_200_000],
          [11_000, 1_000_000],
          [11_200, 1_000_000],
        ],
      ),
    ).toEqual([]);
  });

  it("an absorb two rows of one millisecond both name counts once (codex review)", () => {
    // 10k + 10k + one 20k absorb = 40k, under 5 % of 1.0M; counted per row
    // it read 60k and demanded a line
    const absorb = {
      ...absorbed(11_200, "W", 20_000, "17"),
      attackSpellId: "212295",
    };
    expect(
      run(
        [
          [11_200, 10_000],
          [11_200, 10_000],
        ],
        [
          [10_000, 1_000_000],
          [11_200, 1_000_000],
        ],
        [absorb],
      ),
    ).toEqual([]);
  });

  it("two rows each under the floor, together over it: the missing line is caught", () => {
    const seen = run(
      [
        [10_200, 30_000],
        [11_200, 30_000],
      ],
      [
        [10_000, 1_000_000],
        [11_200, 1_000_000],
      ],
    );
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain("Agony came back 60k");
  });
});

describe("resCdBeforeNextPress: rows that are no next press (GH #177 checks)", () => {
  // a `[RES]` row at 0:23 with Power Infusion 120 s on cooldown
  const res = "      [RES] rdy:—  cd:Power Infusion(120s)";
  const priest = (rows: any[]) =>
    unit("Priest", "1", 0, { spellCastEvents: rows, auraEvents: [] });
  const viol = (rows: any[], roundEndAt?: number) =>
    of(
      scan(
        runFact8,
        [priest(rows)],
        ["0:23  [STATE] x", res],
        "",
        [],
        roundEndAt,
      ),
      "resCdBeforeNextPress",
    );
  it("Power Infusion's self copy 25 ms after the press is that press (dca02448 r4)", () => {
    const rows = [
      cast(23_979, "Priest", "10060", "Power Infusion", "Mate"),
      cast(24_004, "Priest", "10060", "Power Infusion", "Priest"),
    ];
    expect(viol(rows)).toEqual([]);
    // a second press half a second on is a press
    expect(
      viol([
        ...rows,
        cast(24_500, "Priest", "10060", "Power Infusion", "Mate"),
      ]),
    ).toHaveLength(1);
  });
  it("a press after the round's end of play is the next round's preparation (05b762f1 r1)", () => {
    const rows = [
      cast(23_000, "Priest", "10060", "Power Infusion", "Mate"),
      cast(60_000, "Priest", "10060", "Power Infusion", "Mate"),
    ];
    expect(viol(rows, at(50_000))).toEqual([]);
    expect(viol(rows, at(90_000))).toHaveLength(1);
  });
});

describe("immuneCauseCannotStopDamage: the enemy's Cyclone on a teammate (GH #167)", () => {
  // the owner's Riptide at 0:22 refused IMMUNE on the teammate, whose
  // aura rows carry `cycloneId` from the enemy at 0:20
  const viol = (cycloneId: string, cycloneName: string) => {
    const owner = unit("Me", "1", 1, {
      spellCastEvents: [cast(22_000, "Me", "61295", "Riptide", "Mate")],
      missesOut: [
        rowOf(LogEvent.SPELL_MISSED, 22_000, {
          srcUnitId: "Me",
          destUnitId: "Mate",
          spellId: "61295",
          spellName: "Riptide",
          missType: "IMMUNE",
        }),
      ],
    });
    const mate = unit("Mate", "2", 1, {
      auraEvents: [
        rowOf(LogEvent.SPELL_AURA_APPLIED, 20_000, {
          srcUnitId: "Foe",
          destUnitId: "Mate",
          spellId: cycloneId,
          spellName: cycloneName,
        }),
      ],
    });
    const foe = unit("Foe", "4", 2);
    return of(
      scan(
        runFact11,
        [owner, mate, foe],
        [
          `0:22  [YOU] [CAST]   Riptide → 2(AWarrior) [IMMUNE — ${cycloneName} was up]`,
        ],
      ),
      "immuneCauseCannotStopDamage",
    );
  };
  it("names a control the holder takes nothing through: no violation", () => {
    expect(viol("33786", "Cyclone")).toEqual([]);
  });
  it("an aura that stops no heal is still caught", () => {
    expect(viol("1044", "Blessing of Freedom")).toHaveLength(1);
  });
});

describe("immunityBurstAnchor: the all-refused clause (GH #167)", () => {
  // our Mage's Ray of Frost into the Rogue at 2:09; `refused` logs IMMUNE
  const viol = (refused: boolean, clause: boolean) => {
    const mage = unit("Mage", "1", 1, {
      spellCastEvents: [
        cast(129_000, "Mage", "205021", "Ray of Frost", "Rogue"),
      ],
      missesOut: refused
        ? [
            rowOf(LogEvent.SPELL_MISSED, 129_010, {
              srcUnitId: "Mage",
              destUnitId: "Rogue",
              spellId: "205021",
              spellName: "Ray of Frost",
              missType: "IMMUNE",
            }),
          ]
        : [],
      damageOut: [],
    });
    const rogue = unit("Rogue", "4", 2, { auraEvents: [] });
    const line = `  [2:09–2:09] on Rogue — Ray of Frost burst (no stun)${clause ? " | every Ray of Frost press into the target logged IMMUNE" : ""} | opportunity: trinket up (no softer target) | team focus 90% (0.10M on target inside it, 0.10M incl. the 5 s after) | FAILED: not enough damage`;
    return scan(runImmunity, [mage, rogue], [line])
      .filter((v) => v.check === "immunityBurstAnchor")
      .map((v) => v.kind);
  };
  it("every press refused: the line must say so", () => {
    expect(viol(true, true)).toEqual([]);
    expect(viol(true, false)).toEqual(["clause missing"]);
  });
  it("a press that went in: no clause", () => {
    expect(viol(false, false)).toEqual([]);
    expect(viol(false, true)).toEqual(["clause wrong"]);
  });
  it("a second caster's landed press nearby is another burst's: the clause stands (codex review)", () => {
    const mage = (name: string, pid: string, ms: number, refused: boolean) =>
      unit(name, pid, 1, {
        spellCastEvents: [cast(ms, name, "205021", "Ray of Frost", "Rogue")],
        missesOut: refused
          ? [
              rowOf(LogEvent.SPELL_MISSED, ms + 10, {
                srcUnitId: name,
                destUnitId: "Rogue",
                spellId: "205021",
                spellName: "Ray of Frost",
                missType: "IMMUNE",
              }),
            ]
          : [],
        damageOut: [],
      });
    const rogue = unit("Rogue", "4", 2, { auraEvents: [] });
    const line =
      "  [0:40–0:40] on Rogue — Ray of Frost burst (no stun) | every Ray of Frost press into the target logged IMMUNE | opportunity: trinket up (no softer target) | team focus 90% (0.10M on target inside it, 0.10M incl. the 5 s after) | FAILED: not enough damage";
    const kinds = (players: any[]) =>
      scan(runImmunity, players, [line])
        .filter((v) => v.check === "immunityBurstAnchor")
        .map((v) => v.kind);
    expect(
      kinds([
        mage("MageA", "1", 40_000, true),
        mage("MageB", "2", 40_800, false),
        rogue,
      ]),
    ).toEqual([]);
    // neither caster's presses were all refused: still wrong
    expect(
      kinds([
        mage("MageA", "1", 40_000, false),
        mage("MageB", "2", 40_800, false),
        rogue,
      ]),
    ).toEqual(["clause wrong"]);
  });
  it("a refusal logged under the press's effect id is the press refused (castAndEffectIds)", () => {
    // 605 run s1/38-1-219 1:23: The Hunt 370965 refused as 370969
    const hunt = (missId: string) =>
      unit("DH", "1", 1, {
        spellCastEvents: [cast(83_000, "DH", "370965", "The Hunt", "Rogue")],
        missesOut: [
          rowOf(LogEvent.SPELL_MISSED, 83_300, {
            srcUnitId: "DH",
            destUnitId: "Rogue",
            spellId: missId,
            spellName: "The Hunt",
            missType: "IMMUNE",
          }),
        ],
        damageOut: [],
      });
    const rogue = unit("Rogue", "4", 2, { auraEvents: [] });
    const line =
      "  [1:23–1:23] on Rogue — The Hunt burst (no stun) | every The Hunt press into the target logged IMMUNE | opportunity: trinket up (no softer target) | team focus 90% (0.10M on target inside it, 0.10M incl. the 5 s after) | FAILED: not enough damage";
    const kinds = (missId: string) =>
      scan(runImmunity, [hunt(missId), rogue], [line])
        .filter((v) => v.check === "immunityBurstAnchor")
        .map((v) => v.kind);
    expect(kinds("370969")).toEqual([]);
    // an id outside the press's family is not its refusal
    expect(kinds("1")).toEqual(["clause wrong"]);
  });
  it("a hit in the next press's own millisecond is the next press's (codex review)", () => {
    // refused at 0:40; the caster's next Ray of Frost at 0:44.000 hits at
    // 0:44.000 — inside this line's 5 s tail, but that press's hit
    const mage = (hitMs: number) =>
      unit("Mage", "1", 1, {
        spellCastEvents: [
          cast(40_000, "Mage", "205021", "Ray of Frost", "Rogue"),
          cast(44_000, "Mage", "205021", "Ray of Frost", "Rogue"),
        ],
        missesOut: [
          rowOf(LogEvent.SPELL_MISSED, 40_010, {
            srcUnitId: "Mage",
            destUnitId: "Rogue",
            spellId: "205021",
            spellName: "Ray of Frost",
            missType: "IMMUNE",
          }),
        ],
        damageOut: [
          rowOf(LogEvent.SPELL_DAMAGE, hitMs, {
            srcUnitId: "Mage",
            destUnitId: "Rogue",
            spellId: "205021",
            spellName: "Ray of Frost",
            effectiveAmount: -10_000,
          }),
        ],
      });
    const rogue = unit("Rogue", "4", 2, { auraEvents: [] });
    const line =
      "  [0:40–0:40] on Rogue — Ray of Frost burst (no stun) | every Ray of Frost press into the target logged IMMUNE | opportunity: trinket up (no softer target) | team focus 90% (0.10M on target inside it, 0.10M incl. the 5 s after) | FAILED: not enough damage";
    const kinds = (hitMs: number) =>
      scan(runImmunity, [mage(hitMs), rogue], [line])
        .filter((v) => v.check === "immunityBurstAnchor")
        .map((v) => v.kind);
    expect(kinds(44_000)).toEqual([]);
    expect(kinds(43_999)).toEqual(["clause wrong"]);
  });
  it("a same-named impact row is no next press: its hit lands the press (s0/167-2 1:33)", () => {
    // Takedown 1250646 refused at 1:33.750; its leap 1253859 logged as a
    // cast and a hit on the target at 1:34.270
    const hunter = unit("Hunter", "1", 1, {
      spellCastEvents: [
        cast(93_750, "Hunter", "1250646", "Takedown", "Rogue"),
        cast(94_270, "Hunter", "1253859", "Takedown"),
      ],
      missesOut: [
        rowOf(LogEvent.SPELL_MISSED, 93_750, {
          srcUnitId: "Hunter",
          destUnitId: "Rogue",
          spellId: "1250646",
          spellName: "Takedown",
          missType: "IMMUNE",
        }),
      ],
      damageOut: [
        rowOf(LogEvent.SPELL_DAMAGE, 94_270, {
          srcUnitId: "Hunter",
          destUnitId: "Rogue",
          spellId: "1253859",
          spellName: "Takedown",
          effectiveAmount: -35_245,
        }),
      ],
    });
    const rogue = unit("Rogue", "4", 2, { auraEvents: [] });
    const line =
      "  [1:33–1:57] on Rogue — Takedown burst (no stun) | opportunity: trinket up (no softer target) | team focus 90% (0.10M on target inside it, 0.10M incl. the 5 s after) | FAILED: not enough damage";
    expect(
      scan(runImmunity, [hunter, rogue], [line])
        .filter((v) => v.check === "immunityBurstAnchor")
        .map((v) => v.kind),
    ).toEqual([]);
  });
});

describe("immunityPressTag: a press's impact row is the press (codex review)", () => {
  it("a refusal logged under the impact's own id is the press's: its line must carry [IMMUNE", () => {
    const dh = unit("DH", "1", 1, {
      spellCastEvents: [
        cast(83_000, "DH", "370965", "The Hunt", "Rogue"),
        cast(83_300, "DH", "370966", "The Hunt", "Rogue"),
      ],
      missesOut: [
        rowOf(LogEvent.SPELL_MISSED, 83_300, {
          srcUnitId: "DH",
          destUnitId: "Rogue",
          spellId: "370966",
          spellName: "The Hunt",
          missType: "IMMUNE",
        }),
      ],
      damageOut: [],
    });
    const rogue = unit("Rogue", "4", 2, { auraEvents: [] });
    const kinds = (line: string) =>
      scan(runImmunity, [dh, rogue], [line])
        .filter((x) => x.check === "immunityPressTag")
        .map((x) => x.kind);
    expect(kinds("1:23  [YOU] [CD]   The Hunt → 4(Rogue)")).toEqual([
      "press line without [IMMUNE",
    ]);
    expect(kinds("1:23  [YOU] [CD]   The Hunt → 4(Rogue) [IMMUNE]")).toEqual(
      [],
    );
  });
  it("The Hunt's 370966 impact refused under 370969 asks no line of its own", () => {
    const dh = unit("DH", "1", 1, {
      spellCastEvents: [
        cast(83_900, "DH", "370965", "The Hunt", "Rogue"),
        cast(84_200, "DH", "370966", "The Hunt", "Rogue"),
      ],
      missesOut: [
        rowOf(LogEvent.SPELL_MISSED, 84_200, {
          srcUnitId: "DH",
          destUnitId: "Rogue",
          spellId: "370969",
          spellName: "The Hunt",
          missType: "IMMUNE",
        }),
      ],
      damageOut: [],
    });
    const rogue = unit("Rogue", "4", 2, { auraEvents: [] });
    const v = scan(
      runImmunity,
      [dh, rogue],
      ["1:23  [YOU] [CD]   The Hunt → 4(Rogue) [IMMUNE]"],
    ).filter((x) => x.check === "immunityPressTag");
    expect(v.map((x) => x.detail)).toEqual([]);
  });
});

describe("immunityPressTag: the tag sits on the refused press's own line (T85, codex 85-tk-H-T85-1 #5)", () => {
  const BLAST = "999990001";
  const priest = unit("Priest", "1", 1, {
    spellCastEvents: [
      cast(24_118, "Priest", BLAST, "Void Blast", "A"),
      cast(24_837, "Priest", BLAST, "Void Blast", "B"),
    ],
    missesOut: [
      rowOf(LogEvent.SPELL_MISSED, 24_837, {
        srcUnitId: "Priest",
        destUnitId: "B",
        spellId: BLAST,
        spellName: "Void Blast",
        missType: "IMMUNE",
      }),
    ],
    damageOut: [],
  });
  const a = unit("A", "4", 2, { auraEvents: [] });
  const b = unit("B", "5", 2, { auraEvents: [] });
  const kinds = (lines: string[]) =>
    scan(runImmunity, [priest, a, b], lines)
      .filter((x) => x.check === "immunityPressTag")
      .map((x) => x.kind);

  it("two presses in one second, the refused one tagged: no row", () => {
    expect(
      kinds([
        "0:24  [YOU] [CAST]   Void Blast → 4(A)",
        "0:24  [YOU] [CAST]   Void Blast → 5(B) [IMMUNE]",
      ]),
    ).toEqual([]);
  });

  it("the tag on the landed press's line does not pass for the refused one's", () => {
    expect(
      kinds([
        "0:24  [YOU] [CAST]   Void Blast → 4(A) [IMMUNE]",
        "0:24  [YOU] [CAST]   Void Blast → 5(B)",
      ]),
    ).toEqual(["press line without [IMMUNE"]);
  });
});

describe("resEnemyEffectAfterDeath: a source-less REMOVED closes the aura (T03, codex P2)", () => {
  // the Arms Warrior's Avatar up at 10 s, its REMOVED written with no
  // source at 15 s, the warrior dead at 15.04 s; the 0:15 row under its
  // `[DEATH]` still lists it
  const viol = (removedSrc: string | undefined) => {
    const avatar = (event: string, ms: number, srcUnitId?: string) =>
      rowOf(event, ms, {
        srcUnitId,
        srcUnitName: srcUnitId ?? "nil",
        destUnitId: "Warr",
        spellId: "107574",
        spellName: "Avatar",
      });
    const owner = unit("Mage", "1", 1);
    const warr = unit("Warr", "4", 2, {
      auraEvents: [
        avatar(LogEvent.SPELL_AURA_APPLIED, 10_000, "Warr"),
        ...(removedSrc === "none"
          ? []
          : [avatar(LogEvent.SPELL_AURA_REMOVED, 15_000, removedSrc)]),
      ],
      deathRecords: [{ timestamp: at(15_040) }],
    });
    return of(
      scan(
        runFact12,
        [owner, warr],
        [
          `<unit id="4" name="Warr" spec="Arms Warrior" role="enemy">`,
          "0:15  [DEATH]  4(AWarrior) (Arms Warrior — enemy)",
          "      [RES] rdy:Δ  cd:—  enemy:Avatar/Arms Warrior(15s left)",
        ],
      ),
      "resEnemyEffectAfterDeath",
    );
  };
  it("a REMOVED with no source GUID ends the warrior's Avatar: the row is caught", () => {
    expect(viol(undefined)).toHaveLength(1);
    expect(viol("0000000000000000")).toHaveLength(1);
    expect(viol("Warr")).toHaveLength(1);
  });
  it("an Avatar the log never closes runs its official length: no violation", () => {
    expect(viol("none")).toEqual([]);
  });
});

describe("T58 — an effect is read by its press's ids, not by the entry's name alone", () => {
  // Predator's Wake 1259431 pressed at 136.76 s; its own aura off at the
  // landing; its DoT 1246168 — which the log names "The Hunt" — on the
  // target from 136.78 s; the demon hunter dead at 136.88 s
  const viol = (dotRemovedMs: number | undefined) => {
    const aura = (
      event: string,
      ms: number,
      destUnitId: string,
      spellId: string,
      spellName: string,
    ) =>
      rowOf(event, ms, { srcUnitId: "DH", destUnitId, spellId, spellName });
    const own = (event: string, ms: number) =>
      aura(event, ms, "DH", "1259431", "Predator's Wake");
    const dot = (event: string, ms: number) =>
      aura(event, ms, "Warr", "1246168", "The Hunt");
    const dh = unit("DH", "4", 2, {
      spellCastEvents: [
        cast(136_757, "DH", "1259431", "Predator's Wake", "Warr"),
      ],
      auraEvents: [
        own(LogEvent.SPELL_AURA_APPLIED, 136_757),
        own(LogEvent.SPELL_AURA_REMOVED, 136_777),
      ],
      deathRecords: [{ timestamp: at(136_880) }],
    });
    const warr = unit("Warr", "1", 1, {
      auraEvents: [
        dot(LogEvent.SPELL_AURA_APPLIED, 136_777),
        ...(dotRemovedMs === undefined
          ? []
          : [dot(LogEvent.SPELL_AURA_REMOVED, dotRemovedMs)]),
      ],
    });
    return of(
      scan(
        runFact12,
        [warr, dh],
        [
          `<unit id="4" name="DH" spec="Devourer Demon Hunter" role="enemy">`,
          "2:16  [DEATH]  4(DDHunter) (Devourer Demon Hunter — enemy)",
          "      [RES] rdy:Δ  cd:—  enemy:Predator's Wake/Devourer Demon Hunter(7s left)",
        ],
      ),
      "resEnemyEffectAfterDeath",
    );
  };
  it("the DoT ticking on past its caster's death is the effect running on", () => {
    expect(viol(142_762)).toEqual([]);
  });
  it("the DoT gone in the death's cascade too: the row is caught", () => {
    expect(viol(136_900)).toHaveLength(1);
  });
});

describe("T28 — a Solo Shuffle round's end ends the effects it ended, a 3v3's deciding death none", () => {
  // the Arms Warrior's Avatar up at 10 s, REMOVED at 15 s in the round's
  // reset; the round ended at 15.02 s with another player's death; the
  // warrior lives and the 0:15 row lists it
  const avatarRows = [
    rowOf(LogEvent.SPELL_AURA_APPLIED, 10_000, {
      srcUnitId: "Warr",
      destUnitId: "Warr",
      spellId: "107574",
      spellName: "Avatar",
    }),
    rowOf(LogEvent.SPELL_AURA_REMOVED, 15_000, {
      srcUnitId: "Warr",
      destUnitId: "Warr",
      spellId: "107574",
      spellName: "Avatar",
    }),
  ];
  const roundOf = (bracket: string) => {
    const owner = unit("Mage", "1", 1, {
      info: {},
      startInfo: { bracket },
      deathRecords: [{ timestamp: at(15_020) }],
    });
    const warr = unit("Warr", "4", 2, { info: {}, auraEvents: avatarRows });
    return [owner, warr];
  };
  const lines = [
    `<unit id="4" name="Warr" spec="Arms Warrior" role="enemy">`,
    "0:15  [DEATH]  1(FMage) (Fire Mage — friendly)",
    "      [RES] rdy:Δ  cd:—  enemy:Avatar/Arms Warrior(5s left)",
  ];
  it("fact12: a Solo Shuffle round over is caught; a 3v3's deciding death is no round end", () => {
    const seen = (bracket: string) =>
      scan(runFact12, roundOf(bracket), lines).filter(
        (v) => v.check === "resEnemyEffectAfterDeath",
      );
    expect(seen("Rated Solo Shuffle").map((v) => v.kind)).toEqual([
      "effect over (round over)",
    ]);
    expect(seen("Rated Arena 3v3")).toEqual([]);
  });

  // 62-6-367 r6 3:24: Avenging Wrath pressed 55 ms before the round-ending
  // death, its aura never closed before the log ended 40 ms after the round
  it("singles2: a press the round's end ended need not be listed on the end's row", () => {
    const raw = (sec: string, event: string, tail: string) =>
      `8/20/2026 10:00:${sec}  ${event},Warr,"Warr",0x0,0x0,Warr,"Warr",0x0,0x0,${tail}`;
    const rawLines = [
      raw("14.5890", "SPELL_CAST_SUCCESS", '31884,"Avenging Wrath",0x2'),
      raw("14.5890", "SPELL_AURA_APPLIED", '31884,"Avenging Wrath",0x2,BUFF'),
    ];
    const pressRow = {
      ...cast(14_589, "Warr", "31884", "Avenging Wrath"),
      logLine: {
        event: LogEvent.SPELL_CAST_SUCCESS,
        timestamp: at(14_589),
        lineIndex: 0,
      },
    };
    const players = (bracket: string) => {
      const owner = unit("Mage", "1", 1, {
        info: {},
        startInfo: { bracket },
        deathRecords: [{ timestamp: at(14_644) }],
      });
      const warr = unit("Warr", "4", 2, {
        info: {},
        spellCastEvents: [pressRow],
        auraEvents: [
          rowOf(LogEvent.SPELL_AURA_APPLIED, 14_589, {
            srcUnitId: "Warr",
            destUnitId: "Warr",
            spellId: "31884",
            spellName: "Avenging Wrath",
          }),
        ],
      });
      return [owner, warr];
    };
    const rows = [
      "0:14  [ENEMY CD]   4(RPaladin) (Retribution Paladin): Avenging Wrath (cast 1 of 1)",
      "0:14  [DEATH]  1(FMage) (Fire Mage — friendly)",
      "      [RES] rdy:Δ  cd:—",
    ];
    const missing = (bracket: string) =>
      scan(
        runSingles2,
        players(bracket),
        rows,
        "",
        rawLines,
        at(14_644),
        at(14_684),
      )
        .filter((v) => v.check === "resEnemySameSecondPressMissing")
        .map((v) => v.kind);
    expect(missing("Rated Solo Shuffle")).toEqual([]);
    expect(missing("Rated Arena 3v3")).toEqual(["missing"]);
  });
});

describe("staleMaxTickRescaled — a stale row before a max-HP step UP (T09 attempt 2)", () => {
  // cf63da4a 1:43.5 moved to whole seconds: Fortifying Brew's 211,554 grant
  // in the current at 103.8 s, the max at 104.2 s; the brew ends at 115 s
  const hpRow = (ms: number, cur: number, max: number) =>
    rowOf(LogEvent.SPELL_DAMAGE, ms, {
      advancedActorId: "Monk",
      advancedActorCurrentHp: cur,
      advancedActorMaxHp: max,
    });
  const monk = (rows: any[]) => unit("Monk", "1", 1, { advancedActions: rows });
  const brew = [
    hpRow(103_600, 469_387, 1_057_720),
    hpRow(103_700, 453_513, 1_057_720),
    hpRow(103_800, 665_067, 1_057_720), // +211,554: the grant, max not yet
    hpRow(104_200, 450_289, 1_269_274),
    hpRow(115_000, 450_289, 1_057_720), // the brew falls off
  ];
  const tick = (pct: number) => [`1:44  [STATE]   friends 1(Monk):${pct}`];

  it("reads the step up's own new max, not the later step down's", () => {
    // 665,067 / 1,269,274 = 52
    expect(
      of(scan(runFact10, [monk(brew)], tick(52)), "staleMaxTickRescaled"),
    ).toEqual([]);
    // the mixed-scale 63 is still caught
    expect(
      of(scan(runFact10, [monk([...brew])], tick(63)), "staleMaxTickRescaled"),
    ).toHaveLength(1);
  });
});

describe("fact12d ghostReadAsHp / rotPressureNoDamage (T07)", () => {
  // 7edc099d r0: a Holy Priest's Spirit of Redemption 2:32.18 → 2:41.19;
  // `[ROT PRESSURE] … at 36% HP` at 2:37 sat on a `ghost` tick
  const sor = (event: string, ms: number) =>
    rowOf(event, ms, {
      spellId: "27827",
      spellName: "Spirit of Redemption",
      destUnitId: "Priest",
    });
  const priest = unit("Priest", "6", 1, {
    auraEvents: [
      sor(LogEvent.SPELL_AURA_APPLIED, 152_180),
      sor(LogEvent.SPELL_AURA_REMOVED, 161_190),
    ],
    damageIn: [landed(156_500, "ext", 9_000)],
  });
  const lines = (sec: string) => [
    '<unit id="6" name="Priest" spec="Holy Priest" role="friend">',
    `${sec}  [ROT PRESSURE]   6(HPriest) (Holy Priest) at 36% HP with 3 active DoTs`,
  ];

  it("an HP number on a ghost second is caught; one before the form is not", () => {
    expect(
      of(scan(runFact12d, [priest], lines("2:37")), "ghostReadAsHp"),
    ).toHaveLength(1);
    expect(
      of(scan(runFact12d, [priest], lines("2:30")), "ghostReadAsHp"),
    ).toEqual([]);
  });

  it("a [ROT PRESSURE] window with no damage row on the unit is caught", () => {
    // 2:37's window 2:33–2:37 holds the 2:36.5 hit; 2:50's holds none
    expect(
      of(scan(runFact12d, [priest], lines("2:37")), "rotPressureNoDamage"),
    ).toEqual([]);
    expect(
      of(scan(runFact12d, [priest], lines("2:50")), "rotPressureNoDamage"),
    ).toHaveLength(1);
  });
});

describe("unusedPressedBeforeRoundEnd — a press up before the round's end (T05)", () => {
  // 52a97230 r0: Metamorphosis' 162264 up at 32.885 s, the deciding death at
  // 33.744 s, the 200166 landing row at 33.809 s
  const dh = (auraMs: number | null) =>
    unit("Dh", "1", 1, {
      info: {},
      startInfo: { bracket: "Rated Solo Shuffle" },
      spellCastEvents: [cast(33_809, "Dh", "200166", "Metamorphosis")],
      auraEvents:
        auraMs === null
          ? []
          : [
              {
                ...aura(
                  LogEvent.SPELL_AURA_APPLIED,
                  auraMs,
                  "162264",
                  "Metamorphosis",
                ),
                srcUnitId: "Dh",
                destUnitId: "Dh",
              },
            ],
    });
  const mate = unit("Mate", "2", 1, {
    info: {},
    deathRecords: [{ timestamp: at(33_744) }],
  });
  const kit = (unused: boolean) => [
    `<unit id="1" name="Dh">`,
    `<cooldowns>Metamorphosis [120s]${unused ? " [UNUSED]" : ""}, Blur [60s]</cooldowns>`,
  ];

  it("flags an [UNUSED] kit entry whose press went up inside the round", () => {
    expect(
      of(
        scan(runT05, [dh(32_885), mate], kit(true)),
        "unusedPressedBeforeRoundEnd",
      ),
    ).toHaveLength(1);
  });
  it("reads a kit that counts the press, and a landing with no aura before the end", () => {
    expect(
      of(
        scan(runT05, [dh(32_885), mate], kit(false)),
        "unusedPressedBeforeRoundEnd",
      ),
    ).toEqual([]);
    expect(
      of(
        scan(runT05, [dh(null), mate], kit(true)),
        "unusedPressedBeforeRoundEnd",
      ),
    ).toEqual([]);
  });
  // codex B11 #3: the scan reads the ledger's own selection — an earlier
  // form that ended at the death and a new one after it is no press inside
  // the round
  it("an APPLIED before the end, REMOVED at it and a new APPLIED after: the kit's [UNUSED] stands", () => {
    const own = (event: string, ms: number) => ({
      ...aura(event, ms, "162264", "Metamorphosis"),
      srcUnitId: "Dh",
      destUnitId: "Dh",
    });
    const reopened = unit("Dh", "1", 1, {
      info: {},
      startInfo: { bracket: "Rated Solo Shuffle" },
      spellCastEvents: [cast(34_200, "Dh", "200166", "Metamorphosis")],
      auraEvents: [
        own(LogEvent.SPELL_AURA_APPLIED, 32_885),
        own(LogEvent.SPELL_AURA_REMOVED, 33_744),
        own(LogEvent.SPELL_AURA_APPLIED, 34_000),
      ],
    });
    expect(
      of(
        scan(runT05, [reopened, mate], kit(true)),
        "unusedPressedBeforeRoundEnd",
      ),
    ).toEqual([]);
  });
  // codex T05-4: another spell's self-aura logged before its SUCCESS
  // (Recklessness 1719) is an inventory hit, out of the total — the ledger
  // keeps that row at its own instant, and the scan must not reject it
  it("a Recklessness aura before the end and its SUCCESS after it: an inventory hit, out of the total", () => {
    const warrior = unit("Dh", "1", 1, {
      info: {},
      startInfo: { bracket: "Rated Solo Shuffle" },
      spellCastEvents: [cast(33_809, "Dh", "1719", "Recklessness")],
      auraEvents: [
        {
          ...aura(LogEvent.SPELL_AURA_APPLIED, 33_700, "1719", "Recklessness"),
          srcUnitId: "Dh",
          destUnitId: "Dh",
        },
      ],
    });
    const seen = scan(
      runT05,
      [warrior, mate],
      [
        `<unit id="1" name="Dh">`,
        `<cooldowns>Recklessness [90s] [UNUSED]</cooldowns>`,
      ],
    ).filter((v) => v.check === "unusedPressedBeforeRoundEnd");
    expect(seen.map((v) => v.kind)).toEqual(["other (aura-led inventory)"]);
    expect(
      seen.every((v) => T05_OUT_OF_TOTAL.has(`${v.check}|${v.kind}`)),
    ).toBe(true);
  });
  // B19 assembly review: a logged 191427 button row is its own instant on
  // the ledger (codex T05-2b) — after the death, so [UNUSED] is right and
  // the scan must not backdate it through the aura's name
  it("a 191427 button row after the end with the form up before it: the kit's [UNUSED] stands", () => {
    const button = unit("Dh", "1", 1, {
      info: {},
      startInfo: { bracket: "Rated Solo Shuffle" },
      spellCastEvents: [cast(33_809, "Dh", "191427", "Metamorphosis")],
      auraEvents: [
        {
          ...aura(
            LogEvent.SPELL_AURA_APPLIED,
            32_885,
            "162264",
            "Metamorphosis",
          ),
          srcUnitId: "Dh",
          destUnitId: "Dh",
        },
      ],
    });
    expect(
      of(
        scan(runT05, [button, mate], kit(true)),
        "unusedPressedBeforeRoundEnd",
      ),
    ).toEqual([]);
  });
});
