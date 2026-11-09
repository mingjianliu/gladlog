/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * scan5/t35 (GH #175 rows 2–17): a set-bonus holder's printed `back M:SS`
 * against the unit's next logged press, and an estimated fade of a
 * set-lengthened buff against the log's run. Each case states the line the
 * unworn number printed (caught) and the one the worn number prints
 * (passes).
 */
import { CLASS_SET_ITEM_IDS } from "@gladlog/analysis/src/data/classSetBonuses";
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/t35";

const START = Date.UTC(2026, 9, 9);
const ms = (s: number): number => START + Math.round(s * 1000);

beforeAll(async () => {
  await ensureAnalysisData();
});

const success = (spellId: string, atS: number): any => ({
  spellId,
  srcUnitId: "u",
  timestamp: ms(atS),
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: ms(atS) },
});
const aura = (spellId: string, event: LogEvent, atS: number): any => ({
  spellId,
  srcUnitId: "u",
  destUnitId: "u",
  timestamp: ms(atS),
  logLine: { event, timestamp: ms(atS) },
});
function unit(
  spec: string,
  setId: string,
  pieces: number,
  casts: any[],
  auras: any[] = [],
): any {
  return {
    id: "u",
    name: "u",
    spec,
    info: {
      talents: [],
      pvpTalents: [],
      equipment: CLASS_SET_ITEM_IDS[setId]!.slice(0, pieces).map((id) => ({
        id,
      })),
    },
    spellCastEvents: casts,
    auraEvents: auras,
    damageOut: [],
    missesOut: [],
    deathRecords: [],
  };
}
function scan(owner: any, lines: string[], roundEndS = 300): string[] {
  const seen: string[] = [];
  run({
    lines,
    owner,
    players: [owner],
    start: START,
    roundEndAt: ms(roundEndS),
    unitOfPid: (pid: string | undefined) => (pid === "1" ? owner : undefined),
    firstOwnerOfRound: false,
    violate: (check: string, kind: string) => seen.push(`${check}:${kind}`),
    bump: () => {},
  } as any);
  return seen;
}

describe("scan5/t35 setCooldownBack", () => {
  const prot = (pieces: number) =>
    unit("73", "2067", pieces, [
      success("228920", 10),
      success("228920", 85.2),
    ]);
  it("a 4-piece Protection's Ravager printed back at 90 s is caught by its 75 s re-press; back at 75 s passes", () => {
    expect(
      scan(prot(4), ["0:10  [YOU] [PRESS]   Ravager (90s cd, back 1:40)"]),
    ).toEqual(["setCooldownBack:pressBeforeBack"]);
    expect(
      scan(prot(4), ["0:10  [YOU] [PRESS]   Ravager (75s cd, back 1:25)"]),
    ).toEqual([]);
  });
  it("a non-holder's line is not this check's (another pid form too)", () => {
    expect(
      scan(prot(3), [
        "0:10  [PRESS]   1(PWarrior) (Protection Warrior): Ravager (90s cd, back 1:40)",
      ]),
    ).toEqual([]);
    expect(
      scan(prot(4), [
        "0:10  [PRESS]   1(PWarrior) (Protection Warrior): Ravager (90s cd, back 1:40)",
      ]),
    ).toEqual(["setCooldownBack:pressBeforeBack"]);
  });
});

describe("scan5/t35 setFadeWhileUp", () => {
  const feral = (pieces: number) =>
    unit(
      "103",
      "2057",
      pieces,
      [success("106951", 0)],
      [aura("106951", LogEvent.SPELL_AURA_APPLIED, 0)],
    );
  const line = "0:15  [BUFF FADED]   Berserk (expired, estimated)";
  it("an estimated fade at 15 s while the round ran to 18 s with no REMOVED is caught", () => {
    expect(scan(feral(4), [line], 18)).toEqual([
      "setFadeWhileUp:estimatedFadeWhileUp",
    ]);
  });
  it("the round ending inside the printed second, or a non-holder, passes", () => {
    expect(scan(feral(4), [line], 15.5)).toEqual([]);
    expect(scan(feral(3), [line], 18)).toEqual([]);
  });
});
