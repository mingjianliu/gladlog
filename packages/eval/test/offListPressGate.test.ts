/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * GH #176 gate `offListPressLine` (scan5/offListPress.ts): the next press a
 * `back m:ss` is checked against (codex review of the #176 diff).
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/offListPress";

const START = 1_000_000;
const at = (ms: number) => START + ms;
const cast = (spellId: string, ms: number): any => ({
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: at(ms) },
  timestamp: at(ms),
  spellId,
  srcUnitId: "p1",
});
const aura = (event: LogEvent, spellId: string, ms: number): any => ({
  logLine: { event, timestamp: at(ms) },
  timestamp: at(ms),
  spellId,
  srcUnitId: "p1",
  destUnitId: "p1",
});

function scan(unit: any, lines: string[], other?: any) {
  const seen: Array<{ kind: string; detail: string }> = [];
  run({
    lines,
    units: other ? [unit, other] : [unit],
    owner: unit,
    unitOfPid: (pid: string) =>
      pid === "1" ? unit : pid === "2" ? other : undefined,
    start: START,
    roundKey: "r",
    violate: (
      _c: string,
      kind: string,
      _t: number,
      _f: string,
      detail: string,
    ) => seen.push({ kind, detail }),
    bump: () => {},
  } as any);
  return seen;
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("offListPressLine — the next press", () => {
  it("free status belongs to the press its line names, not to its second", () => {
    // Sprint at 0:10, a Time-Spiral-free one at 1:10.1, an ordinary at 1:10.8
    const unit = {
      id: "p1",
      name: "Rogue",
      spellCastEvents: [
        cast("2983", 10_000),
        cast("2983", 70_100),
        cast("2983", 70_800),
      ],
      auraEvents: [aura(LogEvent.SPELL_AURA_REMOVED, "375255", 70_110)],
    };
    const seen = scan(unit, [
      "0:10  [PRESS]   1(ORogue) (Outlaw Rogue): Sprint (60s cd, back 2:00)",
      "1:10  [PRESS]   1(ORogue) (Outlaw Rogue): Sprint (60s cd, free press, back 1:10)",
      "1:10  [PRESS]   1(ORogue) (Outlaw Rogue): Sprint (60s cd, back 2:10)",
    ]);
    expect(seen.map((v) => v.kind)).toEqual(["backBeforeNextPress"]);
    expect(seen[0]!.detail).toContain("pressed 1:10");
  });

  it("another player's free press in the same millisecond frees nothing (codex review round 2)", () => {
    const a = {
      id: "p1",
      name: "RogueA",
      spellCastEvents: [cast("2983", 10_000), cast("2983", 70_800)],
      auraEvents: [],
    };
    const b = {
      id: "p2",
      name: "RogueB",
      spellCastEvents: [{ ...cast("2983", 70_800), srcUnitId: "p2" }],
      auraEvents: [
        {
          ...aura(LogEvent.SPELL_AURA_REMOVED, "375255", 70_810),
          destUnitId: "p2",
        },
      ],
    };
    const seen = scan(
      a,
      [
        "0:10  [PRESS]   1(ORogue) (Outlaw Rogue): Sprint (60s cd, back 2:00)",
        "1:10  [PRESS]   1(ORogue) (Outlaw Rogue): Sprint (60s cd, back 2:10)",
        "1:10  [PRESS]   2(ORogue) (Outlaw Rogue): Sprint (60s cd, free press, back 1:10)",
      ],
      b,
    );
    expect(seen.map((v) => v.kind)).toEqual(["backBeforeNextPress"]);
  });

  it("a row echoing a free press is no next press", () => {
    // Sprint at 0:10, a free one at 0:58.432 and its echo 0.258 s later
    const unit = {
      id: "p1",
      name: "Rogue",
      spellCastEvents: [
        cast("2983", 10_000),
        cast("2983", 58_432),
        cast("2983", 58_690),
      ],
      auraEvents: [aura(LogEvent.SPELL_AURA_REMOVED, "375255", 58_432)],
    };
    expect(
      scan(unit, [
        "0:10  [PRESS]   1(SRogue) (Subtlety Rogue): Sprint (60s cd, back 1:10)",
        "0:58  [PRESS]   1(SRogue) (Subtlety Rogue): Sprint (60s cd, free press, back 1:10)",
      ]),
    ).toEqual([]);
  });

  it("a Stasis replay is no next press", () => {
    // Cauterizing Flame stored at 0:10, released 0:40, its replay at 0:40.2
    const unit = {
      id: "p1",
      name: "Evoker",
      spellCastEvents: [cast("374251", 10_000), cast("374251", 40_200)],
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "370537", 9_500),
        aura(LogEvent.SPELL_AURA_REMOVED, "370537", 10_100),
        aura(LogEvent.SPELL_AURA_APPLIED, "370562", 10_100),
        aura(LogEvent.SPELL_AURA_REMOVED, "370562", 40_000),
      ],
    };
    expect(
      scan(unit, [
        "0:10  [PRESS]   1(PEvoker) (Preservation Evoker): Cauterizing Flame (60s cd, back 1:10)",
      ]),
    ).toEqual([]);
  });
});
