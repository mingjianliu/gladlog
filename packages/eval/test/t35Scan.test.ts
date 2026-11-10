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
    legacy: {
      startTime: START,
      endTime: ms(roundEndS),
      units: { [owner.id]: owner },
    },
    unitOfPid: (pid: string | undefined) => (pid === "1" ? owner : undefined),
    firstOwnerOfRound: false,
    violate: (check: string, kind: string) => seen.push(`${check}:${kind}`),
    bump: () => {},
  } as any);
  return seen;
}

describe("scan5/t35 setCooldownBack", () => {
  // a Devastation 4-piece: Causality's give-backs are 0.05 s longer, so
  // the printed `back` is a holder's line; the check reads the log's next
  // press as the producer reads presses
  const dev = (pieces: number, again: number) =>
    unit("1467", "2058", pieces, [
      success("357208", 10),
      success("357208", again),
    ]);
  it("a holder's back printed after its logged re-press is caught; at it, it passes", () => {
    expect(
      scan(dev(4, 30), [
        "0:10  [YOU] [PRESS]   Fire Breath (30s cd, back 0:40)",
      ]),
    ).toEqual(["setCooldownBack:pressBeforeBack"]);
    expect(
      scan(dev(4, 40), [
        "0:10  [YOU] [PRESS]   Fire Breath (30s cd, back 0:40)",
      ]),
    ).toEqual([]);
  });
  it("a non-holder's line is not this check's (another pid form too)", () => {
    const line =
      "0:10  [PRESS]   1(DEvoker) (Devastation Evoker): Fire Breath (30s cd, back 0:40)";
    expect(scan(dev(3, 30), [line])).toEqual([]);
    expect(scan(dev(4, 30), [line])).toEqual([
      "setCooldownBack:pressBeforeBack",
    ]);
  });
  // codex 85-tk-A-T35-1 #2: a press after the round's end is no press of
  // the round
  it("a cast after the round's end contradicts nothing", () => {
    expect(
      scan(
        dev(4, 20),
        ["0:10  [YOU] [PRESS]   Fire Breath (30s cd, back 0:40)"],
        15,
      ),
    ).toEqual([]);
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
  const removedAt = (pieces: number, at: number) => {
    const u = feral(pieces);
    u.auraEvents.push(aura("106951", LogEvent.SPELL_AURA_REMOVED, at));
    return u;
  };
  it("an estimated fade at 15 s whose run the log ended at 20 s is caught", () => {
    expect(scan(removedAt(4, 20), [line])).toEqual([
      "setFadeWhileUp:estimatedFadeWhileUp",
    ]);
  });
  it("a REMOVED inside the printed second, or a non-holder, passes", () => {
    expect(scan(removedAt(4, 15.5), [line])).toEqual([]);
    expect(scan(removedAt(3, 20), [line])).toEqual([]);
  });
  // codex 85-tk-A-T35-1 #1: with no REMOVED the log is silent — a round
  // running on past the estimate is no evidence the buff was still up
  it("no REMOVED: no verdict", () => {
    expect(scan(feral(4), [line], 30)).toEqual([]);
  });
  // codex B33 #2: the line is the 0 s press's; a re-press at 20.8 s — its
  // APPLIED inside the printed second — is the next run, whose REMOVED at
  // 40.8 s says nothing about the first
  it("a re-press inside the printed second is the next run's", () => {
    const u = feral(4);
    u.spellCastEvents.push(success("106951", 20.8));
    u.auraEvents.push(
      aura("106951", LogEvent.SPELL_AURA_APPLIED, 20.8),
      aura("106951", LogEvent.SPELL_AURA_REMOVED, 40.8),
    );
    expect(
      scan(u, ["0:20  [BUFF FADED]   Berserk (expired, estimated)"], 60),
    ).toEqual([]);
  });
});
