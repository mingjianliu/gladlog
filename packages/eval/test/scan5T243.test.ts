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
