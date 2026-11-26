/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the checks read them untyped */
/**
 * Pipeline T243 — scan artefacts of the v0.1.44 release check. Each `reads`
 * case is a shape the raw log proved right while the check flagged it; each
 * `flags` case is the defect the check is for, which must stay caught.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { run as runAbsorb } from "../scripts/scan5/absorb";
import {
  OUT_OF_TOTAL as FACT11_OUT_OF_TOTAL,
  run as runFact11,
} from "../scripts/scan5/fact11";
import { run as runFact8 } from "../scripts/scan5/fact8";
import { run as runOffensiveTag } from "../scripts/scan5/friendlyOffensiveTag";
import {
  OUT_OF_TOTAL as LIST_GAP_OUT_OF_TOTAL,
  run as runListGap,
} from "../scripts/scan5/listGap";
import { run as runPressEffect } from "../scripts/scan5/pressEffect";
import { run as runT42 } from "../scripts/scan5/t42";

const START = 1_000_000;
const at = (ms: number): number => START + ms;
let line = 0;
const rowOf = (event: string, ms: number, extra: Record<string, unknown>) => ({
  timestamp: at(ms),
  logLine: { event, timestamp: at(ms), lineIndex: line++ },
  ...extra,
});
const cast = (ms: number, src: string, spellId: string, spellName: string) =>
  rowOf(LogEvent.SPELL_CAST_SUCCESS, ms, {
    srcUnitId: src,
    spellId,
    spellName,
  });
const aura = (
  event: string,
  ms: number,
  unit: string,
  spellId: string,
  spellName: string,
) =>
  rowOf(event, ms, {
    srcUnitId: unit,
    destUnitId: unit,
    spellId,
    spellName,
  });

interface IViolation {
  check: string;
  kind: string;
}
function scan(
  run: (ctx: any) => void,
  players: any[],
  lines: string[],
  roundEndAt = at(600_000),
  legacyExtra: Record<string, unknown> = {},
): IViolation[] {
  const seen: IViolation[] = [];
  run({
    lines,
    text: lines.join("\n"),
    menu: "",
    rawLines: [],
    legacy: {
      startTime: START,
      endTime: roundEndAt,
      units: Object.fromEntries(players.map((p) => [p.id, p])),
      ...legacyExtra,
    },
    players,
    units: players,
    byName: new Map(players.map((p) => [p.name, p])),
    owner: players[0],
    unitOfPid: (pid: string | undefined) => players.find((p) => p.pid === pid),
    pidOf: (name: string) => players.find((p) => p.name === name)?.pid,
    start: START,
    end: roundEndAt,
    roundEndAt,
    bump: () => {},
    violate: (check: string, kind: string) => seen.push({ check, kind }),
  });
  return seen;
}
const of = (v: IViolation[], check: string): string[] =>
  v.filter((x) => x.check === check).map((x) => x.kind);

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("noPressButPressed (T243)", () => {
  // Exhilaration's 3 s Survival of the Fittest at 137.074 s, the hunter's
  // own press refreshing it at 137.632 s
  const SOTF = "264735";
  const hunter = {
    id: "h",
    name: "Hunter",
    pid: "5",
    reaction: 2,
    spellCastEvents: [cast(137_632, "h", SOTF, "Survival of the Fittest")],
    auraEvents: [
      aura(
        LogEvent.SPELL_AURA_APPLIED,
        137_074,
        "h",
        SOTF,
        "Survival of the Fittest",
      ),
      aura(
        LogEvent.SPELL_AURA_REFRESH,
        137_632,
        "h",
        SOTF,
        "Survival of the Fittest",
      ),
    ],
  };
  const owner = { id: "o", name: "Owner", pid: "1", reaction: 1 };
  const proc =
    "2:17  [ENEMY DEF]   5(MHunter) (Marksmanship Hunter): Survival of the Fittest (25%, 0.6s) [no press logged] (at 14% HP)";
  const pressed =
    "2:17  [ENEMY DEF]   5(MHunter) (Marksmanship Hunter): Survival of the Fittest (25%, 8.0s) (at 38% HP)";

  it("reads the proc's line beside the press's own line", () => {
    expect(
      of(
        scan(runPressEffect, [owner, hunter], [proc, pressed]),
        "noPressButPressed",
      ),
    ).toEqual([]);
  });

  it("flags the tagged line when the press has no line of its own", () => {
    expect(
      of(scan(runPressEffect, [owner, hunter], [proc]), "noPressButPressed"),
    ).toEqual(["refreshed"]);
  });

  it("flags the press's line when the tag moved to it (B221 review #1)", () => {
    // the Exhilaration copy's line untagged, the hunter's own press tagged:
    // the untagged line's producer event is an application it logged no
    // press for, not the press's own
    const untaggedProc = proc.replace(" [no press logged]", "");
    const taggedPress = pressed.replace(
      " (at 38% HP)",
      " [no press logged] (at 38% HP)",
    );
    expect(
      of(
        scan(runPressEffect, [owner, hunter], [untaggedProc, taggedPress]),
        "noPressButPressed",
      ),
    ).toEqual(["refreshed"]);
  });

  it("flags it when the press refreshed nothing, whatever else prints", () => {
    // one application, the press's own (codex 85-tk-L5-T243-1 #2)
    const single = {
      ...hunter,
      auraEvents: [
        aura(
          LogEvent.SPELL_AURA_APPLIED,
          137_630,
          "h",
          SOTF,
          "Survival of the Fittest",
        ),
      ],
    };
    expect(
      of(
        scan(runPressEffect, [owner, single], [proc, pressed]),
        "noPressButPressed",
      ),
    ).toEqual(["noRefreshRow"]);
  });
});

describe("ownAbsorbDefenseless (T243)", () => {
  // Ice Barrier pressed at 10 s, eaten by 12.7 s, no REMOVED logged
  const ICE = "11426";
  const mage = (extra: any[] = []) => ({
    id: "m",
    name: "Mage",
    pid: "4",
    reaction: 2,
    spellCastEvents: [cast(10_000, "m", ICE, "Ice Barrier")],
    auraEvents: [
      aura(LogEvent.SPELL_AURA_APPLIED, 10_000, "m", ICE, "Ice Barrier"),
      ...extra,
    ],
    absorbsIn: [
      rowOf(LogEvent.SPELL_ABSORBED, 12_700, {
        srcUnitId: "m",
        spellId: ICE,
        spellName: "Ice Barrier",
        absorbedAmount: 5_000,
      }),
    ],
  });
  const owner = { id: "o", name: "Owner", pid: "1", reaction: 1 };
  const window =
    "  [KILL WINDOW] 0:30–0:40 on Frost Mage (Mage): team burst 400k (defenseless 0:30–0:40); team offensive CDs ready at 0:30: none.";

  it("ends an unclosed run at its last absorbed row", () => {
    expect(
      of(scan(runAbsorb, [owner, mage()], [window]), "ownAbsorbDefenseless"),
    ).toEqual([]);
  });

  it("keeps a run a later REFRESH renewed up to its length", () => {
    expect(
      of(
        scan(
          runAbsorb,
          [
            owner,
            mage([
              aura(
                LogEvent.SPELL_AURA_REFRESH,
                28_000,
                "m",
                ICE,
                "Ice Barrier",
              ),
            ]),
          ],
          [window],
        ),
        "ownAbsorbDefenseless",
      ),
    ).toEqual(["pressed"]);
  });

  it("leaves the shield before it its absorbed row", () => {
    // the old barrier eaten and removed at 9.95 s, a fresh one at 10 s
    // (codex 85-tk-L5-T243-1 #3)
    const two = {
      ...mage(),
      spellCastEvents: [
        cast(5_000, "m", ICE, "Ice Barrier"),
        cast(10_000, "m", ICE, "Ice Barrier"),
      ],
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, 5_000, "m", ICE, "Ice Barrier"),
        aura(LogEvent.SPELL_AURA_REMOVED, 9_950, "m", ICE, "Ice Barrier"),
        aura(LogEvent.SPELL_AURA_APPLIED, 10_000, "m", ICE, "Ice Barrier"),
      ],
      absorbsIn: [
        rowOf(LogEvent.SPELL_ABSORBED, 9_950, {
          srcUnitId: "m",
          spellId: ICE,
          spellName: "Ice Barrier",
          absorbedAmount: 5_000,
        }),
      ],
    };
    expect(
      of(scan(runAbsorb, [owner, two], [window]), "ownAbsorbDefenseless"),
    ).toEqual(["pressed"]);
  });
});

describe("listGapPress healer racial (T243)", () => {
  // a Restoration Shaman's Blood Fury: no cooldown line by ruling R55
  const scanRacial = (kitRow: string): string[] => {
    const owner = {
      id: "o",
      name: "Owner",
      pid: "1",
      reaction: 1,
      info: { teamId: "0" },
    };
    const shaman = {
      id: "s",
      name: "Shaman",
      pid: "4",
      reaction: 2,
      spec: "264",
      info: { teamId: "1" },
      spellCastEvents: [cast(20_300, "s", "33697", "Blood Fury")],
      auraEvents: [],
    };
    return of(
      scan(
        runListGap,
        [owner, shaman],
        ['<unit name="Shaman">', `  <cooldowns>${kitRow}</cooldowns>`],
      ),
      "listGapPress",
    );
  };

  it("files one the kit row lists out of the total", () => {
    const kinds = scanRacial("Blood Fury [120s]");
    expect(kinds).toEqual(["healerRacial/enemy/kitOnly"]);
    expect(LIST_GAP_OUT_OF_TOTAL.has(`listGapPress|${kinds[0]}`)).toBe(true);
  });

  it("keeps one the kit row lacks too in the total", () => {
    const kinds = scanRacial("Ascendance [180s]");
    expect(kinds).toHaveLength(1);
    expect(kinds[0]).toMatch(/\/enemy\/noLine$/);
    expect(LIST_GAP_OUT_OF_TOTAL.has(`listGapPress|${kinds[0]}`)).toBe(false);
  });
});

describe("immunityBaitedSelfBroken (T243)", () => {
  // Mass Invisibility at 58 s, its holder's next cast at 61 s
  const MASS_INVIS = "414664";
  const scanInvis = (shuffleDeathMs: number | undefined): string[] => {
    const owner = {
      id: "o",
      name: "Owner",
      pid: "1",
      reaction: 1,
      info: {},
      deathRecords:
        shuffleDeathMs === undefined ? [] : [{ timestamp: at(shuffleDeathMs) }],
    };
    const mage = {
      id: "m",
      name: "Mage",
      pid: "4",
      reaction: 2,
      info: {},
      spellCastEvents: [cast(61_000, "m", "116", "Frostbolt")],
      auraEvents: [
        aura(
          LogEvent.SPELL_AURA_APPLIED,
          58_000,
          "m",
          MASS_INVIS,
          "Mass Invisibility",
        ),
      ],
      damageOut: [],
    };
    return of(
      scan(
        runFact11,
        [owner, mage],
        ["  [0:55–0:58] on Mage — burst | FAILED: forced a full immunity"],
        at(65_000),
        shuffleDeathMs === undefined
          ? {}
          : { startInfo: { bracket: "Rated Solo Shuffle" } },
      ),
      "immunityBaitedSelfBroken",
    );
  };

  it("reads an action after the round's deciding death as outside it", () => {
    expect(scanInvis(60_000)).toEqual([]);
  });

  it("flags an action inside a round that runs to its log's end", () => {
    // a 3v3 round does not end at a death (codex 85-tk-L5-T243-1 #4)
    expect(scanInvis(undefined)).toEqual(["Mass Invisibility"]);
  });
});

describe("staleDipWithDamage (T243)", () => {
  // a 60k hit, then the current falls with a max-HP buff (1,000k → 900k):
  // the last row before the 0:20 tick is logged over the old max
  const hp = (ms: number, current: number, max: number) =>
    rowOf(LogEvent.SPELL_DAMAGE, ms, {
      advancedActorId: "p",
      advancedActorCurrentHp: current,
      advancedActorMaxHp: max,
    });
  const scanTick = (newMaxRow: boolean): string[] => {
    const priest = {
      id: "p",
      name: "Priest",
      pid: "2",
      reaction: 1,
      info: {},
      advancedActions: [
        hp(19_000, 610_000, 1_000_000),
        hp(19_300, 550_000, 1_000_000),
        hp(19_700, 495_000, 1_000_000),
        ...(newMaxRow ? [hp(20_100, 495_000, 900_000)] : []),
      ],
      damageIn: [
        rowOf(LogEvent.SPELL_DAMAGE, 19_200, { effectiveAmount: -60_000 }),
      ],
      healIn: [],
    };
    return of(
      scan(runFact8, [priest], ["0:20  [STATE] 2(Priest):55"]),
      "staleDipWithDamage",
    );
  };

  it("reads a stale-max row over the max the product reads it on", () => {
    expect(scanTick(true)).toEqual([]);
  });

  it("flags a tick over a row whose max stands", () => {
    expect(scanTick(false)).toEqual(["tick"]);
  });
});

describe("offensiveTagWrong cdLessOnly (T243)", () => {
  // a tagged enemy press at 0:30 with a mage's Ignite on the enemy, and a
  // Retribution Paladin's Divine Resonance (Divine Toll pressed at 0:25)
  const scanTag = (divineToll: boolean): string[] => {
    const enemy = {
      id: "e",
      name: "Enemy",
      pid: "4",
      reaction: 2,
      info: {},
      spellCastEvents: [],
      auraEvents: [
        rowOf(LogEvent.SPELL_AURA_APPLIED, 28_000, {
          srcUnitId: "o",
          destUnitId: "e",
          spellId: "12654",
          spellName: "Ignite",
        }),
      ],
    };
    const mage = {
      id: "o",
      name: "Owner",
      pid: "1",
      reaction: 1,
      spec: "63",
      info: {},
      spellCastEvents: [],
      auraEvents: [],
    };
    const paladin = {
      id: "r",
      name: "Ret",
      pid: "2",
      reaction: 1,
      spec: "70",
      info: {},
      spellCastEvents: divineToll
        ? [cast(25_000, "r", "375576", "Divine Toll")]
        : [],
      auraEvents: divineToll
        ? [
            aura(
              LogEvent.SPELL_AURA_APPLIED,
              25_000,
              "r",
              "1266308",
              "Divine Resonance",
            ),
          ]
        : [],
    };
    return of(
      scan(
        runOffensiveTag,
        [mage, paladin, enemy],
        [
          "0:30  [ENEMY DEF]   4(Enemy) (Frost Mage): Ice Barrier (8.0s) [friendly offensive CD active] (at 60% HP)",
        ],
      ),
      "offensiveTagWrong",
    );
  };

  it("reads the Divine Resonance as its Divine Toll running", () => {
    expect(scanTag(true)).toEqual([]);
  });

  it("flags a tag only a cooldown-less aura was up for", () => {
    expect(scanTag(false)).toEqual(["cdLessOnly"]);
  });
});

describe("castLineNoButton (T243)", () => {
  const scanCast = (spellId: string, spellName: string): string[] => {
    const owner = {
      id: "o",
      name: "Owner",
      pid: "1",
      reaction: 1,
      spellCastEvents: [cast(20_300, "o", spellId, spellName)],
    };
    return of(
      scan(runFact11, [owner], [`0:20  [YOU] [CAST]   ${spellName}`]),
      "castLineNoButton",
    );
  };

  it("files a reviewed button with no SpellCooldowns row out of the total", () => {
    const kinds = scanCast("155777", "Rejuvenation (Germination)");
    expect(kinds).toHaveLength(1);
    expect(FACT11_OUT_OF_TOTAL.has(`castLineNoButton|${kinds[0]}`)).toBe(true);
  });

  it("still flags a passive's row under its own id", () => {
    const kinds = scanCast("289655", "Sanctified Ground");
    expect(kinds).toEqual(["Sanctified Ground 289655"]);
    expect(FACT11_OUT_OF_TOTAL.has(`castLineNoButton|${kinds[0]}`)).toBe(false);
  });
});

describe("attemptNamedLaterPress (T243)", () => {
  // Power Infusion on the demon hunter at 40.5 s; the Metamorphosis form row
  // at 40.4 s, its 200166 landing row at 41.4 s
  const scanMeta = (formRowMs: number | undefined): number => {
    const priest = {
      id: "p",
      name: "p",
      reaction: 1,
      spec: "258",
      spellCastEvents: [
        {
          ...cast(40_500, "p", "10060", "Power Infusion"),
          destUnitId: "d",
        },
      ],
      auraEvents: [],
      damageOut: [],
    };
    const dh = {
      id: "d",
      name: "d",
      reaction: 1,
      spec: "577",
      spellCastEvents: [cast(41_400, "d", "200166", "Metamorphosis")],
      auraEvents: [
        rowOf(LogEvent.SPELL_AURA_APPLIED, 40_510, {
          srcUnitId: "p",
          destUnitId: "d",
          spellId: "10060",
          spellName: "Power Infusion",
        }),
        ...(formRowMs === undefined
          ? []
          : [
              aura(
                LogEvent.SPELL_AURA_APPLIED,
                formRowMs,
                "d",
                "162264",
                "Metamorphosis",
              ),
            ]),
      ],
      damageOut: [
        rowOf(LogEvent.SPELL_DAMAGE, 42_000, {
          destUnitId: "e",
          effectiveAmount: -1000,
        }),
      ],
    };
    const enemy = { id: "e", name: "e", reaction: 2 };
    return of(
      scan(
        runT42,
        [priest, dh, enemy],
        ["  [0:40–0:58] on e — Metamorphosis burst (no stun)"],
      ),
      "attemptNamedLaterPress",
    ).length;
  };

  it("dates a Metamorphosis landing at the form row it went up with", () => {
    expect(scanMeta(40_400)).toBe(0);
  });

  it("flags the line when the press itself came a second later", () => {
    expect(scanMeta(undefined)).toBe(1);
  });
});

describe("ownAbsorbDefenseless — one ms, source order (B221 review #2)", () => {
  const ICE = "11426";
  const owner = { id: "o", name: "Owner", pid: "1", reaction: 1 };
  const window =
    "  [KILL WINDOW] 0:30–0:40 on Frost Mage (Mage): team burst 400k (defenseless 0:30–0:40); team offensive CDs ready at 0:30: none.";
  const line = <T extends { logLine?: any }>(r: T, li: number): T => {
    (r as any).logLine = { ...(r as any).logLine, lineIndex: li };
    return r;
  };
  // the old barrier absorbs, is removed and a fresh one applied, all at
  // 10.000 s in that log order; nothing absorbs or removes after
  const mage = (absorbLi: number) => ({
    id: "m",
    name: "Mage",
    pid: "4",
    reaction: 2,
    spellCastEvents: [
      cast(5_000, "m", ICE, "Ice Barrier"),
      cast(10_000, "m", ICE, "Ice Barrier"),
    ],
    auraEvents: [
      line(
        aura(LogEvent.SPELL_AURA_APPLIED, 5_000, "m", ICE, "Ice Barrier"),
        1,
      ),
      line(
        aura(LogEvent.SPELL_AURA_REMOVED, 10_000, "m", ICE, "Ice Barrier"),
        11,
      ),
      line(
        aura(LogEvent.SPELL_AURA_APPLIED, 10_000, "m", ICE, "Ice Barrier"),
        12,
      ),
    ],
    absorbsIn: [
      line(
        rowOf(LogEvent.SPELL_ABSORBED, 10_000, {
          srcUnitId: "m",
          spellId: ICE,
          spellName: "Ice Barrier",
          absorbedAmount: 5_000,
        }),
        absorbLi,
      ),
    ],
  });
  it("the old shield's absorb before the new APPLIED does not close the new one", () => {
    expect(
      of(scan(runAbsorb, [owner, mage(10)], [window]), "ownAbsorbDefenseless"),
    ).toEqual(["pressed"]);
  });
  it("an absorb logged after the new APPLIED is the new shield's", () => {
    expect(
      of(scan(runAbsorb, [owner, mage(13)], [window]), "ownAbsorbDefenseless"),
    ).toEqual([]);
  });
});
