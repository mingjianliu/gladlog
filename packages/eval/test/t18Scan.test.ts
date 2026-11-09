/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * scan5/t18 `setExtendedFade` (GH #175 row 1): a Fury 2pc holder's
 * Recklessness fade line is read against the run the log's landed presses
 * make. Each case states the line the flat 18 s printed (caught) and the one
 * the extended length prints (passes), in the rendered format of
 * `timelineSections/buffFaded.ts`.
 */
import { CLASS_SET_ITEM_IDS } from "@gladlog/analysis/src/data/classSetBonuses";
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/t18";

const START = Date.UTC(2026, 9, 9);
const ms = (s: number): number => START + Math.round(s * 1000);
const RECKLESSNESS = "1719";

beforeAll(async () => {
  await ensureAnalysisData();
});

const aura = (event: LogEvent, atS: number): any => ({
  spellId: RECKLESSNESS,
  spellName: "Recklessness",
  srcUnitId: "w",
  destUnitId: "w",
  timestamp: ms(atS),
  logLine: { event, timestamp: ms(atS) },
});
const cast = (spellId: string, name: string, atS: number): any => ({
  spellId,
  spellName: name,
  srcUnitId: "w",
  destUnitId: "e",
  timestamp: ms(atS),
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: ms(atS) },
});
const hit = (spellId: string, name: string, atS: number): any => ({
  spellId,
  spellName: name,
  srcUnitId: "w",
  destUnitId: "e",
  timestamp: ms(atS),
  logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: ms(atS) },
});
/** a Fury warrior with Rampaging Berserker (18 s) wearing `pieces` of 2067 */
function warrior(
  pieces: number,
  auras: any[],
  casts: any[],
  damageOut: any[],
  missesOut: any[] = [],
): any {
  return {
    id: "w",
    name: "w",
    pid: "1",
    spec: "72",
    info: {
      talents: [{ id1: 110412, id2: 137002, count: 1 }],
      pvpTalents: [],
      equipment: CLASS_SET_ITEM_IDS["2067"]!.slice(0, pieces).map((id) => ({
        id,
      })),
    },
    auraEvents: auras,
    spellCastEvents: [cast(RECKLESSNESS, "Recklessness", 0), ...casts],
    damageOut,
    missesOut,
  };
}
function scan(owner: any, lines: string[]): string[] {
  const seen: string[] = [];
  run({
    lines,
    owner,
    players: [owner],
    start: START,
    firstOwnerOfRound: false,
    violate: (check: string, kind: string) => seen.push(`${check}:${kind}`),
    bump: () => {},
  } as any);
  return seen;
}
const fade = (mss: string, claim: string) =>
  `${mss}  [BUFF FADED]   Recklessness (${claim})`;

describe("scan5/t18 setExtendedFade", () => {
  // two landed Raging Blows: 18 + 4 = 22 s, no REMOVED (the round ended)
  const twoLanded = () =>
    warrior(
      2,
      [aura(LogEvent.SPELL_AURA_APPLIED, 0)],
      [cast("85288", "Raging Blow", 3), cast("85288", "Raging Blow", 9)],
      [hit("96103", "Raging Blow", 3.05), hit("96103", "Raging Blow", 9.05)],
    );

  it("an estimated fade at the flat 18 s is caught, at 22 s it passes", () => {
    expect(scan(twoLanded(), [fade("0:18", "expired, estimated")])).toEqual([
      "setExtendedFade:estimatedBeforeEnd",
    ]);
    expect(scan(twoLanded(), [fade("0:22", "expired, estimated")])).toEqual([]);
  });

  it("`ended after A of Bs` must state the extended length", () => {
    const o = warrior(
      2,
      [
        aura(LogEvent.SPELL_AURA_APPLIED, 0),
        aura(LogEvent.SPELL_AURA_REMOVED, 15),
      ],
      [cast("85288", "Raging Blow", 3)],
      [hit("96103", "Raging Blow", 3.05)],
    );
    expect(
      scan(o, [fade("0:15", "ended after 15.0 of 18s — no dispel logged")]),
    ).toEqual(["setExtendedFade:fullLengthMisread"]);
    expect(
      scan(o, [fade("0:15", "ended after 15.0 of 20s — no dispel logged")]),
    ).toEqual([]);
  });

  it("`(expired)` on a run the log cut short of its extended length is caught", () => {
    const o = warrior(
      2,
      [
        aura(LogEvent.SPELL_AURA_APPLIED, 0),
        aura(LogEvent.SPELL_AURA_REMOVED, 18),
      ],
      [1, 3, 5].map((s) => cast("85288", "Raging Blow", s)),
      [1, 3, 5].map((s) => hit("96103", "Raging Blow", s + 0.05)),
    );
    expect(scan(o, [fade("0:18", "expired")])).toEqual([
      "setExtendedFade:shortRunReadExpired",
    ]);
  });

  it("a refused press extends nothing, and a non-holder is not read", () => {
    const refused = warrior(
      2,
      [aura(LogEvent.SPELL_AURA_APPLIED, 0)],
      [cast("335097", "Crushing Blow", 12.5)],
      [],
      [{ ...hit("335098", "Crushing Blow", 12.65), missType: "IMMUNE" }],
    );
    expect(scan(refused, [fade("0:18", "expired, estimated")])).toEqual([]);
    const onePiece = warrior(
      1,
      [aura(LogEvent.SPELL_AURA_APPLIED, 0)],
      [cast("85288", "Raging Blow", 3)],
      [hit("96103", "Raging Blow", 3.05)],
    );
    expect(scan(onePiece, [fade("0:18", "expired, estimated")])).toEqual([]);
  });
});
